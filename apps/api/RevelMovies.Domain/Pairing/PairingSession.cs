namespace RevelMovies.Domain.Pairing;

public sealed class PairingSession
{
    private PairingSession()
    {
    }

    public PairingSession(string sessionToken, string code, DateTimeOffset expiresAt)
    {
        SessionToken = sessionToken;
        Code = code;
        CreatedAt = DateTimeOffset.UtcNow;
        ExpiresAt = expiresAt;
    }

    public Guid Id { get; init; } = Guid.NewGuid();
    public string SessionToken { get; private set; } = string.Empty;
    public string Code { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public Guid? DisplayId { get; private set; }
    public string? DeviceToken { get; private set; }
    public DateTimeOffset? PairedAt { get; private set; }
    public bool IsPaired => DisplayId.HasValue;

    public void Pair(Guid displayId, string deviceToken)
    {
        DisplayId = displayId;
        DeviceToken = deviceToken;
        PairedAt = DateTimeOffset.UtcNow;
    }
}
