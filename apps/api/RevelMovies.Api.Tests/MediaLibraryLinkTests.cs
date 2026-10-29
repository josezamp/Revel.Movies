using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using RevelMovies.Api.Runtime;
using RevelMovies.Domain.DisplayGroups;
using RevelMovies.Domain.Displays;
using RevelMovies.Infrastructure.Persistence;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed partial class MediaUploadTests
{
    [Fact]
    public async Task Library_links_persist_with_files_survive_cleanup_and_delete_without_storage()
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        using var upload = await Upload(client, eventId, "Logo.png"); upload.EnsureSuccessStatusCode();
        using var response = await client.PostAsJsonAsync($"/api/events/{eventId}/media/links", new { name = "  Concurso  ", url = "  https://EXAMPLE.com/live?stage=2#scores  " });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var link = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = link.GetProperty("id").GetGuid();
        Assert.Equal("Link", link.GetProperty("type").GetString());
        Assert.Equal("Concurso", link.GetProperty("name").GetString());
        Assert.Equal("https://example.com/live?stage=2#scores", link.GetProperty("contentUrl").GetString());
        Assert.Equal(0, link.GetProperty("fileSize").GetInt64());
        Assert.Single(Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories));
        Assert.Equal(2, (await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/media")).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/media/{id}/content")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/events/{eventId}/playlists",
            new { name = "Invalid playlist", items = new[] { new { mediaAssetId = id } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).StatusCode);

        var otherId = await CreateEvent(factory, client);
        Assert.Empty((await client.GetFromJsonAsync<JsonElement>($"/api/events/{otherId}/media")).EnumerateArray());
        using var second = await client.PostAsJsonAsync($"/api/events/{eventId}/media/links", new { url = "http://example.org" });
        second.EnsureSuccessStatusCode();
        Assert.Equal("example.org", (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString());
        var preview = await client.GetFromJsonAsync<MediaCleanupPreview>($"/api/events/{eventId}/media-cleanup");
        Assert.Equal(1, preview!.MediaCount); Assert.Equal(1, preview.FileCount);
        (await client.PostAsJsonAsync($"/api/events/{eventId}/media-cleanup", new { confirmation = "ELIMINAR", preview.SnapshotToken })).EnsureSuccessStatusCode();
        var remaining = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/media");
        Assert.Equal(2, remaining.GetArrayLength());
        Assert.All(remaining.EnumerateArray(), item => Assert.Equal("Link", item.GetProperty("type").GetString()));
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/media/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/media/{id}")).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("/relative")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,hello")]
    [InlineData("file:///C:/secret")]
    [InlineData("https://user:secret@example.com")]
    [InlineData("https://example.com/\npath")]
    [InlineData("https://example.com\\path")]
    public async Task Library_links_reject_invalid_urls_without_creating_records(string? url)
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        using var result = await client.PostAsJsonAsync($"/api/events/{eventId}/media/links", new { name = "Link", url });
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/media")).EnumerateArray());
    }

    [Fact]
    public async Task Library_links_validate_name_url_limits_and_event()
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        foreach (var invalid in new[] { new { name = new string('a', 201), url = "https://example.com" },
            new { name = "Link", url = "https://example.com/" + new string('a', 2048) },
            new { name = "Link", url = "https://example.com/" + new string('á', 400) } })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/events/{eventId}/media/links", invalid)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/events/{Guid.NewGuid()}/media/links", new { url = "https://example.com" })).StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Saved_links_dispatch_as_webpages_and_recover_for_displays_and_groups(bool groupTarget)
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        using var created = await client.PostAsJsonAsync($"/api/events/{eventId}/media/links", new { name = "Results", url = "https://example.com/live" });
        created.EnsureSuccessStatusCode();
        var mediaId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var display = new Display { EventId = eventId, Name = "Screen", DeviceTokenHash = Guid.NewGuid().ToString() };
        var group = new DisplayGroup { EventId = eventId, Name = "Group" };
        db.Displays.Add(display); db.DisplayGroups.Add(group);
        db.DisplayGroupMembers.Add(new DisplayGroupMember { DisplayId = display.Id, DisplayGroupId = group.Id });
        await db.SaveChangesAsync();
        var path = groupTarget ? $"/api/display-groups/{group.Id}/commands" : $"/api/displays/{display.Id}/commands";
        using var sent = await client.PostAsJsonAsync(path, new { type = "media.play", payload = new { mediaId } });
        Assert.Equal(HttpStatusCode.Accepted, sent.StatusCode);
        var payload = await sent.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("webpage.show", (groupTarget ? payload.GetProperty("command") : payload).GetProperty("type").GetString());
        var recovery = await scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>().GetRecoveryAsync(display.Id);
        Assert.Equal("https://example.com/live", recovery?.WebPage?.GetProperty("url").GetString());
        var foreign = await CreateEvent(factory, client);
        using var foreignLink = await client.PostAsJsonAsync($"/api/events/{foreign}/media/links", new { url = "https://example.org" });
        var foreignMediaId = (await foreignLink.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(path, new { type = "media.play", payload = new { mediaId = foreignMediaId } })).StatusCode);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task Playing_multimedia_replaces_the_saved_webpage_only_on_target_displays(bool groupTarget, bool playlist)
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        using var uploaded = await Upload(client, eventId, "Logo.png"); uploaded.EnsureSuccessStatusCode();
        var mediaId = (await uploaded.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var createdPlaylist = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new
        { name = "Multimedia", items = new[] { new { mediaAssetId = mediaId, durationSeconds = 60 } } });
        createdPlaylist.EnsureSuccessStatusCode();
        var playlistId = (await createdPlaylist.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var createdLink = await client.PostAsJsonAsync($"/api/events/{eventId}/media/links", new { url = "https://example.com/live" });
        createdLink.EnsureSuccessStatusCode();
        var linkId = (await createdLink.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var displays = Enumerable.Range(0, 3).Select(i => new Display
        { EventId = eventId, Name = $"Screen {i}", DeviceTokenHash = Guid.NewGuid().ToString() }).ToArray();
        var group = new DisplayGroup { EventId = eventId, Name = "Group" };
        db.Displays.AddRange(displays); db.DisplayGroups.Add(group);
        db.DisplayGroupMembers.AddRange(displays.Take(2).Select(display => new DisplayGroupMember { DisplayId = display.Id, DisplayGroupId = group.Id }));
        await db.SaveChangesAsync();
        foreach (var display in displays)
        {
            (await client.PostAsJsonAsync($"/api/displays/{display.Id}/commands", new { type = "media.play", payload = new { mediaId = linkId } })).EnsureSuccessStatusCode();
            (await client.PostAsJsonAsync($"/api/displays/{display.Id}/commands", new { type = "announcement.show", payload = new
            { kind = "message", text = "Aviso vigente", layout = "banner", theme = "dark" } })).EnsureSuccessStatusCode();
        }
        var path = groupTarget ? $"/api/display-groups/{group.Id}/commands" : $"/api/displays/{displays[0].Id}/commands";
        var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(path,
            new { type = "media.play", payload = new { mediaId = Guid.NewGuid() } })).StatusCode);
        Assert.NotNull((await registry.GetRecoveryAsync(displays[0].Id))?.WebPage);
        var before = await registry.GetAsync(displays[0].Id);
        using var played = playlist
            ? await client.PostAsJsonAsync($"/api/playlists/{playlistId}/play", new { targetType = groupTarget ? "group" : "display", targetId = groupTarget ? group.Id : displays[0].Id })
            : await client.PostAsJsonAsync(path, new { type = "media.play", payload = new { mediaId } });
        Assert.Equal(HttpStatusCode.Accepted, played.StatusCode);
        var dispatch = await played.Content.ReadFromJsonAsync<JsonElement>();
        var commandId = dispatch.GetProperty("playCommand").GetProperty("commandId").GetGuid();
        for (var i = 0; i < displays.Length; i++)
        {
            var recovery = await registry.GetRecoveryAsync(displays[i].Id);
            Assert.NotNull(recovery);
            Assert.NotNull(recovery.Announcement);
            if (i == 0 || (groupTarget && i == 1))
            {
                Assert.Null(recovery.WebPage);
                Assert.Equal(playlist ? "Playlist" : "Media", recovery.ContentType);
                Assert.Equal(playlist ? playlistId : mediaId, recovery.Payload!.Value.GetProperty(playlist ? "playlistId" : "mediaId").GetGuid());
                Assert.Equal(commandId, recovery.CommandId);
                Assert.Equal(before!.Revision + 1, recovery.Revision);
            }
            else Assert.Equal("https://example.com/live", recovery.WebPage?.GetProperty("url").GetString());
        }
    }

    [Fact]
    public void Library_link_migration_is_additive_reversible_and_matches_the_model()
    {
        using var db = new RevelMoviesDbContext(new DbContextOptionsBuilder<RevelMoviesDbContext>()
            .UseSqlServer("Server=localhost;Database=ScriptOnly;Integrated Security=true;TrustServerCertificate=true").Options);
        Assert.False(db.Database.HasPendingModelChanges());
        var migrator = db.GetService<IMigrator>();
        Assert.Contains("ADD [url] nvarchar(2048) NULL", migrator.GenerateScript("20261029012557_AddMediaOptimizationJobs", "20261029120000_AddLibraryLinks"));
        Assert.Contains("DROP COLUMN [url]", migrator.GenerateScript("20261029120000_AddLibraryLinks", "20261029012557_AddMediaOptimizationJobs"));
    }
}
