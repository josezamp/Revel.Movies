using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using RevelMovies.Application.Media;
using RevelMovies.Domain.Media;
using RevelMovies.Infrastructure.Media;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class MediaCleanupService(RevelMoviesDbContext db, IMediaStorage storage,
    TvOptimizationOptions options, PlayerCommandDispatcher dispatcher, ILogger<MediaCleanupService> logger)
{
    private readonly MediaDirectory work = new(options.WorkPath);

    public async Task<MediaCleanupPreview?> PreviewAsync(Guid eventId, CancellationToken token)
    {
        var inventory = await InventoryAsync(eventId, token);
        return inventory?.Preview;
    }

    private async Task<Inventory?> InventoryAsync(Guid eventId, CancellationToken token)
    {
        var name = await db.Events.Where(x => x.Id == eventId).Select(x => x.Name).FirstOrDefaultAsync(token);
        if (name is null) return null;
        var assets = await db.MediaAssets.AsNoTracking().Where(x => x.EventId == eventId).ToListAsync(token);
        var files = storage.ListEventFiles(eventId);
        if (assets.Any(x => !x.StorageKey.StartsWith($"{eventId:N}/", StringComparison.OrdinalIgnoreCase)))
            throw new IOException("Hay archivos registrados fuera de la carpeta del evento.");
        // New conversions are grouped by event, including interrupted/orphaned jobs.
        // Older installations used source IDs directly; include only those still attributable to this event.
        var temporary = work.ListFiles(eventId.ToString("N"))
            .Concat(assets.SelectMany(asset => work.ListFiles(asset.Id.ToString("N"))))
            .DistinctBy(x => x.StorageKey).ToArray();
        var fingerprint = string.Join('\n', assets.Select(x => $"asset:{x.Id}:{x.StorageKey}:{x.Checksum}")
            .Concat(files.Select(x => $"media:{x.StorageKey}:{x.FileSize}:{x.LastWriteTicks}"))
            .Concat(temporary.Select(x => $"work:{x.StorageKey}:{x.FileSize}:{x.LastWriteTicks}"))
            .Order(StringComparer.Ordinal));
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{eventId}\n{name}\n{fingerprint}")));
        var known = assets.Select(x => x.StorageKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var preview = new MediaCleanupPreview(eventId, name, assets.Count, files.Count, temporary.Length,
            files.Count(x => !known.Contains(x.StorageKey)), files.Sum(x => x.FileSize) + temporary.Sum(x => x.FileSize), hash);
        return new(preview, assets, files, temporary);
    }

    public async Task<MediaCleanupResult?> CleanAsync(Guid eventId, string snapshotToken, CancellationToken token)
    {
        var inventory = await InventoryAsync(eventId, token);
        if (inventory is null) return null;
        if (snapshotToken != inventory.Preview.SnapshotToken)
            throw new MediaCleanupConflict("Los archivos cambiaron. Volvé a revisar el resumen antes de eliminarlos.");

        // After confirmation, finish independently of the HTTP connection. Missing files are safe to retry.
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, CancellationToken.None);
        var displays = await db.Displays.Where(x => x.EventId == eventId).Select(x => x.Id).ToArrayAsync();
        var stop = dispatcher.Create("media.stop");
        await db.DisplayPlaybackStates.Where(x => displays.Contains(x.DisplayId)).ExecuteUpdateAsync(update => update
            .SetProperty(x => x.DesiredState, "Stopped").SetProperty(x => x.ContentType, (string?)null)
            .SetProperty(x => x.MediaAssetId, (Guid?)null).SetProperty(x => x.PlaylistId, (Guid?)null)
            .SetProperty(x => x.PayloadJson, (string?)null).SetProperty(x => x.StartedAt, (DateTimeOffset?)null)
            .SetProperty(x => x.PausedPositionSeconds, (double?)null).SetProperty(x => x.PromotionPolicyJson, (string?)null)
            .SetProperty(x => x.PromotionProgressJson, (string?)null).SetProperty(x => x.SceneSessionId, (Guid?)null)
            .SetProperty(x => x.SceneExpiresAt, (DateTimeOffset?)null).SetProperty(x => x.Blackout, false)
            .SetProperty(x => x.LastCommandId, stop.CommandId).SetProperty(x => x.Revision, x => x.Revision + 1)
            .SetProperty(x => x.UpdatedAt, DateTimeOffset.UtcNow));
        // Prepared sessions and temporary restoration snapshots must not resurrect deleted content.
        await db.SceneSessions.Where(x => x.EventId == eventId).ExecuteDeleteAsync();

        var failed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var deletedFiles = 0;
        long freedBytes = 0;
        foreach (var file in inventory.Files)
        {
            try { await storage.DeleteAsync(file.StorageKey, CancellationToken.None); deletedFiles++; freedBytes += file.FileSize; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { failed.Add(file.StorageKey); logger.LogWarning(ex, "Could not clean event file {StorageKey}", file.StorageKey); }
        }
        var failedTemporary = 0;
        var failedTemporarySources = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in inventory.Temporary)
        {
            try { work.DeleteFile(file.StorageKey); deletedFiles++; freedBytes += file.FileSize; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { failedTemporary++; failedTemporarySources.Add(file.StorageKey.Split('/')[0]); logger.LogWarning(ex, "Could not clean temporary file {StorageKey}", file.StorageKey); }
        }
        // Keep records for physical files that failed deletion, so the operator can retry.
        var removed = inventory.Assets.Where(x => !failed.Contains(x.StorageKey) && !failedTemporarySources.Contains(x.Id.ToString("N")))
            .Select(x => x.Id).ToArray();
        await db.PlaylistItems.Where(x => removed.Contains(x.MediaAssetId)).ExecuteDeleteAsync();
        await db.MediaOptimizationJobs.Where(x => x.EventId == eventId).ExecuteDeleteAsync();
        await db.MediaAssets.Where(x => x.EventId == eventId && removed.Contains(x.Id)).ExecuteDeleteAsync();
        await db.Playlists.Where(x => x.EventId == eventId).ExecuteUpdateAsync(update => update.SetProperty(x => x.UpdatedAt, DateTimeOffset.UtcNow));
        await transaction.CommitAsync();

        var warnings = new List<string>();
        if (failed.Count + failedTemporary > 0)
            warnings.Add("Algunos archivos no pudieron borrarse. Revisá los permisos o archivos en uso y reintentá la limpieza.");
        try
        {
            storage.RemoveEmptyEventDirectories(eventId);
            work.RemoveEmptyDirectories(eventId.ToString("N"));
            foreach (var asset in inventory.Assets) work.RemoveEmptyDirectories(asset.Id.ToString("N"));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { logger.LogWarning(ex, "Could not remove empty event directories"); warnings.Add("Quedaron carpetas vacías que no se pudieron quitar."); }
        try
        {
            await dispatcher.SendRawAsync(displays, stop, CancellationToken.None);
            // Reload also clears in-memory scene timers and promotion policies. Reconnect reads the stopped state.
            await dispatcher.SendRawAsync(displays, dispatcher.Create("player.reload"), CancellationToken.None);
        }
        catch (Exception ex)
        { logger.LogWarning(ex, "Could not notify displays after event cleanup"); warnings.Add("No se pudo avisar a todas las pantallas. Recargá los reproductores conectados."); }
        return new(removed.Length, deletedFiles, freedBytes, failed.Count + failedTemporary, warnings);
    }

    private sealed record Inventory(MediaCleanupPreview Preview, List<MediaAsset> Assets,
        IReadOnlyList<MediaStorageFile> Files, IReadOnlyList<MediaStorageFile> Temporary);
}

public sealed record MediaCleanupPreview(Guid EventId, string EventName, int MediaCount, int FileCount,
    int TemporaryFileCount, int OrphanFileCount, long TotalBytes, string SnapshotToken);
public sealed record MediaCleanupResult(int DeletedMediaCount, int DeletedFileCount, long FreedBytes,
    int FailedFileCount, IReadOnlyList<string> Warnings);
public sealed class MediaCleanupConflict(string message) : Exception(message);
