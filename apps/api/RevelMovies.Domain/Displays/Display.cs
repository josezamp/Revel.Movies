namespace RevelMovies.Domain.Displays;

public sealed class Display
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid EventId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string DeviceTokenHash { get; set; } = string.Empty;
    public DisplayStatus Status { get; set; } = DisplayStatus.Unknown;
    public DateTimeOffset? LastSeenAt { get; set; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
