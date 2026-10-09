using System.Text.Json;
using System.Text.Json.Nodes;
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

    public async Task SetAnnouncementAsync(
        IEnumerable<Guid> displayIds,
        JsonElement? payload,
        CancellationToken cancellationToken = default)
    {
        foreach (var state in await GetOrCreateAsync(displayIds, cancellationToken))
        {
            state.AnnouncementJson = payload?.GetRawText();
            state.UpdatedAt = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(cancellationToken);
    }

    public static JsonElement? ReadAnnouncement(DisplayPlaybackState? state) =>
        state?.AnnouncementJson is { } json ? JsonSerializer.Deserialize<JsonElement>(json) : null;

    public async Task SetPromotionPolicyAsync(IEnumerable<Guid> displayIds, PromotionPolicy policy,
        CancellationToken cancellationToken = default)
    {
        foreach (var state in await GetOrCreateAsync(displayIds, cancellationToken))
        {
            state.PromotionPolicyJson = JsonSerializer.Serialize(policy, PromotionalBreaks.JsonOptions);
            // Keep the current clip checkpoint: replacing/disabling must let it finish.
            state.UpdatedAt = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<PlaybackReportResult> ReportPlaylistAsync(Guid displayId, PlaybackTelemetryReport report,
        PromotionProgress progress, CancellationToken cancellationToken = default)
    {
        var state = await db.DisplayPlaybackStates.FirstOrDefaultAsync(x => x.DisplayId == displayId, cancellationToken);
        var policy = PromotionalBreaks.ReadPolicy(state);
        var previous = PromotionalBreaks.ReadProgress(state);
        var ignored = new PlaybackReportResult(null, null, state?.Health ?? "Unknown");
        // A delayed report must never restore an old session, policy or completed promotion.
        if (state is null || progress is null || report is null || state.ContentType != "Playlist" ||
            string.IsNullOrWhiteSpace(progress.PlaybackId) || state.DesiredState == "Stopped" ||
            (state.DesiredState == "Paused" && report.State != "Paused") ||
            progress.PlaybackId != PromotionalBreaks.PlaybackId(state) || report.PlaylistId != state.PlaylistId ||
            progress.PolicyId != policy?.Id || progress.Sequence < 0 ||
            (previous is not null && progress.Sequence <= previous.Sequence) ||
            progress.CompletedVideos < 0 || progress.CompletedVideos >= (policy?.EveryVideos ?? 100) ||
            progress.NextPromotionIndex < 0 || progress.NextPromotionIndex >= Math.Max(1, policy?.Items.Count ?? 0) ||
            !double.IsFinite(report.PositionSeconds) || report.PositionSeconds < 0 ||
            (report.DurationSeconds.HasValue && (!double.IsFinite(report.DurationSeconds.Value) || report.DurationSeconds <= 0)))
            return ignored;

        using var payload = JsonDocument.Parse(state.PayloadJson!);
        if (!payload.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array ||
            report.PlaylistIndex is not { } index || index < 0 || index >= items.GetArrayLength()) return ignored;
        if (progress.ActiveMediaId is { } active)
        {
            if (report.MediaAssetId != active || !await (
                from media in db.MediaAssets
                join display in db.Displays on media.EventId equals display.EventId
                where display.Id == displayId && media.Id == active && media.Type == MediaType.Video
                select media.Id).AnyAsync(cancellationToken)) return ignored;
        }
        else if (items[index].GetProperty("mediaId").GetGuid() != report.MediaAssetId) return ignored;

        state.PromotionProgressJson = JsonSerializer.Serialize(progress, PromotionalBreaks.JsonOptions);
        return await ReportAsync(displayId, report, cancellationToken);
    }

    public static bool ReadLoop(DisplayPlaybackState? state) =>
        state?.PayloadJson is { } json &&
        JsonSerializer.Deserialize<JsonElement>(json) is { ValueKind: JsonValueKind.Object } payload &&
        payload.TryGetProperty("loop", out var loop) && loop.ValueKind == JsonValueKind.True;

    public async Task<bool> SetLoopAsync(Guid displayId, bool loop, Guid commandId, CancellationToken cancellationToken = default)
    {
        var state = await db.DisplayPlaybackStates.FirstOrDefaultAsync(x => x.DisplayId == displayId, cancellationToken);
        if (state?.PayloadJson is not { } json || JsonNode.Parse(json) is not JsonObject payload)
            return false;

        // Rebase the clock when toggling a video that has already completed one or more loops.
        var now = DateTimeOffset.UtcNow;
        if (state.ContentType == "Media" && state.DesiredState == "Playing" && state.StartedAt <= now)
            state.StartedAt = now.AddSeconds(-(CalculateExpectedPosition(state, now) ?? 0));
        payload["loop"] = loop;
        state.PayloadJson = payload.ToJsonString();
        state.LastCommandId = commandId;
        state.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<PlaybackRecoveryState?> ResumeAsync(Guid displayId, Guid commandId, CancellationToken cancellationToken = default)
    {
        var state = await db.DisplayPlaybackStates.FirstOrDefaultAsync(x => x.DisplayId == displayId, cancellationToken);
        if (state?.PayloadJson is null || state.ContentType is not ("Media" or "Playlist"))
            return null;

        if (state.ContentType == "Media" && !await db.MediaAssets.AnyAsync(x => x.Id == state.MediaAssetId, cancellationToken))
            return null;

        var now = DateTimeOffset.UtcNow;
        var restart = state.DesiredState == "Stopped";
        var position = restart ? 0 : CalculateExpectedPosition(state, now) ?? 0;
        var index = restart ? 0 : state.ActualPlaylistIndex ?? 0;
        var payload = JsonNode.Parse(state.PayloadJson)!.AsObject();
        if (restart)
        {
            state.PromotionProgressJson = null;
            if (state.ContentType == "Playlist") payload["playbackId"] = Guid.NewGuid().ToString();
        }
        // Keep a recovery checkpoint until the player reports the resumed playlist.
        payload["resumePlaylistIndex"] = index;
        payload["resumePositionSeconds"] = position;
        state.PayloadJson = payload.ToJsonString();
        state.DesiredState = "Playing";
        state.StartedAt = now.AddSeconds(-position);
        state.PausedPositionSeconds = null;
        state.LastCommandId = commandId;
        state.Health = "Starting";
        state.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return new PlaybackRecoveryState("Playing", state.ContentType,
            JsonSerializer.Deserialize<JsonElement>(state.PayloadJson), position, index,
            state.Health, null, now, ReadAnnouncement(state), PromotionalBreaks.ReadPolicy(state), PromotionalBreaks.ReadProgress(state));
    }

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
            state.PromotionProgressJson = null;
            state.MediaAssetId = media.Id;
            state.PlaylistId = null;
            state.PayloadJson = payload.GetRawText();
            state.StartedAt = startedAt;
            state.PausedPositionSeconds = null;
            state.ActualDurationSeconds = null;
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
            state.PromotionProgressJson = null;
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
                state.PromotionProgressJson = null;
                // Keep the assigned content so Play can start it again from the display card.
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

        if (state.DesiredState == "Playing" && report.State == "Ended" && state.StartedAt <= now &&
            ((state.ContentType == "Media" && state.MediaAssetId == report.MediaAssetId) ||
             (state.ContentType == "Playlist" && state.PlaylistId == report.PlaylistId)))
        {
            state.DesiredState = "Stopped";
            state.StartedAt = null;
            state.PausedPositionSeconds = null;
        }

        double? correction = null;
        if (state.DesiredState == "Playing" && string.Equals(state.ActualState, "Buffering", StringComparison.OrdinalIgnoreCase))
        {
            state.DriftMs = null;
            state.Health = "Buffering";
        }
        else if (state.DesiredState == "Playing" &&
            state.ContentType == "Media" &&
            state.MediaAssetId.HasValue &&
            state.MediaAssetId == report.MediaAssetId &&
            state.StartedAt.HasValue)
        {
            var expected = CalculateExpectedPosition(state, now) ?? 0;
            var driftMs = (state.ActualPositionSeconds.Value - expected) * 1000d;
            if (ReadLoop(state) && state.ActualDurationSeconds is > 0)
            {
                var durationMs = state.ActualDurationSeconds.Value * 1000d;
                driftMs = (driftMs + durationMs * 1.5) % durationMs - durationMs / 2;
            }
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
            if (state.Health == "Starting")
            {
                resumePlaylistIndex = payload?.TryGetProperty("resumePlaylistIndex", out var index) == true ? index.GetInt32() : 0;
                resumePosition = payload?.TryGetProperty("resumePositionSeconds", out var position) == true ? position.GetDouble() : 0;
            }
            else
            {
                resumePlaylistIndex = state.ActualPlaylistIndex ?? 0;
                resumePosition = state.ActualPositionSeconds ?? 0;
                if (PromotionalBreaks.ReadProgress(state) is null && state.ActualReportedAt.HasValue && string.Equals(state.ActualState, "Playing", StringComparison.OrdinalIgnoreCase))
                    resumePosition += Math.Max(0, (now - state.ActualReportedAt.Value).TotalSeconds);
            }
        }

        return new PlaybackRecoveryState(
            state.DesiredState,
            state.ContentType,
            payload,
            resumePosition,
            resumePlaylistIndex,
            state.Health,
            state.DriftMs,
            state.UpdatedAt,
            ReadAnnouncement(state),
            PromotionalBreaks.ReadPolicy(state),
            PromotionalBreaks.ReadProgress(state));
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
        if (state.ContentType == "Playlist")
            return state.ActualPositionSeconds ?? 0;
        if (!state.StartedAt.HasValue)
            return state.ActualPositionSeconds;
        var position = Math.Max(0, (now - state.StartedAt.Value).TotalSeconds);
        if (state.ActualDurationSeconds is > 0)
            return ReadLoop(state) ? position % state.ActualDurationSeconds.Value : Math.Min(position, state.ActualDurationSeconds.Value);
        return position;
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
    DateTimeOffset UpdatedAt,
    JsonElement? Announcement,
    PromotionPolicy? PromotionPolicy = null,
    PromotionProgress? PromotionProgress = null);
