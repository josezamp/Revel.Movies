using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RevelMovies.Api.Hubs;
using RevelMovies.Api.Runtime;
using RevelMovies.Domain.Media;
using RevelMovies.Infrastructure.Persistence;
using Xunit;
using RevelEvent = RevelMovies.Domain.Events.Event;

namespace RevelMovies.Api.Tests;

public sealed class PlaylistSelectionTests
{
    [Fact]
    public async Task Create_with_selection_persists_the_order_names_durations_and_loop()
    {
        await using var factory = new PlaylistApiFactory();
        using var client = factory.CreateClient();
        var (eventId, media, _) = await SeedAsync(factory);
        using var response = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new
        {
            name = "  Apertura  ", isLoop = true,
            items = new[] { new { mediaAssetId = media[1], durationSeconds = (double?)10 }, new { mediaAssetId = media[0], durationSeconds = (double?)null } }
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Apertura", created.GetProperty("name").GetString());
        Assert.True(created.GetProperty("isLoop").GetBoolean());
        var items = created.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(new[] { media[1], media[0] }, items.Select(item => item.GetProperty("mediaAssetId").GetGuid()));
        Assert.Equal(new[] { 0, 1 }, items.Select(item => item.GetProperty("position").GetInt32()));
        Assert.Equal(10, items[0].GetProperty("durationSeconds").GetDouble());
        Assert.Equal("Sponsor", items[0].GetProperty("mediaName").GetString());
        var saved = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/playlists");
        Assert.Equal(created.GetProperty("id").GetGuid(), Assert.Single(saved.EnumerateArray()).GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Append_keeps_existing_items_and_appends_each_batch_in_selection_order()
    {
        await using var factory = new PlaylistApiFactory();
        using var client = factory.CreateClient();
        var (eventId, media, _) = await SeedAsync(factory);
        using var response = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new
        {
            name = "Recepción", isLoop = true, items = new[] { new { mediaAssetId = media[1], durationSeconds = 25 } }
        });
        var original = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = original.GetProperty("id").GetGuid();
        var originalItemId = original.GetProperty("items")[0].GetProperty("id").GetGuid();
        foreach (var mediaId in new[] { media[0], media[1] })
        {
            using var append = await client.PostAsJsonAsync($"/api/playlists/{id}/items", new { items = new[] { new { mediaAssetId = mediaId } } });
            Assert.Equal(HttpStatusCode.OK, append.StatusCode);
        }
        var playlists = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/playlists");
        var playlist = Assert.Single(playlists.EnumerateArray());
        var items = playlist.GetProperty("items").EnumerateArray().ToArray();
        Assert.True(playlist.GetProperty("isLoop").GetBoolean());
        Assert.Equal(new[] { media[1], media[0], media[1] }, items.Select(item => item.GetProperty("mediaAssetId").GetGuid()));
        Assert.Equal(new[] { 0, 1, 2 }, items.Select(item => item.GetProperty("position").GetInt32()));
        Assert.Equal(originalItemId, items[0].GetProperty("id").GetGuid());
        Assert.Equal(25, items[0].GetProperty("durationSeconds").GetDouble());
    }

    [Fact]
    public async Task Invalid_create_leaves_no_empty_playlist_and_append_preserves_existing_content()
    {
        await using var factory = new PlaylistApiFactory();
        using var client = factory.CreateClient();
        var (eventId, media, foreignMedia) = await SeedAsync(factory);
        var invalidItems = new[] { new { mediaAssetId = media[0] }, new { mediaAssetId = foreignMedia } };
        using var invalid = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new { name = "Invalid", items = invalidItems });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var empty = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/playlists");
        Assert.Empty(empty.EnumerateArray());

        using var created = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new { name = "Keep", items = new[] { new { mediaAssetId = media[1] } } });
        var before = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = before.GetProperty("id").GetGuid();
        using var append = await client.PostAsJsonAsync($"/api/playlists/{id}/items", new { items = invalidItems });
        Assert.Equal(HttpStatusCode.BadRequest, append.StatusCode);
        var after = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/playlists");
        Assert.Equal(before.GetProperty("items")[0].GetProperty("id").GetGuid(), Assert.Single(after.EnumerateArray()).GetProperty("items")[0].GetProperty("id").GetGuid());
        Assert.Single(after[0].GetProperty("items").EnumerateArray());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task Invalid_duration_rejects_create_and_replace_without_losing_content(double duration)
    {
        await using var factory = new PlaylistApiFactory();
        using var client = factory.CreateClient();
        var (eventId, media, _) = await SeedAsync(factory);
        var items = new[] { new { mediaAssetId = media[0], durationSeconds = duration } };
        using var invalid = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new { name = "Invalid", items });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var created = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new { name = "Original", items = new[] { new { mediaAssetId = media[1] } } });
        var before = await created.Content.ReadFromJsonAsync<JsonElement>();
        using var replace = await client.PutAsJsonAsync($"/api/playlists/{before.GetProperty("id").GetGuid()}/items", new { items });
        Assert.Equal(HttpStatusCode.BadRequest, replace.StatusCode);
        var after = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/playlists");
        Assert.Equal(media[1], Assert.Single(after[0].GetProperty("items").EnumerateArray()).GetProperty("mediaAssetId").GetGuid());
    }

    [Fact]
    public async Task Empty_creation_remains_supported_and_empty_append_is_rejected()
    {
        await using var factory = new PlaylistApiFactory();
        using var client = factory.CreateClient();
        var (eventId, _, _) = await SeedAsync(factory);
        using var created = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new { name = "Empty" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var item = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(item.GetProperty("items").EnumerateArray());
        using var append = await client.PostAsJsonAsync($"/api/playlists/{item.GetProperty("id").GetGuid()}/items", new { items = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, append.StatusCode);
        using var missing = await client.PostAsJsonAsync($"/api/playlists/{Guid.NewGuid()}/items", new { items = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Theory]
    [InlineData("create")]
    [InlineData("append")]
    [InlineData("replace")]
    public async Task Database_failure_rolls_back_the_entire_change(string operation)
    {
        await using var factory = new PlaylistApiFactory();
        using var client = factory.CreateClient();
        var (eventId, media, _) = await SeedAsync(factory);
        using var created = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new
        {
            name = "Original", items = new[] { new { mediaAssetId = media[0] } }
        });
        var before = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = before.GetProperty("id").GetGuid();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TRIGGER reject_test_duration BEFORE INSERT ON playlist_items
                WHEN NEW.duration_seconds = 99 BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;
                """);
            var registry = scope.ServiceProvider.GetRequiredService<PlaylistRegistry>();
            var items = new[] { new PlaylistItemDefinition(media[0], 10), new PlaylistItemDefinition(media[1], 99) };
            if (operation == "create")
                await Assert.ThrowsAsync<DbUpdateException>(() => registry.CreateAsync(eventId, "Should not exist", false, items));
            else if (operation == "append")
                await Assert.ThrowsAsync<DbUpdateException>(() => registry.AppendItemsAsync(id, items));
            else
                await Assert.ThrowsAsync<DbUpdateException>(() => registry.ReplaceItemsAsync(id, items));
        }
        var after = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/playlists");
        var playlist = Assert.Single(after.EnumerateArray());
        var item = Assert.Single(playlist.GetProperty("items").EnumerateArray());
        Assert.Equal(id, playlist.GetProperty("id").GetGuid());
        Assert.Equal(before.GetProperty("items")[0].GetProperty("id").GetGuid(), item.GetProperty("id").GetGuid());
    }

    private static async Task<(Guid EventId, Guid[] MediaIds, Guid ForeignMediaId)> SeedAsync(PlaylistApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        await db.Database.EnsureCreatedAsync();
        var eventItem = new RevelEvent { Name = "Evento", Slug = "event" };
        var otherEvent = new RevelEvent { Name = "Otro", Slug = "other" };
        db.Events.AddRange(eventItem, otherEvent);
        var video = new MediaAsset { EventId = eventItem.Id, Name = "Bienvenida", Type = MediaType.Video, StorageKey = "video.mp4" };
        var image = new MediaAsset { EventId = eventItem.Id, Name = "Sponsor", Type = MediaType.Image, StorageKey = "image.png" };
        var foreign = new MediaAsset { EventId = otherEvent.Id, Name = "Otro", Type = MediaType.Image, StorageKey = "foreign.png" };
        db.MediaAssets.AddRange(video, image, foreign);
        await db.SaveChangesAsync();
        return (eventItem.Id, new[] { video.Id, image.Id }, foreign.Id);
    }

    private sealed class PlaylistApiFactory : WebApplicationFactory<PlayerHub>
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:;Foreign Keys=True");
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            connection.Open();
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["Database:ApplyMigrationsOnStartup"] = "false" }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseSqlite(connection));
            });
        }
        public override async ValueTask DisposeAsync() { await base.DisposeAsync(); await connection.DisposeAsync(); }
    }
}
