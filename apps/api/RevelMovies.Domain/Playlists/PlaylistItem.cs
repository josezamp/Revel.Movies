namespace RevelMovies.Domain.Playlists;

public sealed class PlaylistItem
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid PlaylistId { get; set; }
    public Guid MediaAssetId { get; set; }
    public int Position { get; set; }
    public double? DurationSeconds { get; set; }
}
