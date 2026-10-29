using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RevelMovies.Api.Endpoints;
using RevelMovies.Domain.Displays;
using RevelMovies.Infrastructure.Persistence;
using Xunit;
using RevelEvent = RevelMovies.Domain.Events.Event;

namespace RevelMovies.Api.Tests;

public sealed class EventMapTests
{
    private static MapNode Shape(string kind = "rectangle", Guid? displayId = null) =>
        new(Guid.NewGuid(), kind, 100, 120, 180, 90, "Escenario", "blue", displayId);

    [Fact]
    public async Task Map_round_trips_per_event_and_stale_writes_preserve_saved_version()
    {
        await using var factory = new MapFactory();
        using var client = factory.CreateClient();
        var (eventId, otherEventId, displayId) = await factory.Seed();
        var initial = await client.GetFromJsonAsync<EventMapResponse>($"/api/events/{eventId}/map");
        Assert.Equal(0, initial!.Version);
        Assert.Empty(initial.Nodes);
        MapNode[] nodes = [Shape(), Shape("wall"), Shape("label"), Shape("ellipse"), Shape("display", displayId)];
        var saved = await client.PutAsJsonAsync($"/api/events/{eventId}/map", new SaveEventMapRequest(0, nodes));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var result = await saved.Content.ReadFromJsonAsync<EventMapResponse>();
        Assert.Equal(1, result!.Version);
        Assert.Equal(nodes, result.Nodes);

        // A fresh request uses a different DbContext, proving persistence beyond the write scope.
        var loaded = await client.GetFromJsonAsync<EventMapResponse>($"/api/events/{eventId}/map");
        Assert.Equal(nodes, loaded!.Nodes);
        Assert.Empty((await client.GetFromJsonAsync<EventMapResponse>($"/api/events/{otherEventId}/map"))!.Nodes);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/events/{eventId}/map", new SaveEventMapRequest(0, []))).StatusCode);
        Assert.Equal(nodes, (await client.GetFromJsonAsync<EventMapResponse>($"/api/events/{eventId}/map"))!.Nodes);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/events/{eventId}/map", new SaveEventMapRequest(1, []))).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<EventMapResponse>($"/api/events/{eventId}/map"))!.Nodes);
    }

    [Fact]
    public async Task Invalid_geometry_duplicates_and_foreign_displays_never_change_the_map()
    {
        await using var factory = new MapFactory();
        using var client = factory.CreateClient();
        var (eventId, otherEventId, displayId) = await factory.Seed();
        var duplicate = Shape();
        MapNode?[][] invalid = [
            [null], [Shape() with { X = -1 }], [Shape() with { Width = 0 }], [Shape() with { Height = 1000 }],
            [Shape() with { X = 1199 }], [Shape() with { Kind = "script" }], [Shape() with { Color = "invalid" }],
            [Shape() with { Label = new string('x', 101) }], [Shape() with { Id = Guid.Empty }],
            [Shape("display")], [Shape() with { DisplayId = displayId }], [Shape("display", Guid.NewGuid())],
            [duplicate, duplicate], [Shape("display", displayId), Shape("display", displayId)],
            Enumerable.Range(0, 301).Select(_ => Shape()).ToArray()
        ];
        foreach (var nodes in invalid)
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/events/{eventId}/map", new SaveEventMapRequest(0, nodes))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/events/{otherEventId}/map", new SaveEventMapRequest(0, [Shape("display", displayId)]))).StatusCode);
        var loaded = await client.GetFromJsonAsync<EventMapResponse>($"/api/events/{eventId}/map");
        Assert.Equal(0, loaded!.Version);
        Assert.Empty(loaded.Nodes);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/events/{Guid.NewGuid()}/map")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync($"/api/events/{Guid.NewGuid()}/map", new SaveEventMapRequest(0, []))).StatusCode);
    }

    [Fact]
    public async Task Removing_a_display_from_the_map_does_not_unpair_or_change_playback()
    {
        await using var factory = new MapFactory();
        using var client = factory.CreateClient();
        var (eventId, _, displayId) = await factory.Seed();
        (await client.PutAsJsonAsync($"/api/events/{eventId}/map", new SaveEventMapRequest(0, [Shape("display", displayId)]))).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync($"/api/events/{eventId}/map", new SaveEventMapRequest(1, []))).EnsureSuccessStatusCode();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        Assert.True(await db.Displays.AnyAsync(x => x.Id == displayId && x.EventId == eventId));
        Assert.Empty(await db.DisplayPlaybackStates.ToListAsync());
        Assert.Empty(await db.CommandAcknowledgements.ToListAsync());
    }

    private sealed class MapFactory : AuthenticatedApiFactory
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:");
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            connection.Open();
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Database:ApplyMigrationsOnStartup"] = "false" }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseSqlite(connection));
            });
        }
        public async Task<(Guid EventId, Guid OtherEventId, Guid DisplayId)> Seed()
        {
            using var scope = Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            await db.Database.EnsureCreatedAsync();
            var item = new RevelEvent { Name = "Evento", Slug = "evento" };
            var other = new RevelEvent { Name = "Otro evento", Slug = "otro-evento" };
            var display = new Display { EventId = item.Id, Name = "TV Escenario", DeviceTokenHash = "map-test-token" };
            db.AddRange(item, other, display);
            await db.SaveChangesAsync();
            return (item.Id, other.Id, display.Id);
        }
        public override async ValueTask DisposeAsync() { await base.DisposeAsync(); await connection.DisposeAsync(); }
    }
}
