namespace RevelMovies.Domain.Scenes;

public sealed class SceneSchedule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EventId { get; set; }
    public Guid SceneId { get; set; }
    public string SceneName { get; set; } = "";
    public int SceneVersion { get; set; }
    public string Fingerprint { get; set; } = "";
    public DateTimeOffset StartsAt { get; set; }
    public string LocalStartsAt { get; set; } = "";
    public string TimeZone { get; set; } = "UTC";
    public string Policy { get; set; } = "available";
    public string Status { get; set; } = "scheduled";
    public string? Detail { get; set; }
    public string TargetsJson { get; set; } = "[]";
    public Guid? PreparationId { get; set; }
    public DateTimeOffset? LastPreparationAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public int Version { get; set; } = 1;
}
