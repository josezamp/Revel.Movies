using System.Text.Json;
using RevelMovies.Domain.Playback;

namespace RevelMovies.Api.Runtime;

public sealed record PromotionItem(Guid MediaId, string MediaType, long FileSize);
public sealed record PromotionPolicy(Guid Id, bool Enabled, Guid? PlaylistId, string PlaylistName,
    int EveryVideos, IReadOnlyList<PromotionItem> Items);
public sealed record PromotionProgress(string PlaybackId, Guid? PolicyId, int CompletedVideos,
    int NextPromotionIndex, Guid? ActiveMediaId, long Sequence);

public static class PromotionalBreaks
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static PromotionPolicy? ReadPolicy(DisplayPlaybackState? state) =>
        state?.PromotionPolicyJson is { } json ? JsonSerializer.Deserialize<PromotionPolicy>(json, JsonOptions) : null;

    public static PromotionProgress? ReadProgress(DisplayPlaybackState? state)
    {
        var progress = state?.PromotionProgressJson is { } json
            ? JsonSerializer.Deserialize<PromotionProgress>(json, JsonOptions) : null;
        return progress?.PlaybackId == PlaybackId(state) ? progress : null;
    }

    public static string? PlaybackId(DisplayPlaybackState? state)
    {
        if (state?.ContentType != "Playlist" || state.PayloadJson is null) return null;
        using var document = JsonDocument.Parse(state.PayloadJson);
        var payload = document.RootElement;
        return payload.TryGetProperty("playbackId", out var id) ? id.GetString() : state.PlaylistId?.ToString();
    }
}
