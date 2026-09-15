using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using RevelMovies.Api.Hubs;
using RevelMovies.Application.Commands;
using RevelMovies.Domain.Media;

namespace RevelMovies.Api.Runtime;

public sealed class PlayerCommandDispatcher(
    IHubContext<PlayerHub> hub,
    PlaybackStateRegistry playbackStateRegistry,
    IConfiguration configuration)
{
    private readonly int syncLeadTimeMs = Math.Clamp(
        configuration.GetValue("Playback:SyncLeadTimeMs", 2000),
        500,
        15_000);

    public PlayerCommand Create(string type, JsonElement? payload = null) => new(
        1,
        Guid.NewGuid(),
        type,
        DateTimeOffset.UtcNow,
        payload);

    public async Task SendAsync(
        IEnumerable<Guid> displayIds,
        PlayerCommand command,
        CancellationToken cancellationToken = default)
    {
        var targets = displayIds.Distinct().ToArray();
        await playbackStateRegistry.ApplyControlAsync(targets, command.Type, command.CommandId, cancellationToken);

        foreach (var displayId in targets)
            await hub.Clients.Group(PlayerHub.GroupName(displayId)).SendAsync("command", command, cancellationToken);
    }

    public async Task<SynchronizedDispatch> SendMediaPlayAsync(
        IEnumerable<Guid> displayIds,
        MediaAsset media,
        CancellationToken cancellationToken = default)
    {
        var targets = displayIds.Distinct().ToArray();
        var startAt = DateTimeOffset.UtcNow.AddMilliseconds(syncLeadTimeMs);
        var preparePayload = JsonSerializer.SerializeToElement(new
        {
            mediaId = media.Id,
            mediaType = media.Type.ToString(),
            fileSize = media.FileSize
        });

        var playPayload = JsonSerializer.SerializeToElement(new
        {
            mediaId = media.Id,
            mediaType = media.Type.ToString(),
            fileSize = media.FileSize,
            startAt
        });

        var prepare = Create("media.prepare", preparePayload);
        var play = Create("media.play", playPayload);

        await playbackStateRegistry.SetMediaPlayingAsync(targets, media, playPayload, startAt, play.CommandId, cancellationToken);
        await SendRawAsync(targets, prepare, cancellationToken);
        await SendRawAsync(targets, play, cancellationToken);
        return new SynchronizedDispatch(prepare, play, startAt, targets.Length);
    }

    public async Task<SynchronizedDispatch> SendPlaylistPlayAsync(
        IEnumerable<Guid> displayIds,
        Guid playlistId,
        bool loop,
        IReadOnlyList<PlaylistDispatchItem> items,
        CancellationToken cancellationToken = default)
    {
        var targets = displayIds.Distinct().ToArray();
        var startAt = DateTimeOffset.UtcNow.AddMilliseconds(syncLeadTimeMs);

        var serializedItems = items.Select(item => new
        {
            mediaId = item.MediaId,
            mediaType = item.MediaType,
            fileSize = item.FileSize,
            durationSeconds = item.DurationSeconds
        }).ToArray();

        var preparePayload = JsonSerializer.SerializeToElement(new
        {
            playlistId,
            items = serializedItems
        });

        var playPayload = JsonSerializer.SerializeToElement(new
        {
            playlistId,
            loop,
            items = serializedItems,
            startAt
        });

        var prepare = Create("playlist.prepare", preparePayload);
        var play = Create("playlist.play", playPayload);

        await playbackStateRegistry.SetPlaylistPlayingAsync(targets, playlistId, playPayload, startAt, play.CommandId, cancellationToken);
        await SendRawAsync(targets, prepare, cancellationToken);
        await SendRawAsync(targets, play, cancellationToken);
        return new SynchronizedDispatch(prepare, play, startAt, targets.Length);
    }

    private async Task SendRawAsync(
        IEnumerable<Guid> displayIds,
        PlayerCommand command,
        CancellationToken cancellationToken)
    {
        foreach (var displayId in displayIds.Distinct())
            await hub.Clients.Group(PlayerHub.GroupName(displayId)).SendAsync("command", command, cancellationToken);
    }
}

public sealed record PlaylistDispatchItem(
    Guid MediaId,
    string MediaType,
    long FileSize,
    double? DurationSeconds);

public sealed record SynchronizedDispatch(
    PlayerCommand PrepareCommand,
    PlayerCommand PlayCommand,
    DateTimeOffset StartAt,
    int Targets);
