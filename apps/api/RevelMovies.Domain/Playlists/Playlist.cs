namespace RevelMovies.Domain.Playlists;

public sealed class Playlist
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid EventId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool IsLoop { get; set; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
