using System.Text.Json;

namespace RevelMovies.Api.Runtime;

public sealed record SceneMedia(string Action = "keep", string? Type = null, Guid? MediaId = null, Guid? PlaylistId = null, bool? Loop = null,
    string? State = null, double? ResumePositionSeconds = null, int? ResumePlaylistIndex = null);
public sealed record SceneLayer(string Action = "keep", JsonElement? Payload = null);
public sealed record SceneAssignment(
    Guid[] DisplayIds, Guid[] GroupIds, SceneMedia Media, SceneLayer WebPage, SceneLayer Announcement,
    string Blackout = "keep", string Promotions = "keep");
public sealed record SaveSceneRequest(string Name, SceneAssignment[] Assignments, int? TemporaryDurationSeconds = null, int? Version = null);
public sealed record SceneOperationRequest(int Version, Guid[]? DisplayIds = null, Guid? PreparationId = null, string Policy = "all");
public sealed record SnapshotSceneRequest(string Name, Guid[] DisplayIds);
public sealed record SceneResponse(Guid Id, Guid EventId, string Name, int Version, SceneAssignment[] Assignments,
    int? TemporaryDurationSeconds, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record SceneResource(Guid MediaId, string MediaType, long FileSize);
public sealed record SceneComposition(string Media, string WebPage, string Announcement, string Blackout, string Promotions);
public sealed class SceneTargetResult
{
    public Guid DisplayId { get; set; }
    public string DisplayName { get; set; } = "";
    public Guid CommandId { get; set; }
    public string Status { get; set; } = "pending";
    public string? Detail { get; set; }
    public DateTimeOffset? ReportedAt { get; set; }
    public long AppliedRevision { get; set; }
    public bool Restoring { get; set; }
    public PlaybackRecoveryState? Previous { get; set; }
    public SceneComposition? Composition { get; set; }
}
public sealed record SceneTargetResponse(Guid DisplayId, string DisplayName, Guid CommandId, string Status,
    string? Detail, DateTimeOffset? ReportedAt, long AppliedRevision);
public sealed record SceneSessionResponse(Guid Id, Guid SceneId, int Version, string Kind, string Status,
    SceneTargetResponse[] Targets, DateTimeOffset CreatedAt, DateTimeOffset? ExpiresAt);
