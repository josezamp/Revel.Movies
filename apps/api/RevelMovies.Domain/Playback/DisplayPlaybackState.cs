namespace RevelMovies.Domain.Playback;

public sealed class DisplayPlaybackState
{
    public Guid DisplayId { get; set; }
    public string DesiredState { get; set; } = "Stopped";
    public string? ContentType { get; set; }
    public Guid? MediaAssetId { get; set; }
    public Guid? PlaylistId { get; set; }
    public string? PayloadJson { get; set; }
    public string? WebPageJson { get; set; }
    public string? AnnouncementJson { get; set; }
    public string? PromotionPolicyJson { get; set; }
    public string? PromotionProgressJson { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public double? PausedPositionSeconds { get; set; }
    public Guid? LastCommandId { get; set; }
    public long Revision { get; set; }
    public bool Blackout { get; set; }
    public Guid? ActualCommandId { get; set; }
    public string? ActualVisibleJson { get; set; }
    public Guid? SceneSessionId { get; set; }
    public DateTimeOffset? SceneExpiresAt { get; set; }

    public string ActualState { get; set; } = "Idle";
    public Guid? ActualMediaAssetId { get; set; }
    public Guid? ActualPlaylistId { get; set; }
    public int? ActualPlaylistIndex { get; set; }
    public double? ActualPositionSeconds { get; set; }
    public double? ActualDurationSeconds { get; set; }
    public DateTimeOffset? ActualReportedAt { get; set; }
    public double? DriftMs { get; set; }
    public string Health { get; set; } = "Unknown";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
