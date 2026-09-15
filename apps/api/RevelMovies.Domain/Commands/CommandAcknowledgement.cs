namespace RevelMovies.Domain.Commands;

public sealed class CommandAcknowledgement
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid DisplayId { get; set; }
    public Guid CommandId { get; set; }
    public string CommandType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Detail { get; set; }
    public DateTimeOffset? ClientTimestamp { get; set; }
    public DateTimeOffset ServerReceivedAt { get; set; } = DateTimeOffset.UtcNow;
}
