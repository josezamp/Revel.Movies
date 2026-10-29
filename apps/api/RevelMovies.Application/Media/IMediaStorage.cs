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

    IReadOnlyList<MediaStorageFile> ListEventFiles(Guid eventId);
    void RemoveEmptyEventDirectories(Guid eventId);
}

public sealed record StoredMediaFile(string StorageKey, long FileSize, string Checksum);
public sealed record MediaStorageFile(string StorageKey, long FileSize, long LastWriteTicks);
