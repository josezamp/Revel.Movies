using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RevelMovies.Domain.Displays;

namespace RevelMovies.Infrastructure.Persistence;

public static class DatabaseBootstrapper
{
    public static async Task InitializeAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();

        await db.Database.MigrateAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        await db.Displays
            .Where(x => x.Status != DisplayStatus.Offline)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.Status, DisplayStatus.Offline)
                .SetProperty(x => x.UpdatedAt, now), cancellationToken);
    }
}
