using Microsoft.EntityFrameworkCore;
using RevelMovies.Application.Media;
using RevelMovies.Domain.Media;
using RevelMovies.Infrastructure.Media;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class MediaOptimizationWorker(IServiceScopeFactory scopes, ITvVideoOptimizer optimizer,
    TvOptimizationOptions options, ILogger<MediaOptimizationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (optimizer.IsAvailable && await ProcessNextAsync(stoppingToken)) continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Could not process the TV optimization queue"); }
            try { await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    public async Task<bool> ProcessNextAsync(CancellationToken stoppingToken)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var storage = scope.ServiceProvider.GetRequiredService<IMediaStorage>();
        var now = DateTimeOffset.UtcNow;
        var job = await db.MediaOptimizationJobs.AsNoTracking()
            .Where(x => x.Status == "Queued" || (x.Status == "Processing" && x.LeaseExpiresAt < now))
            .OrderBy(x => x.UpdatedAt).FirstOrDefaultAsync(stoppingToken);
        if (job is null) return false;
        var lease = Guid.NewGuid();
        var expiry = now.AddMinutes(Math.Clamp(options.TimeoutMinutes, 1, 180) + 2);
        var claimed = await db.MediaOptimizationJobs.Where(x => x.MediaId == job.MediaId && x.LeaseId == job.LeaseId &&
                (x.Status == "Queued" || (x.Status == "Processing" && x.LeaseExpiresAt < now)))
            .ExecuteUpdateAsync(update => update.SetProperty(x => x.Status, "Processing").SetProperty(x => x.Progress, 0)
                .SetProperty(x => x.LeaseId, lease).SetProperty(x => x.LeaseExpiresAt, expiry)
                .SetProperty(x => x.UpdatedAt, now), stoppingToken);
        if (claimed == 0) return true;
        job.LeaseId = lease;
        var workDirectory = Path.Combine(options.WorkPath, job.MediaId.ToString("N"), lease.ToString("N"));
        StoredMediaFile? stored = null;
        var committed = false;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(Math.Clamp(options.TimeoutMinutes, 1, 180)));
        try
        {
            Directory.CreateDirectory(workDirectory);
            var input = Path.Combine(workDirectory, "original.mp4");
            var output = Path.Combine(workDirectory, "tv.mp4");
            await using (var original = await storage.OpenReadAsync(job.SourceStorageKey, timeout.Token)
                ?? throw new VideoOptimizationException("El original ya no está disponible. Actualizá la biblioteca."))
            await using (var copy = File.Create(input)) await original.CopyToAsync(copy, timeout.Token);

            double progress = 0;
            var conversion = optimizer.OptimizeAsync(input, output, value => Volatile.Write(ref progress, value), timeout.Token);
            VideoDetails details;
            try
            {
                while (await Task.WhenAny(conversion, Task.Delay(TimeSpan.FromSeconds(2), timeout.Token)) != conversion)
                {
                    timeout.Token.ThrowIfCancellationRequested();
                    var percent = Math.Clamp((int)(Volatile.Read(ref progress) * 100), 0, 99);
                    if (await db.MediaOptimizationJobs.Where(x => x.MediaId == job.MediaId && x.LeaseId == lease)
                        .ExecuteUpdateAsync(update => update.SetProperty(x => x.Progress, percent), timeout.Token) == 0)
                        throw new VideoOptimizationException("La solicitud fue eliminada o reemplazada.");
                }
                details = await conversion;
            }
            finally
            {
                // Always stop/join the child process before removing its files, including database failures.
                if (!conversion.IsCompleted)
                {
                    await timeout.CancelAsync();
                    try { await conversion; } catch { /* The original exception is reported below. */ }
                }
            }
            timeout.Token.ThrowIfCancellationRequested();
            var size = new FileInfo(output).Length;
            if (size >= job.OriginalSize)
            {
                await FinishAsync(db, job, "NoSaving", "El video ya es compacto: la conversión no redujo su tamaño.", stoppingToken);
                return true;
            }
            await using (var stream = File.OpenRead(output))
                stored = await storage.SaveAsync(job.EventId, Guid.NewGuid(), ".mp4", stream, timeout.Token);

            // Publishing and finishing are atomic. An upload that replaces/deletes the source cannot publish a stale copy.
            await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, timeout.Token);
            var source = await db.MediaAssets.AsNoTracking().FirstOrDefaultAsync(x => x.Id == job.MediaId, timeout.Token);
            if (source is null || source.Checksum != job.SourceChecksum || source.StorageKey != job.SourceStorageKey)
                throw new VideoOptimizationException("El original cambió durante la conversión. Volvé a reducir el archivo actualizado.");
            var result = new MediaAsset
            {
                EventId = source.EventId, Name = source.Name[..Math.Min(source.Name.Length, 190)] + " · TV",
                FileName = Path.GetFileNameWithoutExtension(source.FileName)[..Math.Min(Path.GetFileNameWithoutExtension(source.FileName).Length, 210)] + $"__TV_{lease:N}.mp4",
                Type = MediaType.Video, MimeType = "video/mp4", StorageKey = stored.StorageKey,
                FileSize = stored.FileSize, Checksum = stored.Checksum,
                DurationSeconds = details.DurationSeconds, Width = details.Width, Height = details.Height
            };
            if (await db.MediaOptimizationJobs.Where(x => x.MediaId == job.MediaId && x.LeaseId == lease && x.Status == "Processing")
                .ExecuteUpdateAsync(update => update.SetProperty(x => x.Status, "Completed").SetProperty(x => x.Progress, 100)
                    .SetProperty(x => x.ResultMediaId, result.Id).SetProperty(x => x.OptimizedSize, stored.FileSize)
                    .SetProperty(x => x.Error, (string?)null).SetProperty(x => x.LeaseExpiresAt, (DateTimeOffset?)null)
                    .SetProperty(x => x.UpdatedAt, DateTimeOffset.UtcNow), timeout.Token) == 0)
                throw new VideoOptimizationException("La solicitud fue eliminada o reemplazada.");
            db.MediaAssets.Add(result);
            await db.SaveChangesAsync(timeout.Token);
            await transaction.CommitAsync(timeout.Token);
            committed = true;
        }
        catch (OperationCanceledException)
        {
            await FinishAsync(db, job, stoppingToken.IsCancellationRequested ? "Queued" : "Failed",
                stoppingToken.IsCancellationRequested ? null : "La conversión superó el tiempo máximo. Podés reintentarlo.", CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "TV optimization failed for {MediaId}", job.MediaId);
            await FinishAsync(db, job, "Failed", ex is VideoOptimizationException ? ex.Message :
                "No se pudo convertir el video. El original se conserva. Revisá FFmpeg o reintentá.", CancellationToken.None);
        }
        finally
        {
            if (stored is not null && !committed)
            {
                try { await storage.DeleteAsync(stored.StorageKey, CancellationToken.None); }
                catch (Exception ex) { logger.LogWarning(ex, "Could not remove unpublished TV copy {StorageKey}", stored.StorageKey); }
            }
            try { if (Directory.Exists(workDirectory)) Directory.Delete(workDirectory, true); }
            catch (Exception ex) { logger.LogWarning(ex, "Could not clean TV work directory {WorkDirectory}", workDirectory); }
        }
        return true;
    }

    private static Task<int> FinishAsync(RevelMoviesDbContext db, MediaOptimizationJob job, string status, string? error, CancellationToken token) =>
        db.MediaOptimizationJobs.Where(x => x.MediaId == job.MediaId && x.LeaseId == job.LeaseId && x.Status == "Processing")
            .ExecuteUpdateAsync(update => update.SetProperty(x => x.Status, status).SetProperty(x => x.Error, error)
                .SetProperty(x => x.Progress, status == "NoSaving" ? 100 : 0)
                .SetProperty(x => x.LeaseExpiresAt, (DateTimeOffset?)null).SetProperty(x => x.UpdatedAt, DateTimeOffset.UtcNow), token);
}
