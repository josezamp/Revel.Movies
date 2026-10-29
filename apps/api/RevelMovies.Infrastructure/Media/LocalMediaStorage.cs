using System.Security.Cryptography;
using RevelMovies.Application.Media;

namespace RevelMovies.Infrastructure.Media;

public sealed class LocalMediaStorage : IMediaStorage
{
    private readonly string _rootPath;
    private readonly string _rootPrefix;

    public LocalMediaStorage(string rootPath)
    {
        _rootPath = Path.GetFullPath(rootPath);
        _rootPrefix = _rootPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        Directory.CreateDirectory(_rootPath);
    }

    public async Task<StoredMediaFile> SaveAsync(
        Guid eventId,
        Guid mediaId,
        string extension,
        Stream source,
        CancellationToken cancellationToken = default)
    {
        var normalizedExtension = extension.StartsWith('.') ? extension.ToLowerInvariant() : $".{extension.ToLowerInvariant()}";
        var storageKey = $"{eventId:N}/{mediaId:N}{normalizedExtension}";
        var path = ResolvePath(storageKey);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        var created = false;
        try
        {
            await using var destination = new FileStream(
                path,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                81920,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            created = true;

            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[81920];
            long total = 0;

            while (true)
            {
                var read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
                if (read == 0)
                    break;

                await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                hash.AppendData(buffer, 0, read);
                total += read;
            }

            var checksum = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
            return new StoredMediaFile(storageKey, total, checksum);
        }
        catch
        {
            // Dispose the stream before deleting a cancelled or failed partial upload on Windows.
            if (created && File.Exists(path)) File.Delete(path);
            throw;
        }
    }

    public Task<Stream?> OpenReadAsync(string storageKey, CancellationToken cancellationToken = default)
    {
        var path = ResolvePath(storageKey);
        if (!File.Exists(path))
            return Task.FromResult<Stream?>(null);

        Stream stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read | FileShare.Delete,
            81920,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        return Task.FromResult<Stream?>(stream);
    }

    public Task DeleteAsync(string storageKey, CancellationToken cancellationToken = default)
    {
        var path = new MediaDirectory(_rootPath).Resolve(storageKey);
        // File.Exists also returns false on access errors; deletion must report those failures.
        try { File.Delete(path); }
        catch (DirectoryNotFoundException) { /* Already deleted, including its event directory. */ }

        return Task.CompletedTask;
    }

    public IReadOnlyList<MediaStorageFile> ListEventFiles(Guid eventId) =>
        new MediaDirectory(_rootPath).ListFiles(eventId.ToString("N"));

    public void RemoveEmptyEventDirectories(Guid eventId) =>
        new MediaDirectory(_rootPath).RemoveEmptyDirectories(eventId.ToString("N"));

    private string ResolvePath(string storageKey)
    {
        var relativePath = storageKey.Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.GetFullPath(Path.Combine(_rootPath, relativePath));

        if (!fullPath.StartsWith(_rootPrefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The media storage key resolves outside the configured root path.");

        return fullPath;
    }
}
