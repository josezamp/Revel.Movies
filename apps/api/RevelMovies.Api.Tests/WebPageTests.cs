using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RevelMovies.Api.Hubs;
using RevelMovies.Api.Runtime;
using RevelMovies.Domain.DisplayGroups;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Playback;
using RevelMovies.Infrastructure.Persistence;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class WebPageTests
{
    private const string Url = "https://contest.example/halloween/2026/concurso/live?mode=wall#stage";

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,hello")]
    [InlineData("file:///C:/page.html")]
    [InlineData("/relative")]
    [InlineData("https://user:password@example.com")]
    [InlineData("https://example.com/\\evil")]
    [InlineData("https://exa\nmple.com")]
    public void Rejects_invalid_addresses(string url) => Assert.NotNull(WebPageCommand.Validate(
        JsonSerializer.SerializeToElement(new { url }), out _));

    [Fact]
    public void Validates_payload_and_keeps_query_and_fragment()
    {
        Assert.NotNull(WebPageCommand.Validate(null, out _));
        Assert.NotNull(WebPageCommand.Validate(JsonSerializer.SerializeToElement(new { url = 42 }), out _));
        Assert.NotNull(WebPageCommand.Validate(JsonSerializer.SerializeToElement(new { url = "https://example.com/" + new string('x', 2048) }), out _));
        Assert.Null(WebPageCommand.Validate(JsonSerializer.SerializeToElement(new { url = "  " + Url + "  ", ignored = true }), out var normalized));
        Assert.Equal(Url, normalized.GetProperty("url").GetString());
        Assert.False(normalized.TryGetProperty("ignored", out _));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Show_replace_recover_and_clear_preserve_playback_and_announcement(bool groupTarget)
    {
        await using var factory = new WebPageApiFactory();
        using var client = factory.CreateClient();
        var (ids, group) = await SeedAsync(factory);
        var path = groupTarget ? $"/api/display-groups/{group}/commands" : $"/api/displays/{ids[0]}/commands";
        using var announcement = await client.PostAsJsonAsync(path, new { type = "announcement.show", payload = new { kind = "message", text = "Hola", layout = "banner", theme = "dark" } });
        Assert.Equal(HttpStatusCode.Accepted, announcement.StatusCode);
        foreach (var url in new[] { Url, "http://192.168.1.2:5190/halloween/2026/concurso/live" })
        {
            using var response = await client.PostAsJsonAsync(path, new { type = "WEBPAGE.SHOW", payload = new { url } });
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            var result = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("webpage.show", (groupTarget ? result.GetProperty("command") : result).GetProperty("type").GetString());
            using var scope = factory.Services.CreateScope();
            var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
            foreach (var id in groupTarget ? ids : ids.Take(1))
            {
                var recovery = await registry.GetRecoveryAsync(id);
                Assert.Equal(url, recovery?.WebPage?.GetProperty("url").GetString());
                Assert.Equal("Playing", recovery?.DesiredState);
                Assert.Equal("original", recovery?.Payload?.GetProperty("marker").GetString());
                Assert.NotNull(recovery?.Announcement);
            }
            if (!groupTarget) Assert.Null((await registry.GetRecoveryAsync(ids[1]))?.WebPage);
            var displays = await client.GetFromJsonAsync<JsonElement>("/api/displays");
            Assert.Contains(displays.EnumerateArray(), item => item.GetProperty("webPage").ValueKind == JsonValueKind.Object);
        }
        using var clear = await client.PostAsJsonAsync(path, new { type = "WEBPAGE.CLEAR" });
        Assert.Equal(HttpStatusCode.Accepted, clear.StatusCode);
        using var clearedScope = factory.Services.CreateScope();
        var cleared = await clearedScope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>().GetRecoveryAsync(ids[0]);
        Assert.Null(cleared?.WebPage);
        Assert.Equal("Playing", cleared?.DesiredState);
        Assert.NotNull(cleared?.Announcement);
    }

    [Theory]
    [InlineData("displays")]
    [InlineData("display-groups")]
    public async Task Rejects_invalid_urls_before_dispatch(string resource)
    {
        await using var factory = new WebPageApiFactory();
        using var client = factory.CreateClient();
        using var result = await client.PostAsJsonAsync($"/api/{resource}/{Guid.NewGuid()}/commands", new { type = "webpage.show", payload = new { url = "javascript:alert(1)" } });
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
    }

    [Fact]
    public async Task Empty_group_rejects_show_and_blackout_preserves_page_until_stop_reveals_it()
    {
        await using var factory = new WebPageApiFactory();
        using var client = factory.CreateClient();
        var (ids, group) = await SeedAsync(factory, false);
        using var empty = await client.PostAsJsonAsync($"/api/display-groups/{group}/commands", new { type = "webpage.show", payload = new { url = Url } });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        foreach (var type in new[] { "webpage.show", "display.blackout", "media.stop" })
        {
            using var response = await client.PostAsJsonAsync($"/api/displays/{ids[0]}/commands", new { type, payload = new { url = Url } });
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            using var scope = factory.Services.CreateScope();
            var recovery = await scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>().GetRecoveryAsync(ids[0]);
            Assert.Equal(Url, recovery?.WebPage?.GetProperty("url").GetString());
            Assert.Equal(type == "display.blackout" ? "Blackout" : type == "media.stop" ? "Stopped" : "Playing", recovery?.DesiredState);
        }
    }

    [Fact]
    public void Migration_is_additive_reversible_and_snapshot_matches()
    {
        using var db = new RevelMoviesDbContext(new DbContextOptionsBuilder<RevelMoviesDbContext>()
            .UseSqlServer("Server=localhost;Database=ScriptOnly;Integrated Security=true;TrustServerCertificate=true").Options);
        Assert.False(db.Database.HasPendingModelChanges());
        var migrator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
        Assert.Contains("ADD [web_page_json] nvarchar(max) NULL", migrator.GenerateScript("20261009120000_AddPromotionalBreaks", "20261017120000_AddWebPages"));
        Assert.Contains("DROP COLUMN [web_page_json]", migrator.GenerateScript("20261017120000_AddWebPages", "20261009120000_AddPromotionalBreaks"));
    }

    private static async Task<(Guid[] Displays, Guid Group)> SeedAsync(WebPageApiFactory factory, bool members = true)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var eventId = Guid.NewGuid();
        var displays = new[] { new Display { EventId = eventId, Name = "A" }, new Display { EventId = eventId, Name = "B" } };
        var group = new DisplayGroup { EventId = eventId, Name = "Escenario" };
        db.Displays.AddRange(displays);
        db.DisplayGroups.Add(group);
        foreach (var display in displays)
        {
            if (members) db.DisplayGroupMembers.Add(new DisplayGroupMember { DisplayId = display.Id, DisplayGroupId = group.Id });
            db.DisplayPlaybackStates.Add(new DisplayPlaybackState
            {
                DisplayId = display.Id, DesiredState = "Playing", ContentType = "Playlist", PlaylistId = Guid.NewGuid(),
                PayloadJson = "{\"marker\":\"original\"}", StartedAt = DateTimeOffset.UtcNow.AddMinutes(-1)
            });
        }
        await db.SaveChangesAsync();
        return (displays.Select(display => display.Id).ToArray(), group.Id);
    }

    private sealed class WebPageApiFactory : WebApplicationFactory<PlayerHub>
    {
        private readonly string databaseName = Guid.NewGuid().ToString();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:ApplyMigrationsOnStartup"] = "false"
            }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseInMemoryDatabase(databaseName));
            });
        }
    }
}
