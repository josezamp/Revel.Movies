namespace RevelMovies.Domain.Displays;

public sealed class Display
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string DeviceToken { get; init; } = Guid.NewGuid().ToString("N");
    public DisplayStatus Status { get; set; } = DisplayStatus.Unknown;
    public DateTimeOffset? LastSeenAt { get; set; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}
