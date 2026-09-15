using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Features;
using RevelMovies.Api.Endpoints;
using RevelMovies.Api.Hubs;
using RevelMovies.Api.Runtime;
using RevelMovies.Application.Commands;
using RevelMovies.Application.Media;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Events;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Playback;
using RevelMovies.Infrastructure;
using RevelMovies.Infrastructure.Media;
using RevelMovies.Infrastructure.Persistence;
using RevelEvent = RevelMovies.Domain.Events.Event;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("RevelMovies")
    ?? throw new InvalidOperationException("Connection string 'RevelMovies' is required.");
var maxMediaUploadBytes = builder.Configuration.GetValue<long>("MediaStorage:MaxUploadBytes", 1073741824);
var configuredMediaRoot = builder.Configuration["MediaStorage:RootPath"] ?? "media";
var mediaRoot = Path.IsPathRooted(configuredMediaRoot)
    ? configuredMediaRoot
    : Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, configuredMediaRoot));

builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = maxMediaUploadBytes);
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = maxMediaUploadBytes);
builder.Services.AddRevelMoviesInfrastructure(connectionString);
builder.Services.AddSingleton<IMediaStorage>(_ => new LocalMediaStorage(mediaRoot));
builder.Services.AddScoped<DisplayRegistry>();
builder.Services.AddScoped<EventRegistry>();
builder.Services.AddScoped<MediaRegistry>();
builder.Services.AddScoped<DisplayGroupRegistry>();
builder.Services.AddScoped<PlaylistRegistry>();
builder.Services.AddScoped<CommandAcknowledgementRegistry>();
builder.Services.AddScoped<PlaybackStateRegistry>();
builder.Services.AddScoped<PlayerCommandDispatcher>();
builder.Services.AddSignalR();
builder.Services.AddHealthChecks();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddCors(options =>
{
    options.AddPolicy("web", policy => policy
        .WithOrigins("http://localhost:5173")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

var app = builder.Build();

if (builder.Configuration.GetValue("Database:ApplyMigrationsOnStartup", true))
    await DatabaseBootstrapper.InitializeAsync(app.Services);

app.UseCors("web");
app.MapHealthChecks("/health");
app.MapHub<PlayerHub>("/hubs/player");
app.MapOrchestrationEndpoints();

app.MapGet("/api/events", async (EventRegistry registry, CancellationToken cancellationToken) =>
{
    var events = await registry.GetEventsAsync(cancellationToken);
    return Results.Ok(events.Select(EventResponse.From));
});

app.MapGet("/api/events/{eventId:guid}", async (Guid eventId, EventRegistry registry, CancellationToken cancellationToken) =>
{
    var item = await registry.GetEventAsync(eventId, cancellationToken);
    return item is null ? Results.NotFound() : Results.Ok(EventResponse.From(item));
});

app.MapPost("/api/events", async (CreateEventRequest request, EventRegistry registry, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
        return Results.BadRequest(new { error = "Event name is required." });

    if (request.Name.Trim().Length > 200)
        return Results.BadRequest(new { error = "Event name cannot exceed 200 characters." });

    if (request.StartsAt.HasValue && request.EndsAt.HasValue && request.EndsAt <= request.StartsAt)
        return Results.BadRequest(new { error = "Event end must be after its start." });

    var item = await registry.CreateAsync(
        request.Name,
        request.TimeZone,
        request.StartsAt,
        request.EndsAt,
        cancellationToken);

    return Results.Created($"/api/events/{item.Id}", EventResponse.From(item));
});

app.MapGet("/api/events/{eventId:guid}/media", async (
    Guid eventId,
    MediaRegistry mediaRegistry,
    CancellationToken cancellationToken) =>
{
    var items = await mediaRegistry.GetForEventAsync(eventId, cancellationToken);
    return Results.Ok(items.Select(MediaResponse.From));
});

app.MapPost("/api/events/{eventId:guid}/media", async (
    Guid eventId,
    HttpRequest request,
    MediaRegistry mediaRegistry,
    CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
        return Results.BadRequest(new { error = "multipart/form-data is required." });

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
    if (file is null)
        return Results.BadRequest(new { error = "A media file is required." });

    await using var stream = file.OpenReadStream();
    var result = await mediaRegistry.UploadAsync(
        eventId,
        file.FileName,
        file.ContentType,
        form["name"].FirstOrDefault(),
        file.Length,
        stream,
        maxMediaUploadBytes,
        cancellationToken);

    if (result.Asset is null)
        return Results.BadRequest(new { error = result.Error });

    return Results.Created($"/api/media/{result.Asset.Id}", MediaResponse.From(result.Asset));
});

app.MapGet("/api/media/{mediaId:guid}", async (
    Guid mediaId,
    MediaRegistry mediaRegistry,
    CancellationToken cancellationToken) =>
{
    var item = await mediaRegistry.GetAsync(mediaId, cancellationToken);
    return item is null ? Results.NotFound() : Results.Ok(MediaResponse.From(item));
});

app.MapGet("/api/media/{mediaId:guid}/content", async (
    Guid mediaId,
    HttpResponse response,
    MediaRegistry mediaRegistry,
    IMediaStorage storage,
    CancellationToken cancellationToken) =>
{
    var item = await mediaRegistry.GetAsync(mediaId, cancellationToken);
    if (item is null)
        return Results.NotFound();

    var stream = await storage.OpenReadAsync(item.StorageKey, cancellationToken);
    if (stream is null)
        return Results.NotFound();

    response.Headers.CacheControl = "public, max-age=31536000, immutable";
    return Results.File(stream, item.MimeType, enableRangeProcessing: true);
});

app.MapDelete("/api/media/{mediaId:guid}", async (
    Guid mediaId,
    MediaRegistry mediaRegistry,
    CancellationToken cancellationToken) =>
{
    var deleted = await mediaRegistry.DeleteAsync(mediaId, cancellationToken);
    return deleted ? Results.NoContent() : Results.NotFound();
});

app.MapGet("/api/player/identity", async (HttpRequest request, DisplayRegistry registry, CancellationToken cancellationToken) =>
{
    var token = request.Headers["X-Device-Token"].ToString();
    var display = await registry.AuthenticateAsync(token, cancellationToken);
    return display is null ? Results.Unauthorized() : Results.Ok(DisplayResponse.From(display));
});

app.MapGet("/api/player/diagnostics", async (
    HttpRequest request,
    DisplayRegistry registry,
    CommandAcknowledgementRegistry acknowledgementRegistry,
    PlaybackStateRegistry playbackStateRegistry,
    CancellationToken cancellationToken) =>
{
    var token = request.Headers["X-Device-Token"].ToString();
    var display = await registry.AuthenticateAsync(token, cancellationToken);
    if (display is null)
        return Results.Unauthorized();

    var acknowledgements = await acknowledgementRegistry.GetLatestAsync(display.Id, 25, cancellationToken);
    var playback = await playbackStateRegistry.GetAsync(display.Id, cancellationToken);
    return Results.Ok(new
    {
        serverTime = DateTimeOffset.UtcNow,
        display = DisplayResponse.From(display, playback),
        playback,
        acknowledgements = acknowledgements.Select(x => new
        {
            x.CommandId,
            x.CommandType,
            x.Status,
            x.Detail,
            x.ClientTimestamp,
            x.ServerReceivedAt
        })
    });
});

app.MapPost("/api/player/pairing-session", async (DisplayRegistry registry, CancellationToken cancellationToken) =>
{
    var session = await registry.CreatePairingSessionAsync(cancellationToken);
    return Results.Ok(new
    {
        sessionToken = session.SessionToken,
        code = session.Code,
        expiresAt = session.ExpiresAt
    });
});

app.MapGet("/api/player/pairing-session/{sessionToken}", async (
    string sessionToken,
    DisplayRegistry registry,
    CancellationToken cancellationToken) =>
{
    var result = await registry.GetPairingResultAsync(sessionToken, cancellationToken);
    return result is null ? Results.NotFound() : Results.Ok(result);
});

app.MapGet("/api/pairing/pending", async (DisplayRegistry registry, CancellationToken cancellationToken) =>
{
    var pending = await registry.GetPendingPairingsAsync(cancellationToken);
    return Results.Ok(pending.Select(x => new
    {
        x.Code,
        x.CreatedAt,
        x.ExpiresAt
    }));
});

app.MapPost("/api/displays/pair", async (
    PairDisplayRequest request,
    DisplayRegistry registry,
    EventRegistry eventRegistry,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
        return Results.BadRequest(new { error = "Display name is required." });

    if (request.Name.Trim().Length > 200)
        return Results.BadRequest(new { error = "Display name cannot exceed 200 characters." });

    if (request.EventId == Guid.Empty)
        return Results.BadRequest(new { error = "Event is required." });

    if (await eventRegistry.GetEventAsync(request.EventId, cancellationToken) is null)
        return Results.NotFound(new { error = "Event was not found." });

    var display = await registry.PairAsync(request.Code, request.Name, request.EventId, cancellationToken);
    return display is null
        ? Results.NotFound(new { error = "Pairing code was not found or expired." })
        : Results.Ok(DisplayResponse.From(display));
});

app.MapGet("/api/displays", async (
    Guid? eventId,
    DisplayRegistry registry,
    PlaybackStateRegistry playbackStateRegistry,
    CancellationToken cancellationToken) =>
{
    var displays = await registry.GetDisplaysAsync(eventId, cancellationToken);
    var playback = await playbackStateRegistry.GetForDisplaysAsync(displays.Select(x => x.Id), cancellationToken);
    return Results.Ok(displays.Select(x => DisplayResponse.From(x, playback.GetValueOrDefault(x.Id))));
});

app.MapPost("/api/displays/{displayId:guid}/commands", async (
    Guid displayId,
    SendCommandRequest request,
    DisplayRegistry displayRegistry,
    MediaRegistry mediaRegistry,
    PlayerCommandDispatcher dispatcher,
    CancellationToken cancellationToken) =>
{
    var display = await displayRegistry.GetDisplayAsync(displayId, cancellationToken);
    if (display is null)
        return Results.NotFound();

    if (string.Equals(request.Type, "media.play", StringComparison.OrdinalIgnoreCase))
    {
        if (request.Payload is not { } payload ||
            payload.ValueKind != JsonValueKind.Object ||
            !payload.TryGetProperty("mediaId", out var mediaIdProperty) ||
            mediaIdProperty.ValueKind != JsonValueKind.String ||
            !Guid.TryParse(mediaIdProperty.GetString(), out var mediaId))
        {
            return Results.BadRequest(new { error = "media.play requires a valid mediaId." });
        }

        var media = await mediaRegistry.GetAsync(mediaId, cancellationToken);
        if (media is null || media.EventId != display.EventId)
            return Results.NotFound(new { error = "Media was not found for this display event." });

        var dispatch = await dispatcher.SendMediaPlayAsync([display.Id], media, cancellationToken);
        return Results.Accepted(value: dispatch);
    }

    var command = dispatcher.Create(request.Type, request.Payload);
    await dispatcher.SendAsync([display.Id], command, cancellationToken);
    return Results.Accepted(value: command);
});

app.Run();

public sealed record CreateEventRequest(
    string Name,
    string? TimeZone,
    DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt);

public sealed record PairDisplayRequest(string Code, string Name, Guid EventId);

public sealed record EventResponse(
    Guid Id,
    string Name,
    string Slug,
    DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt,
    string TimeZone,
    EventStatus Status,
    DateTimeOffset CreatedAt)
{
    public static EventResponse From(RevelEvent item) => new(
        item.Id,
        item.Name,
        item.Slug,
        item.StartsAt,
        item.EndsAt,
        item.TimeZone,
        item.Status,
        item.CreatedAt);
}

public sealed record DisplayResponse(
    Guid Id,
    Guid EventId,
    string Name,
    DisplayStatus Status,
    DateTimeOffset? LastSeenAt,
    double? ClockOffsetMs,
    double? RoundTripMs,
    DateTimeOffset? LastClockSyncAt,
    string? DesiredPlaybackState,
    string? ActualPlaybackState,
    string? PlaybackHealth,
    double? DriftMs,
    double? ActualPositionSeconds,
    DateTimeOffset? LastPlaybackReportAt,
    DateTimeOffset CreatedAt)
{
    public static DisplayResponse From(Display item, DisplayPlaybackState? playback = null) => new(
        item.Id,
        item.EventId,
        item.Name,
        item.Status,
        item.LastSeenAt,
        item.ClockOffsetMs,
        item.RoundTripMs,
        item.LastClockSyncAt,
        playback?.DesiredState,
        playback?.ActualState,
        playback?.Health,
        playback?.DriftMs,
        playback?.ActualPositionSeconds,
        playback?.ActualReportedAt,
        item.CreatedAt);
}

public sealed record MediaResponse(
    Guid Id,
    Guid EventId,
    string Name,
    MediaType Type,
    string MimeType,
    string FileName,
    long FileSize,
    double? DurationSeconds,
    int? Width,
    int? Height,
    string Checksum,
    DateTimeOffset CreatedAt,
    string ContentUrl)
{
    public static MediaResponse From(MediaAsset item) => new(
        item.Id,
        item.EventId,
        item.Name,
        item.Type,
        item.MimeType,
        item.FileName,
        item.FileSize,
        item.DurationSeconds,
        item.Width,
        item.Height,
        item.Checksum,
        item.CreatedAt,
        $"/api/media/{item.Id}/content");
}
