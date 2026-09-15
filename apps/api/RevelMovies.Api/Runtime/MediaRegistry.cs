using Microsoft.EntityFrameworkCore;
using RevelMovies.Application.Media;
using RevelMovies.Domain.Media;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class MediaRegistry(RevelMoviesDbContext db, IMediaStorage storage)
{
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
        CancellationToken cancellationToken = default)
    {
        if (!await db.Events.AnyAsync(x => x.Id == eventId, cancellationToken))
            return MediaUploadResult.Fail("Event was not found.");

        if (declaredLength <= 0)
            return MediaUploadResult.Fail("The uploaded file is empty.");

        if (declaredLength > maxUploadBytes)
            return MediaUploadResult.Fail($"The uploaded file exceeds the {FormatBytes(maxUploadBytes)} limit.");

        var safeFileName = Path.GetFileName(fileName);
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

        var name = string.IsNullOrWhiteSpace(requestedName)
            ? Path.GetFileNameWithoutExtension(safeFileName)
            : requestedName.Trim();

        if (string.IsNullOrWhiteSpace(name))
            name = safeFileName;

        if (name.Length > 200)
            return MediaUploadResult.Fail("Media name cannot exceed 200 characters.");

        if (safeFileName.Length > 260)
            return MediaUploadResult.Fail("File name cannot exceed 260 characters.");

        var asset = new MediaAsset
        {
            EventId = eventId,
            Name = name,
            Type = format.Type,
            MimeType = format.MimeType,
            FileName = safeFileName
        };

        StoredMediaFile? stored = null;
        try
        {
            stored = await storage.SaveAsync(eventId, asset.Id, extension, content, cancellationToken);
            asset.StorageKey = stored.StorageKey;
            asset.FileSize = stored.FileSize;
            asset.Checksum = stored.Checksum;

            db.MediaAssets.Add(asset);
            await db.SaveChangesAsync(cancellationToken);
            return MediaUploadResult.Success(asset);
        }
        catch
        {
            if (stored is not null)
                await storage.DeleteAsync(stored.StorageKey, CancellationToken.None);
            throw;
        }
    }

    public async Task<bool> DeleteAsync(Guid mediaId, CancellationToken cancellationToken = default)
    {
        var asset = await db.MediaAssets.FirstOrDefaultAsync(x => x.Id == mediaId, cancellationToken);
        if (asset is null)
            return false;

        await storage.DeleteAsync(asset.StorageKey, cancellationToken);
        db.MediaAssets.Remove(asset);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    private static string FormatBytes(long bytes) =>
        bytes >= 1024L * 1024 * 1024
            ? $"{bytes / (1024d * 1024 * 1024):0.#} GB"
            : $"{bytes / (1024d * 1024):0.#} MB";

    private sealed record MediaFormat(MediaType Type, string MimeType);
}

public sealed record MediaUploadResult(MediaAsset? Asset, string? Error)
{
    public static MediaUploadResult Success(MediaAsset asset) => new(asset, null);
    public static MediaUploadResult Fail(string error) => new(null, error);
}
