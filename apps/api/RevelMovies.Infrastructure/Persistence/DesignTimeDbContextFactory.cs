using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace RevelMovies.Infrastructure.Persistence;

// Generate migrations without starting the API or applying migrations to a running database.
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<RevelMoviesDbContext>
{
    public RevelMoviesDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<RevelMoviesDbContext>()
        .UseSqlServer(Environment.GetEnvironmentVariable("ConnectionStrings__RevelMovies") ??
            "Server=localhost;Database=Revel.Movies;Trusted_Connection=True;TrustServerCertificate=True;").Options);
}
