using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RevelMovies.Api.Hubs;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class ApiRoutingTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Health_is_available_under_the_public_api_prefix(bool simulateIis)
    {
        await using var factory = new ApiFactory(simulateIis);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData(false, "/api/events", "Event name is required.")]
    [InlineData(true, "/api/events", "Event name is required.")]
    [InlineData(false, "/api/events/11111111-1111-1111-1111-111111111111/display-groups", "Display group name is required.")]
    [InlineData(true, "/api/events/11111111-1111-1111-1111-111111111111/display-groups", "Display group name is required.")]
    [InlineData(false, "/api/events/11111111-1111-1111-1111-111111111111/playlists", "Playlist name is required.")]
    [InlineData(true, "/api/events/11111111-1111-1111-1111-111111111111/playlists", "Playlist name is required.")]
    public async Task Public_routes_reach_their_handlers_without_a_duplicate_prefix(
        bool simulateIis, string path, string expectedError)
    {
        await using var factory = new ApiFactory(simulateIis);
        using var client = factory.CreateClient();

        // Invalid input reaches application validation without reading or writing SQL Server.
        using var response = await client.PostAsJsonAsync(path, new { name = "" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(expectedError, body.GetProperty("error").GetString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Player_identity_reaches_device_authentication(bool simulateIis)
    {
        await using var factory = new ApiFactory(simulateIis);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/api/player/identity");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SignalR_negotiates_at_the_frontend_connection_url(bool simulateIis)
    {
        await using var factory = new ApiFactory(simulateIis);
        using var client = factory.CreateClient();

        using var response = await client.PostAsync("/api/hubs/player/negotiate?negotiateVersion=1", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("connectionToken").GetString()));
        Assert.Contains(body.GetProperty("availableTransports").EnumerateArray(),
            transport => transport.GetProperty("transport").GetString() == "WebSockets");
    }

    private sealed class ApiFactory(bool simulateIis) : WebApplicationFactory<PlayerHub>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:ApplyMigrationsOnStartup"] = "false"
                }));

            if (simulateIis)
                builder.ConfigureServices(services => services.AddSingleton<IStartupFilter, IisPathBaseStartupFilter>());
        }
    }

    private sealed class IisPathBaseStartupFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            // IIS has already split the application alias from Path before ASP.NET Core runs.
            app.Use(async (context, nextMiddleware) =>
            {
                if (context.Request.Path.StartsWithSegments("/api", out var remaining))
                {
                    context.Request.PathBase = "/api";
                    context.Request.Path = remaining;
                }

                await nextMiddleware(context);
            });
            next(app);
        };
    }
}
