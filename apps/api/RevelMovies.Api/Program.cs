using System.Text.Json.Serialization;
using Microsoft.AspNetCore.SignalR;
using RevelMovies.Api.Hubs;
using RevelMovies.Api.Runtime;
using RevelMovies.Application.Commands;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Events;
using RevelMovies.Infrastructure;
using RevelMovies.Infrastructure.Persistence;
using RevelEvent = RevelMovies.Domain.Events.Event;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("RevelMovies")
    ?? throw new InvalidOperationException("Connection string 'RevelMovies' is required.");

builder.Services.AddRevelMoviesInfrastructure(connectionString);
builder.Services.AddScoped<DisplayRegistry>();
builder.Services.AddScoped<EventRegistry>();
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

app.MapGet("/api/player/identity", async (HttpRequest request, DisplayRegistry registry, CancellationToken cancellationToken) =>
{
    var token = request.Headers["X-Device-Token"].ToString();
    var display = await registry.AuthenticateAsync(token, cancellationToken);
    return display is null ? Results.Unauthorized() : Results.Ok(DisplayResponse.From(display));
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

app.MapGet("/api/displays", async (Guid? eventId, DisplayRegistry registry, CancellationToken cancellationToken) =>
{
    var displays = await registry.GetDisplaysAsync(eventId, cancellationToken);
    return Results.Ok(displays.Select(DisplayResponse.From));
});

app.MapPost("/api/displays/{displayId:guid}/commands", async (
    Guid displayId,
    SendCommandRequest request,
    DisplayRegistry registry,
    IHubContext<PlayerHub> hub,
    CancellationToken cancellationToken) =>
{
    if (await registry.GetDisplayAsync(displayId, cancellationToken) is null)
        return Results.NotFound();

    var command = new PlayerCommand(
        1,
        Guid.NewGuid(),
        request.Type,
        DateTimeOffset.UtcNow,
        request.Payload);

    await hub.Clients.Group(PlayerHub.GroupName(displayId)).SendAsync("command", command, cancellationToken);
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
    DateTimeOffset CreatedAt)
{
    public static DisplayResponse From(Display item) => new(
        item.Id,
        item.EventId,
        item.Name,
        item.Status,
        item.LastSeenAt,
        item.CreatedAt);
}
