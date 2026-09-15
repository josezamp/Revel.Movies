using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Commands;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class CommandAcknowledgementRegistry(RevelMoviesDbContext db)
{
    public async Task RecordAsync(
        Guid displayId,
        Guid commandId,
        string commandType,
        string status,
        string? detail,
        DateTimeOffset? clientTimestamp,
        CancellationToken cancellationToken = default)
    {
        var normalizedStatus = status.Trim().ToLowerInvariant();
        if (normalizedStatus.Length > 40)
            normalizedStatus = normalizedStatus[..40];

        var normalizedType = commandType.Trim();
        if (normalizedType.Length > 100)
            normalizedType = normalizedType[..100];

        var normalizedDetail = string.IsNullOrWhiteSpace(detail) ? null : detail.Trim();
        if (normalizedDetail?.Length > 500)
            normalizedDetail = normalizedDetail[..500];

        var existing = await db.CommandAcknowledgements.FirstOrDefaultAsync(x =>
            x.DisplayId == displayId &&
            x.CommandId == commandId &&
            x.Status == normalizedStatus,
            cancellationToken);

        if (existing is null)
        {
            db.CommandAcknowledgements.Add(new CommandAcknowledgement
            {
                DisplayId = displayId,
                CommandId = commandId,
                CommandType = normalizedType,
                Status = normalizedStatus,
                Detail = normalizedDetail,
                ClientTimestamp = clientTimestamp,
                ServerReceivedAt = DateTimeOffset.UtcNow
            });
        }
        else
        {
            existing.CommandType = normalizedType;
            existing.Detail = normalizedDetail;
            existing.ClientTimestamp = clientTimestamp;
            existing.ServerReceivedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<CommandAcknowledgement>> GetLatestAsync(
        Guid displayId,
        int take = 20,
        CancellationToken cancellationToken = default) =>
        await db.CommandAcknowledgements
            .AsNoTracking()
            .Where(x => x.DisplayId == displayId)
            .OrderByDescending(x => x.ServerReceivedAt)
            .Take(Math.Clamp(take, 1, 100))
            .ToListAsync(cancellationToken);
}
