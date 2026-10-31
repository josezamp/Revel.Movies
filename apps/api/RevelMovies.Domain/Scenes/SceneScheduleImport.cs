namespace RevelMovies.Domain.Scenes;

// An immutable receipt makes retrying a lost HTTP response safe across process restarts.
public sealed class SceneScheduleImport
{
    public Guid EventId { get; set; }
    public string PackageHash { get; set; } = "";
    public string PreviewJson { get; set; } = "";
    public int SceneCount { get; set; }
    public int ScheduleCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
