using System.Text.Json;
using RevelMovies.Api.Runtime;
using RevelMovies.Domain.Media;

namespace RevelMovies.Api.Endpoints;

public static class PromotionalBreakEndpoints
{
    public static IEndpointRouteBuilder MapPromotionalBreakEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPut("/events/{eventId:guid}/promotional-breaks", async (
            Guid eventId, ConfigurePromotionalBreaksRequest request,
            DisplayRegistry displays, DisplayGroupRegistry groups, PlaylistRegistry playlists,
            PlaybackStateRegistry playback, PlayerCommandDispatcher dispatcher, CancellationToken cancellationToken) =>
        {
            IReadOnlyList<Guid> targets;
            if (request.TargetType == "display")
            {
                var display = await displays.GetDisplayAsync(request.TargetId, cancellationToken);
                if (display?.EventId != eventId) return Results.NotFound(new { error = "La pantalla no pertenece a este evento." });
                targets = [display.Id];
            }
            else if (request.TargetType == "group")
            {
                var group = await groups.GetAsync(request.TargetId, cancellationToken);
                if (group?.EventId != eventId) return Results.NotFound(new { error = "El grupo no pertenece a este evento." });
                targets = await groups.GetDisplayIdsAsync(group.Id, cancellationToken);
                if (targets.Count == 0) return Results.BadRequest(new { error = "Agregá pantallas al grupo antes de configurar los cortes." });
            }
            else return Results.BadRequest(new { error = "Elegí una pantalla o un grupo." });

            PromotionPolicy policy;
            if (request.Enabled)
            {
                if (request.EveryVideos is < 1 or > 100)
                    return Results.BadRequest(new { error = "La frecuencia debe ser un número entero entre 1 y 100 videos." });
                var playlist = await playlists.GetViewAsync(request.PlaylistId ?? Guid.Empty, cancellationToken);
                if (playlist?.Playlist.EventId != eventId)
                    return Results.NotFound(new { error = "La playlist de promociones no pertenece a este evento." });
                if (playlist.Items.Count == 0 || playlist.Items.Any(item => item.Media.Type != MediaType.Video))
                    return Results.BadRequest(new { error = "Elegí una playlist de promociones que contenga únicamente videos y no esté vacía." });
                policy = new(Guid.NewGuid(), true, playlist.Playlist.Id, playlist.Playlist.Name, request.EveryVideos,
                    playlist.Items.Select(item => new PromotionItem(item.Media.Id, "Video", item.Media.FileSize)).ToArray());
            }
            else policy = new(Guid.NewGuid(), false, null, "", 5, []);

            await playback.SetPromotionPolicyAsync(targets, policy, cancellationToken);
            var command = dispatcher.Create("promotions.configure", JsonSerializer.SerializeToElement(policy, PromotionalBreaks.JsonOptions));
            await dispatcher.SendAsync(targets, command, cancellationToken);
            return Results.Accepted(value: new { command, targets = targets.Count });
        });
        return app;
    }
}

public sealed record ConfigurePromotionalBreaksRequest(string TargetType, Guid TargetId,
    bool Enabled, Guid? PlaylistId, int EveryVideos = 5);
