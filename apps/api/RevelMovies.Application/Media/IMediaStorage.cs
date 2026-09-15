namespace RevelMovies.Application.Media;

public interface IMediaStorage
{
    Task<StoredMediaFile> SaveAsync(
        Guid eventId,
        Guid mediaId,
        string extension,
        Stream source,
        CancellationToken cancellationToken = default);

    Task<Stream?> OpenReadAsync(string storageKey, CancellationToken cancellationToken = default);

    Task DeleteAsync(string storageKey, CancellationToken cancellationToken = default);
}

public sealed record StoredMediaFile(string StorageKey, long FileSize, string Checksum);
