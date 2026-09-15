using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Playback;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class PlaybackStateRegistry(RevelMoviesDbContext db)
{
    private const double DriftCorrectionThresholdMs = 500;

    public async Task<IReadOnlyDictionary<Guid, DisplayPlaybackState>> GetForDisplaysAsync(
        IEnumerable<Guid> displayIds,
        CancellationToken cancellationToken = default)
    {
        var ids = displayIds.Distinct().ToArray();
        if (ids.Length == 0)
            return new Dictionary<Guid, DisplayPlaybackState>();

        return await db.DisplayPlaybackStates
            .AsNoTracking()
            .Where(x => ids.Contains(x.DisplayId))
            .ToDictionaryAsync(x => x.DisplayId, cancellationToken);
    }

    public Task<DisplayPlaybackState?> GetAsync(Guid displayId, CancellationToken cancellationToken = default) =>
        db.DisplayPlaybackStates.AsNoTracking().FirstOrDefaultAsync(x => x.DisplayId == displayId, cancellationToken);

    public async Task SetMediaPlayingAsync(
        IEnumerable<Guid> displayIds,
        MediaAsset media,
        JsonElement payload,
        DateTimeOffset startedAt,
        Guid commandId,
        CancellationToken cancellationToken = default)
    {
        foreach (var state in await GetOrCreateAsync(displayIds, cancellationToken))
        {
            state.DesiredState = "Playing";
            state.ContentType = "Media";
            state.MediaAssetId = media.Id;
            state.PlaylistId = null;
            state.PayloadJson = payload.GetRawText();
            state.StartedAt = startedAt;
            state.PausedPositionSeconds = null;
            state.LastCommandId = commandId;
            state.Health = "Starting";
            state.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task SetPlaylistPlayingAsync(
        IEnumerable<Guid> displayIds,
        Guid playlistId,
        JsonElement payload,
        DateTimeOffset startedAt,
        Guid commandId,
        CancellationToken cancellationToken = default)
    {
        foreach (var state in await GetOrCreateAsync(displayIds, cancellationToken))
        {
            state.DesiredState = "Playing";
            state.ContentType = "Playlist";
            state.MediaAssetId = null;
            state.PlaylistId = playlistId;
            state.PayloadJson = payload.GetRawText();
            state.StartedAt = startedAt;
            state.PausedPositionSeconds = null;
            state.LastCommandId = commandId;
            state.Health = "Starting";
            state.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task ApplyControlAsync(
        IEnumerable<Guid> displayIds,
        string commandType,
        Guid commandId,
        CancellationToken cancellationToken = default)
    {
        var normalized = commandType.ToLowerInvariant();
        if (normalized is not ("media.pause" or "playlist.pause" or "media.stop" or "playlist.stop" or "display.blackout"))
            return;

        var now = DateTimeOffset.UtcNow;
        foreach (var state in await GetOrCreateAsync(displayIds, cancellationToken))
        {
            if (normalized.EndsWith(".pause", StringComparison.Ordinal))
            {
                state.PausedPositionSeconds = CalculateExpectedPosition(state, now) ?? state.ActualPositionSeconds;
                state.DesiredState = "Paused";
                state.Health = "Paused";
            }
            else if (normalized.EndsWith(".stop", StringComparison.Ordinal))
            {
                state.DesiredState = "Stopped";
                state.ContentType = null;
                state.MediaAssetId = null;
                state.PlaylistId = null;
                state.PayloadJson = null;
                state.StartedAt = null;
                state.PausedPositionSeconds = null;
                state.Health = "Stopped";
            }
            else if (normalized == "display.blackout")
            {
                state.DesiredState = "Blackout";
                state.Health = "Blackout";
            }

            state.LastCommandId = commandId;
            state.UpdatedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<PlaybackReportResult> ReportAsync(
        Guid displayId,
        PlaybackTelemetryReport report,
        CancellationToken cancellationToken = default)
    {
        var state = await db.DisplayPlaybackStates.FirstOrDefaultAsync(x => x.DisplayId == displayId, cancellationToken)
            ?? new DisplayPlaybackState { DisplayId = displayId };

        if (db.Entry(state).State == EntityState.Detached)
            db.DisplayPlaybackStates.Add(state);

        var now = DateTimeOffset.UtcNow;
        state.ActualState = string.IsNullOrWhiteSpace(report.State) ? "Unknown" : report.State.Trim();
        state.ActualMediaAssetId = report.MediaAssetId;
        state.ActualPlaylistId = report.PlaylistId;
        state.ActualPlaylistIndex = report.PlaylistIndex;
        state.ActualPositionSeconds = Math.Max(0, report.PositionSeconds);
        state.ActualDurationSeconds = report.DurationSeconds is > 0 ? report.DurationSeconds : null;
        state.ActualReportedAt = now;

        double? correction = null;
        if (state.DesiredState == "Playing" &&
            state.ContentType == "Media" &&
            state.MediaAssetId.HasValue &&
            state.MediaAssetId == report.MediaAssetId &&
            state.StartedAt.HasValue)
        {
            var expected = Math.Max(0, (now - state.StartedAt.Value).TotalSeconds);
            var driftMs = (state.ActualPositionSeconds.Value - expected) * 1000d;
            state.DriftMs = driftMs;
            state.Health = Math.Abs(driftMs) > DriftCorrectionThresholdMs ? "Drifted" : "Synchronized";

            if (string.Equals(state.ActualState, "Playing", StringComparison.OrdinalIgnoreCase) &&
                Math.Abs(driftMs) > DriftCorrectionThresholdMs)
            {
                correction = expected;
                state.Health = "Correcting";
            }
        }
        else if (state.DesiredState == "Playing")
        {
            state.DriftMs = null;
            state.Health = state.ContentType == "Playlist" ? "Playing" : "Recovering";
        }
        else
        {
            state.DriftMs = null;
            state.Health = state.DesiredState;
        }

        state.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        return new PlaybackReportResult(correction, state.DriftMs, state.Health);
    }

    public async Task<PlaybackRecoveryState?> GetRecoveryAsync(
        Guid displayId,
        CancellationToken cancellationToken = default)
    {
        var state = await db.DisplayPlaybackStates.AsNoTracking()
            .FirstOrDefaultAsync(x => x.DisplayId == displayId, cancellationToken);
        if (state is null)
            return null;

        JsonElement? payload = null;
        if (!string.IsNullOrWhiteSpace(state.PayloadJson))
        {
            using var document = JsonDocument.Parse(state.PayloadJson);
            payload = document.RootElement.Clone();
        }

        var now = DateTimeOffset.UtcNow;
        double? resumePosition = null;
        int? resumePlaylistIndex = null;

        if (state.DesiredState == "Paused")
        {
            resumePosition = state.PausedPositionSeconds ?? state.ActualPositionSeconds;
            resumePlaylistIndex = state.ActualPlaylistIndex;
        }
        else if (state.DesiredState == "Playing" && state.ContentType == "Media")
        {
            resumePosition = CalculateExpectedPosition(state, now);
        }
        else if (state.DesiredState == "Playing" && state.ContentType == "Playlist")
        {
            resumePlaylistIndex = state.ActualPlaylistIndex ?? 0;
            resumePosition = state.ActualPositionSeconds ?? 0;
            if (state.ActualReportedAt.HasValue && string.Equals(state.ActualState, "Playing", StringComparison.OrdinalIgnoreCase))
                resumePosition += Math.Max(0, (now - state.ActualReportedAt.Value).TotalSeconds);
        }

        return new PlaybackRecoveryState(
            state.DesiredState,
            state.ContentType,
            payload,
            resumePosition,
            resumePlaylistIndex,
            state.Health,
            state.DriftMs,
            state.UpdatedAt);
    }

    private async Task<IReadOnlyList<DisplayPlaybackState>> GetOrCreateAsync(
        IEnumerable<Guid> displayIds,
        CancellationToken cancellationToken)
    {
        var ids = displayIds.Distinct().ToArray();
        var existing = await db.DisplayPlaybackStates.Where(x => ids.Contains(x.DisplayId)).ToListAsync(cancellationToken);
        var existingIds = existing.Select(x => x.DisplayId).ToHashSet();

        foreach (var id in ids.Where(id => !existingIds.Contains(id)))
        {
            var state = new DisplayPlaybackState { DisplayId = id };
            db.DisplayPlaybackStates.Add(state);
            existing.Add(state);
        }

        return existing;
    }

    private static double? CalculateExpectedPosition(DisplayPlaybackState state, DateTimeOffset now)
    {
        if (state.DesiredState == "Paused")
            return state.PausedPositionSeconds;
        if (!state.StartedAt.HasValue)
            return state.ActualPositionSeconds;
        return Math.Max(0, (now - state.StartedAt.Value).TotalSeconds);
    }
}

public sealed record PlaybackTelemetryReport(
    string State,
    Guid? MediaAssetId,
    Guid? PlaylistId,
    int? PlaylistIndex,
    double PositionSeconds,
    double? DurationSeconds);

public sealed record PlaybackReportResult(double? SeekToSeconds, double? DriftMs, string Health);

public sealed record PlaybackRecoveryState(
    string DesiredState,
    string? ContentType,
    JsonElement? Payload,
    double? ResumePositionSeconds,
    int? ResumePlaylistIndex,
    string Health,
    double? DriftMs,
    DateTimeOffset UpdatedAt);
