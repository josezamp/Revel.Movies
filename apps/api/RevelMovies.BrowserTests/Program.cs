using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RevelMovies.Api.Hubs;
using RevelMovies.Infrastructure.Persistence;

// Test-only process: real HTTP, pairing and SignalR; no connection to a real database.
await using var factory = new BrowserApiFactory();
factory.UseKestrel(65180);
factory.StartServer();
using (var scope = factory.Services.CreateScope())
    await scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>().Database.EnsureCreatedAsync();
Console.WriteLine("Browser test API: http://localhost:65180 (ephemeral database)");
await Task.Delay(Timeout.InfiniteTimeSpan);

sealed class BrowserApiFactory : WebApplicationFactory<PlayerHub>
{
    private readonly SqliteConnection keeper = new("Data Source=BrowserTests;Mode=Memory;Cache=Shared");

    public BrowserApiFactory() => keeper.Open();

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await keeper.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["ConnectionStrings:RevelMovies"] = "TestOnly",
            ["Logging:LogLevel:Default"] = "Warning",
            ["MediaStorage:RootPath"] = Path.Combine(Path.GetTempPath(), "revel-browser-tests"),
        }));
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
            services.AddDbContext<RevelMoviesDbContext>(options => options.UseSqlite(keeper.ConnectionString).ReplaceService<IModelCustomizer, BrowserSqliteModelCustomizer>());
        });
    }
}

// SQLite does not compare DateTimeOffset natively; all test timestamps use UTC.
sealed class BrowserSqliteModelCustomizer(ModelCustomizerDependencies dependencies) : ModelCustomizer(dependencies)
{
    public override void Customize(ModelBuilder builder, DbContext context)
    {
        base.Customize(builder, context);
        foreach (var property in builder.Model.GetEntityTypes().SelectMany(entity => entity.GetProperties()))
            if (property.ClrType == typeof(DateTimeOffset) || property.ClrType == typeof(DateTimeOffset?))
                property.SetValueConverter(new DateTimeOffsetToBinaryConverter());
    }
}
