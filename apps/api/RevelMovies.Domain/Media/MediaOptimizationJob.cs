namespace RevelMovies.Domain.Media;

public sealed class MediaOptimizationJob
{
    // One current request per original. The output is an independent library asset.
    public Guid MediaId { get; set; }
    public Guid EventId { get; set; }
    public string SourceChecksum { get; set; } = "";
    public string SourceStorageKey { get; set; } = "";
    public long OriginalSize { get; set; }
    public string Status { get; set; } = "Queued";
    public int Progress { get; set; }
    public Guid? ResultMediaId { get; set; }
    public long? OptimizedSize { get; set; }
    public string? Error { get; set; }
    public Guid? LeaseId { get; set; }
    public DateTimeOffset? LeaseExpiresAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
