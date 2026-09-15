using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Pairing;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class DisplayRegistry(RevelMoviesDbContext db)
{
    private static readonly TimeSpan PairingLifetime = TimeSpan.FromMinutes(10);

    public async Task<PairingSession> CreatePairingSessionAsync(CancellationToken cancellationToken = default)
    {
        await RemoveExpiredPairingSessionsAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        string? code = null;

        for (var attempt = 0; attempt < 10; attempt++)
        {
            var candidate = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
            var exists = await db.PairingSessions.AnyAsync(x =>
                x.Code == candidate &&
                x.DisplayId == null &&
                x.ExpiresAt > now, cancellationToken);

            if (!exists)
            {
                code = candidate;
                break;
            }
        }

        if (code is null)
            throw new InvalidOperationException("Could not allocate a unique pairing code.");

        var session = new PairingSession(
            Guid.NewGuid().ToString("N"),
            code,
            now.Add(PairingLifetime));

        db.PairingSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        return session;
    }

    public async Task<IReadOnlyList<PairingSession>> GetPendingPairingsAsync(CancellationToken cancellationToken = default)
    {
        await RemoveExpiredPairingSessionsAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;

        return await db.PairingSessions
            .AsNoTracking()
            .Where(x => x.DisplayId == null && x.ExpiresAt > now)
            .OrderBy(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<PairingResult?> GetPairingResultAsync(string sessionToken, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var session = await db.PairingSessions
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.SessionToken == sessionToken && x.ExpiresAt > now, cancellationToken);

        if (session is null)
            return null;

        return session.DisplayId.HasValue && !string.IsNullOrWhiteSpace(session.DeviceToken)
            ? new PairingResult(true, session.DisplayId, session.DeviceToken)
            : new PairingResult(false, null, null);
    }

    public async Task<Display?> PairAsync(string code, string name, Guid eventId, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var eventExists = await db.Events.AnyAsync(x => x.Id == eventId, cancellationToken);
        if (!eventExists)
            return null;

        var session = await db.PairingSessions.FirstOrDefaultAsync(x =>
            x.Code == code &&
            x.DisplayId == null &&
            x.ExpiresAt > now, cancellationToken);

        if (session is null)
            return null;

        var deviceToken = GenerateDeviceToken();
        var display = new Display
        {
            EventId = eventId,
            Name = name.Trim(),
            DeviceTokenHash = HashDeviceToken(deviceToken),
            Status = DisplayStatus.Offline,
            UpdatedAt = now
        };

        db.Displays.Add(display);
        session.Pair(display.Id, deviceToken);
        await db.SaveChangesAsync(cancellationToken);
        return display;
    }

    public async Task<Display?> AuthenticateAsync(string? deviceToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(deviceToken))
            return null;

        var hash = HashDeviceToken(deviceToken);
        return await db.Displays
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.DeviceTokenHash == hash, cancellationToken);
    }

    public async Task<IReadOnlyList<Display>> GetDisplaysAsync(Guid? eventId = null, CancellationToken cancellationToken = default)
    {
        var query = db.Displays.AsNoTracking();
        if (eventId.HasValue)
            query = query.Where(x => x.EventId == eventId.Value);

        return await query.OrderBy(x => x.Name).ToListAsync(cancellationToken);
    }

    public Task<Display?> GetDisplayAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.Displays.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

    public Task SetOnlineAsync(Guid id, CancellationToken cancellationToken = default) =>
        UpdatePresenceAsync(id, DisplayStatus.Online, cancellationToken);

    public Task SetOfflineAsync(Guid id, CancellationToken cancellationToken = default) =>
        UpdatePresenceAsync(id, DisplayStatus.Offline, cancellationToken);

    public async Task HeartbeatAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var display = await db.Displays.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (display is null)
            return;

        display.LastSeenAt = DateTimeOffset.UtcNow;
        display.UpdatedAt = display.LastSeenAt.Value;
        if (display.Status is DisplayStatus.Offline or DisplayStatus.Unknown)
            display.Status = DisplayStatus.Online;

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task UpdatePresenceAsync(Guid id, DisplayStatus status, CancellationToken cancellationToken)
    {
        var display = await db.Displays.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (display is null)
            return;

        var now = DateTimeOffset.UtcNow;
        display.Status = status;
        display.LastSeenAt = now;
        display.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
    }

    private Task RemoveExpiredPairingSessionsAsync(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        return db.PairingSessions
            .Where(x => x.ExpiresAt <= now)
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static string GenerateDeviceToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static string HashDeviceToken(string token)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}

public sealed record PairingResult(bool IsPaired, Guid? DisplayId, string? DeviceToken);
