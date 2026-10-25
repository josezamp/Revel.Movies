namespace RevelMovies.Domain.Scenes;

public sealed class Scene
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EventId { get; set; }
    public string Name { get; set; } = "";
    public int Version { get; set; } = 1;
    public string AssignmentsJson { get; set; } = "[]";
    public int? TemporaryDurationSeconds { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class SceneSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EventId { get; set; }
    public Guid SceneId { get; set; }
    public int Version { get; set; }
    public string Kind { get; set; } = "prepare";
    public string Status { get; set; } = "preparing";
    public string TargetsJson { get; set; } = "[]";
    public string Fingerprint { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset? RestoredAt { get; set; }
}
