namespace RevelMovies.Api.Runtime;

// A single API process owns this local storage. Cleanup must not overlap writes or background conversions.
public sealed class MediaMaintenanceGate
{
    private readonly object sync = new();
    private int users;
    private bool cleaning;

    public IDisposable? TryEnter(bool cleanup = false)
    {
        lock (sync)
        {
            if (cleaning || (cleanup && users > 0)) return null;
            if (cleanup) cleaning = true;
            else users++;
            return new Lease(this, cleanup);
        }
    }

    private sealed class Lease(MediaMaintenanceGate owner, bool cleanup) : IDisposable
    {
        private int disposed;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            lock (owner.sync)
            {
                if (cleanup) owner.cleaning = false;
                else owner.users--;
            }
        }
    }
}
