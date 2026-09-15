using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Infrastructure;

public static class InfrastructureServiceCollectionExtensions
{
    public static IServiceCollection AddRevelMoviesInfrastructure(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<RevelMoviesDbContext>(options => options.UseNpgsql(connectionString));
        return services;
    }
}
