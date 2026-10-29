using Microsoft.EntityFrameworkCore;
using RevelMovies.Application.Media;
using RevelMovies.Domain.Media;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class MediaRegistry(RevelMoviesDbContext db, IMediaStorage storage, ILogger<MediaRegistry> logger)
{
    // Bound the lock table; concurrent uploads for an event must agree on its file names.
    private static readonly SemaphoreSlim[] UploadLocks = Enumerable.Range(0, 64).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
    private static readonly IReadOnlyDictionary<string, MediaFormat> SupportedFormats =
        new Dictionary<string, MediaFormat>(StringComparer.OrdinalIgnoreCase)
        {
            [".mp4"] = new(MediaType.Video, "video/mp4"),
            [".jpg"] = new(MediaType.Image, "image/jpeg"),
            [".jpeg"] = new(MediaType.Image, "image/jpeg"),
            [".png"] = new(MediaType.Image, "image/png"),
            [".webp"] = new(MediaType.Image, "image/webp"),
            [".gif"] = new(MediaType.Image, "image/gif")
        };

    public async Task<IReadOnlyList<MediaAsset>> GetForEventAsync(
        Guid eventId,
        CancellationToken cancellationToken = default) =>
        await db.MediaAssets
            .AsNoTracking()
            .Where(x => x.EventId == eventId)
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync(cancellationToken);

    public Task<MediaAsset?> GetAsync(Guid mediaId, CancellationToken cancellationToken = default) =>
        db.MediaAssets.AsNoTracking().FirstOrDefaultAsync(x => x.Id == mediaId, cancellationToken);

    public async Task<MediaUploadResult> UploadAsync(
        Guid eventId,
        string fileName,
        string? suppliedContentType,
        string? requestedName,
        long declaredLength,
        Stream content,
        long maxUploadBytes,
        CancellationToken cancellationToken = default,
        Guid? replaceMediaId = null)
    {
        var gate = UploadLocks[(int)((uint)eventId.GetHashCode() % (uint)UploadLocks.Length)];
        await gate.WaitAsync(cancellationToken);
        try
        {
            return await UploadCoreAsync(eventId, fileName, suppliedContentType, requestedName, declaredLength,
                content, maxUploadBytes, replaceMediaId, cancellationToken);
        }
        finally { gate.Release(); }
    }

    private async Task<MediaUploadResult> UploadCoreAsync(Guid eventId, string fileName, string? suppliedContentType,
        string? requestedName, long declaredLength, Stream content, long maxUploadBytes, Guid? replaceMediaId,
        CancellationToken cancellationToken)
    {
        if (!await db.Events.AnyAsync(x => x.Id == eventId, cancellationToken))
            return MediaUploadResult.Fail("Event was not found.");

        if (declaredLength <= 0)
            return MediaUploadResult.Fail("The uploaded file is empty.");

        if (declaredLength > maxUploadBytes)
            return MediaUploadResult.Fail($"The uploaded file exceeds the {FormatBytes(maxUploadBytes)} limit.");

        var safeFileName = Path.GetFileName(fileName.Replace('\\', '/')).Trim();
        if (string.IsNullOrWhiteSpace(safeFileName))
            return MediaUploadResult.Fail("A valid file name is required.");

        var extension = Path.GetExtension(safeFileName);
        if (!SupportedFormats.TryGetValue(extension, out var format))
            return MediaUploadResult.Fail("Unsupported media format. Allowed: MP4, JPG, JPEG, PNG, WEBP and GIF.");

        if (!string.IsNullOrWhiteSpace(suppliedContentType) &&
            !string.Equals(suppliedContentType, "application/octet-stream", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(suppliedContentType, format.MimeType, StringComparison.OrdinalIgnoreCase))
        {
            return MediaUploadResult.Fail($"The file MIME type does not match the {extension} extension.");
        }

        if (!await HasExpectedSignatureAsync(extension, content, cancellationToken))
            return MediaUploadResult.Fail("The file contents do not match the selected media format.");

        var name = string.IsNullOrWhiteSpace(requestedName)
            ? Path.GetFileNameWithoutExtension(safeFileName)
            : requestedName.Trim();

        if (string.IsNullOrWhiteSpace(name))
            name = safeFileName;

        if (name.Length > 200)
            return MediaUploadResult.Fail("Media name cannot exceed 200 characters.");

        if (safeFileName.Length > 260)
            return MediaUploadResult.Fail("File name cannot exceed 260 characters.");

        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);
        var normalizedName = safeFileName.ToUpperInvariant();
        var matches = await db.MediaAssets.Where(x => x.EventId == eventId && x.FileName.Trim().ToUpper() == normalizedName)
            .ToListAsync(cancellationToken);
        var existing = replaceMediaId.HasValue ? matches.FirstOrDefault(x => x.Id == replaceMediaId.Value) : matches.FirstOrDefault();
        if (replaceMediaId.HasValue && existing is null)
            return MediaUploadResult.Fail("The file to replace no longer exists or has a different name.");
        if (existing is not null && !replaceMediaId.HasValue)
            return MediaUploadResult.Duplicate(existing);

        var asset = existing ?? new MediaAsset
        {
            EventId = eventId,
            Name = name,
            Type = format.Type,
            MimeType = format.MimeType,
            FileName = safeFileName
        };
        var previousKey = existing?.StorageKey;

        StoredMediaFile? stored = null;
        try
        {
            // Write a new physical file first: failed/cancelled replacements leave the old asset intact.
            stored = await storage.SaveAsync(eventId, Guid.NewGuid(), extension, content, cancellationToken);
            if (stored.FileSize > maxUploadBytes)
            {
                await storage.DeleteAsync(stored.StorageKey, cancellationToken);
                return MediaUploadResult.Fail($"The uploaded file exceeds the {FormatBytes(maxUploadBytes)} limit.");
            }

            asset.StorageKey = stored.StorageKey;
            asset.FileSize = stored.FileSize;
            asset.Checksum = stored.Checksum;
            asset.FileName = safeFileName;
            asset.MimeType = format.MimeType;
            asset.Type = format.Type;
            asset.DurationSeconds = null;
            asset.Width = null;
            asset.Height = null;
            if (!string.IsNullOrWhiteSpace(requestedName)) asset.Name = name;

            if (existing is null) db.MediaAssets.Add(asset);
            else
            {
                // Replacing a generated TV file makes it a new upload, not the previously validated conversion.
                await db.MediaOptimizationJobs.Where(x => x.ResultMediaId == asset.Id).ExecuteDeleteAsync(cancellationToken);
                var playlistIds = db.PlaylistItems.Where(x => x.MediaAssetId == asset.Id).Select(x => x.PlaylistId);
                var playlists = await db.Playlists.Where(x => playlistIds.Contains(x.Id)).ToListAsync(cancellationToken);
                foreach (var playlist in playlists) playlist.UpdatedAt = DateTimeOffset.UtcNow;
            }
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            if (stored is not null)
                await storage.DeleteAsync(stored.StorageKey, CancellationToken.None);
            throw;
        }
        // Cleanup is best effort after commit; its failure must not turn a saved upload into an error.
        if (previousKey is not null)
        {
            try { await storage.DeleteAsync(previousKey, CancellationToken.None); }
            catch (Exception ex) { logger.LogWarning(ex, "Could not remove replaced media file {StorageKey}", previousKey); }
        }
        return MediaUploadResult.Success(asset);
    }

    public async Task<bool> DeleteAsync(Guid mediaId, CancellationToken cancellationToken = default)
    {
        var asset = await db.MediaAssets.FirstOrDefaultAsync(x => x.Id == mediaId, cancellationToken);
        if (asset is null)
            return false;

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.PlaylistItems
            .Where(x => x.MediaAssetId == mediaId)
            .ExecuteDeleteAsync(cancellationToken);
        db.MediaAssets.Remove(asset);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await storage.DeleteAsync(asset.StorageKey, cancellationToken);
        return true;
    }

    private static async Task<bool> HasExpectedSignatureAsync(
        string extension,
        Stream content,
        CancellationToken cancellationToken)
    {
        if (!content.CanSeek)
            return true;

        var position = content.Position;
        var header = new byte[16];
        var read = await content.ReadAsync(header.AsMemory(0, header.Length), cancellationToken);
        content.Position = position;

        return extension.ToLowerInvariant() switch
        {
            ".mp4" => read >= 8 && header[4] == (byte)'f' && header[5] == (byte)'t' && header[6] == (byte)'y' && header[7] == (byte)'p',
            ".jpg" or ".jpeg" => read >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF,
            ".png" => read >= 8 && header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47 &&
                      header[4] == 0x0D && header[5] == 0x0A && header[6] == 0x1A && header[7] == 0x0A,
            ".gif" => read >= 6 && header[0] == (byte)'G' && header[1] == (byte)'I' && header[2] == (byte)'F' &&
                      header[3] == (byte)'8' && (header[4] == (byte)'7' || header[4] == (byte)'9') && header[5] == (byte)'a',
            ".webp" => read >= 12 && header[0] == (byte)'R' && header[1] == (byte)'I' && header[2] == (byte)'F' && header[3] == (byte)'F' &&
                       header[8] == (byte)'W' && header[9] == (byte)'E' && header[10] == (byte)'B' && header[11] == (byte)'P',
            _ => false
        };
    }

    private static string FormatBytes(long bytes) =>
        bytes >= 1024L * 1024 * 1024
            ? $"{bytes / (1024d * 1024 * 1024):0.#} GB"
            : $"{bytes / (1024d * 1024):0.#} MB";

    private sealed record MediaFormat(MediaType Type, string MimeType);
}

public sealed record MediaUploadResult(MediaAsset? Asset, string? Error, MediaAsset? Existing = null)
{
    public static MediaUploadResult Success(MediaAsset asset) => new(asset, null);
    public static MediaUploadResult Fail(string error) => new(null, error);
    public static MediaUploadResult Duplicate(MediaAsset existing) => new(null, "A file with this name already exists.", existing);
}
