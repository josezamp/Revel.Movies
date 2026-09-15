namespace RevelMovies.Domain.Displays;

public sealed class Display
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid EventId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string DeviceTokenHash { get; set; } = string.Empty;
    public int Rotation { get; set; }
    public DisplayStatus Status { get; set; } = DisplayStatus.Unknown;
    public DateTimeOffset? LastSeenAt { get; set; }
    public double? ClockOffsetMs { get; set; }
    public double? RoundTripMs { get; set; }
    public DateTimeOffset? LastClockSyncAt { get; set; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
