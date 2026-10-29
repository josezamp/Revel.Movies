using Microsoft.EntityFrameworkCore;
using RevelMovies.Application.Media;
using RevelMovies.Domain.Media;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Endpoints;

public static class MediaOptimizationEndpoints
{
    public static void MapMediaOptimizationEndpoints(this WebApplication app)
    {
        app.MapGet("/events/{eventId:guid}/media-optimizations", async (Guid eventId,
            RevelMoviesDbContext db, ITvVideoOptimizer optimizer, CancellationToken token) =>
        {
            var jobs = await db.MediaOptimizationJobs.AsNoTracking().Where(x => x.EventId == eventId).ToListAsync(token);
            var resultIds = jobs.Where(x => x.ResultMediaId.HasValue).Select(x => x.ResultMediaId!.Value).ToArray();
            var existingResults = (await db.MediaAssets.Where(x => resultIds.Contains(x.Id)).Select(x => x.Id).ToListAsync(token)).ToHashSet();
            return Results.Ok(new { available = optimizer.IsAvailable, jobs = jobs.Select(job =>
                job.Status == "Completed" && !existingResults.Contains(job.ResultMediaId ?? Guid.Empty)
                    ? MediaOptimizationResponse.From(job) with { Status = "Deleted", ResultMediaId = null }
                    : MediaOptimizationResponse.From(job)) });
        });

        app.MapPost("/media/{mediaId:guid}/tv-optimization", async (Guid mediaId,
            RevelMoviesDbContext db, ITvVideoOptimizer optimizer, CancellationToken token) =>
        {
            var media = await db.MediaAssets.AsNoTracking().FirstOrDefaultAsync(x => x.Id == mediaId, token);
            if (media is null) return Results.NotFound();
            if (media.Type != MediaType.Video)
                return Results.BadRequest(new { error = "La reducción para TV está disponible para videos MP4." });
            if (!optimizer.IsAvailable)
                return Results.Json(new { error = "La optimización para TV no está habilitada. Configurá FFmpeg y FFprobe en el servidor." }, statusCode: 503);

            var job = await db.MediaOptimizationJobs.FirstOrDefaultAsync(x => x.MediaId == mediaId, token);
            if (job is not null)
            {
                if (job.Status is "Queued" or "Processing")
                    return Results.Accepted(value: MediaOptimizationResponse.From(job));
                if (job.SourceChecksum == media.Checksum && job.SourceStorageKey == media.StorageKey &&
                    (job.Status == "NoSaving" || (job.Status == "Completed" &&
                        await db.MediaAssets.AnyAsync(x => x.Id == job.ResultMediaId, token))))
                    return Results.Ok(MediaOptimizationResponse.From(job));
            }
            else { job = new MediaOptimizationJob { MediaId = mediaId, EventId = media.EventId }; db.MediaOptimizationJobs.Add(job); }

            job.SourceChecksum = media.Checksum; job.SourceStorageKey = media.StorageKey;
            job.OriginalSize = media.FileSize; job.Status = "Queued"; job.Progress = 0;
            job.ResultMediaId = null; job.OptimizedSize = null; job.Error = null;
            // A new token also protects concurrent retries of an already-finished request.
            job.LeaseId = Guid.NewGuid(); job.LeaseExpiresAt = null; job.UpdatedAt = DateTimeOffset.UtcNow;
            try { await db.SaveChangesAsync(token); }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
                var winner = await db.MediaOptimizationJobs.AsNoTracking().FirstOrDefaultAsync(x => x.MediaId == mediaId, token);
                if (winner is null) return Results.Conflict(new { error = "El archivo cambió mientras se preparaba la optimización. Actualizá la biblioteca." });
                return Results.Accepted(value: MediaOptimizationResponse.From(winner));
            }
            return Results.Accepted(value: MediaOptimizationResponse.From(job));
        });
    }
}

public sealed record MediaOptimizationResponse(Guid MediaId, string SourceChecksum, string Status, int Progress,
    long OriginalSize, Guid? ResultMediaId, long? OptimizedSize, string? Error)
{
    public static MediaOptimizationResponse From(MediaOptimizationJob job) => new(job.MediaId, job.SourceChecksum,
        job.Status, job.Progress, job.OriginalSize, job.ResultMediaId, job.OptimizedSize, job.Error);
}
