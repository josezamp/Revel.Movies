using System.Collections.Concurrent;
using RevelMovies.Domain.Displays;

namespace RevelMovies.Api.Runtime;

public sealed class DisplayRegistry
{
    private readonly ConcurrentDictionary<string, PairingSession> _pairingSessions = new();
    private readonly ConcurrentDictionary<Guid, Display> _displays = new();
    private readonly ConcurrentDictionary<string, Guid> _displayByToken = new();

    public PairingSession CreatePairingSession()
    {
        RemoveExpiredPairingSessions();

        var session = new PairingSession(
            Guid.NewGuid().ToString("N"),
            Random.Shared.Next(100000, 1000000).ToString(),
            DateTimeOffset.UtcNow.AddMinutes(10));

        _pairingSessions[session.SessionToken] = session;
        return session;
    }

    public IReadOnlyCollection<PairingSession> GetPendingPairings() =>
        _pairingSessions.Values
            .Where(x => !x.IsPaired && x.ExpiresAt > DateTimeOffset.UtcNow)
            .OrderBy(x => x.CreatedAt)
            .ToArray();

    public PairingResult? GetPairingResult(string sessionToken)
    {
        if (!_pairingSessions.TryGetValue(sessionToken, out var session) || session.ExpiresAt <= DateTimeOffset.UtcNow)
            return null;

        return session.IsPaired
            ? new PairingResult(true, session.DisplayId, session.DeviceToken)
            : new PairingResult(false, null, null);
    }

    public Display? Pair(string code, string name)
    {
        var session = _pairingSessions.Values.FirstOrDefault(x =>
            !x.IsPaired &&
            x.ExpiresAt > DateTimeOffset.UtcNow &&
            string.Equals(x.Code, code, StringComparison.Ordinal));

        if (session is null)
            return null;

        var display = new Display
        {
            Name = name.Trim(),
            Status = DisplayStatus.Offline
        };

        _displays[display.Id] = display;
        _displayByToken[display.DeviceToken] = display.Id;

        session.Pair(display.Id, display.DeviceToken);
        return display;
    }

    public Display? Authenticate(string? deviceToken)
    {
        if (string.IsNullOrWhiteSpace(deviceToken) || !_displayByToken.TryGetValue(deviceToken, out var displayId))
            return null;

        return _displays.GetValueOrDefault(displayId);
    }

    public IReadOnlyCollection<Display> GetDisplays() =>
        _displays.Values.OrderBy(x => x.Name).ToArray();

    public Display? GetDisplay(Guid id) => _displays.GetValueOrDefault(id);

    public void SetOnline(Guid id)
    {
        if (!_displays.TryGetValue(id, out var display))
            return;

        display.Status = DisplayStatus.Online;
        display.LastSeenAt = DateTimeOffset.UtcNow;
    }

    public void SetOffline(Guid id)
    {
        if (!_displays.TryGetValue(id, out var display))
            return;

        display.Status = DisplayStatus.Offline;
        display.LastSeenAt = DateTimeOffset.UtcNow;
    }

    public void Heartbeat(Guid id)
    {
        if (!_displays.TryGetValue(id, out var display))
            return;

        display.LastSeenAt = DateTimeOffset.UtcNow;
        if (display.Status == DisplayStatus.Offline || display.Status == DisplayStatus.Unknown)
            display.Status = DisplayStatus.Online;
    }

    private void RemoveExpiredPairingSessions()
    {
        foreach (var session in _pairingSessions.Values.Where(x => !x.IsPaired && x.ExpiresAt <= DateTimeOffset.UtcNow))
            _pairingSessions.TryRemove(session.SessionToken, out _);
    }
}

public sealed class PairingSession
{
    public PairingSession(string sessionToken, string code, DateTimeOffset expiresAt)
    {
        SessionToken = sessionToken;
        Code = code;
        ExpiresAt = expiresAt;
        CreatedAt = DateTimeOffset.UtcNow;
    }

    public string SessionToken { get; }
    public string Code { get; }
    public DateTimeOffset CreatedAt { get; }
    public DateTimeOffset ExpiresAt { get; }
    public bool IsPaired { get; private set; }
    public Guid? DisplayId { get; private set; }
    public string? DeviceToken { get; private set; }

    public void Pair(Guid displayId, string deviceToken)
    {
        IsPaired = true;
        DisplayId = displayId;
        DeviceToken = deviceToken;
    }
}

public sealed record PairingResult(bool IsPaired, Guid? DisplayId, string? DeviceToken);
