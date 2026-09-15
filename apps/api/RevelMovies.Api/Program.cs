using Microsoft.AspNetCore.SignalR;
using RevelMovies.Api.Hubs;
using RevelMovies.Api.Runtime;
using RevelMovies.Application.Commands;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddHealthChecks();
builder.Services.AddSingleton<DisplayRegistry>();
builder.Services.AddCors(options =>
{
    options.AddPolicy("web", policy => policy
        .WithOrigins("http://localhost:5173")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

var app = builder.Build();

app.UseCors("web");
app.MapHealthChecks("/health");
app.MapHub<PlayerHub>("/hubs/player");

app.MapPost("/api/player/pairing-session", (DisplayRegistry registry) =>
{
    var session = registry.CreatePairingSession();
    return Results.Ok(new
    {
        sessionToken = session.SessionToken,
        code = session.Code,
        expiresAt = session.ExpiresAt
    });
});

app.MapGet("/api/player/pairing-session/{sessionToken}", (string sessionToken, DisplayRegistry registry) =>
{
    var result = registry.GetPairingResult(sessionToken);
    return result is null ? Results.NotFound() : Results.Ok(result);
});

app.MapGet("/api/pairing/pending", (DisplayRegistry registry) =>
    Results.Ok(registry.GetPendingPairings().Select(x => new
    {
        x.Code,
        x.CreatedAt,
        x.ExpiresAt
    })));

app.MapPost("/api/displays/pair", (PairDisplayRequest request, DisplayRegistry registry) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
        return Results.BadRequest(new { error = "Display name is required." });

    var display = registry.Pair(request.Code, request.Name);
    return display is null
        ? Results.NotFound(new { error = "Pairing code was not found or expired." })
        : Results.Ok(display);
});

app.MapGet("/api/displays", (DisplayRegistry registry) => Results.Ok(registry.GetDisplays()));

app.MapPost("/api/displays/{displayId:guid}/commands", async (
    Guid displayId,
    SendCommandRequest request,
    DisplayRegistry registry,
    IHubContext<PlayerHub> hub) =>
{
    if (registry.GetDisplay(displayId) is null)
        return Results.NotFound();

    var command = new PlayerCommand(
        1,
        Guid.NewGuid(),
        request.Type,
        DateTimeOffset.UtcNow,
        request.Payload);

    await hub.Clients.Group(PlayerHub.GroupName(displayId)).SendAsync("command", command);
    return Results.Accepted(value: command);
});

app.Run();

public sealed record PairDisplayRequest(string Code, string Name);
