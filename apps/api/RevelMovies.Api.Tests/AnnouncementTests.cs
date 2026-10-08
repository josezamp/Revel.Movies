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

public sealed class AnnouncementTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-08T12:00:00Z");
    private static object Countdown(int seconds = 300) => new
    {
        kind = "countdown", text = "  Comenzamos pronto  ", layout = "fullscreen", theme = "dark",
        durationSeconds = seconds, completedText = "¡Comenzamos!"
    };

    [Fact]
    public void Countdown_uses_server_deadline_and_trims_text()
    {
        Assert.Null(AnnouncementCommand.Validate(JsonSerializer.SerializeToElement(Countdown()), Now, out var payload));
        Assert.Equal(Now.AddMinutes(5), payload.GetProperty("endsAt").GetDateTimeOffset());
        Assert.Equal("Comenzamos pronto", payload.GetProperty("text").GetString());
        Assert.False(payload.TryGetProperty("durationSeconds", out _));
    }

    [Theory]
    [InlineData("2026-10-08T09:30:00-03:00", true)]
    [InlineData("2026-10-08T12:30:00Z", true)]
    [InlineData("2026-10-08T12:30:00", false)]
    [InlineData("2026-10-08T11:59:00Z", false)]
    [InlineData("2026-10-16T12:00:00Z", false)]
    [InlineData("invalid", false)]
    public void Deadline_requires_a_future_time_with_an_explicit_zone(string endsAt, bool valid)
    {
        var input = JsonSerializer.SerializeToElement(new { kind = "countdown", text = "Inicio", layout = "banner", theme = "light", endsAt, completedText = "Listo" });
        var error = AnnouncementCommand.Validate(input, Now, out var payload);
        Assert.Equal(valid, error is null);
        if (valid) Assert.Equal(Now.AddMinutes(30), payload.GetProperty("endsAt").GetDateTimeOffset());
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{\"kind\":\"html\"}")]
    [InlineData("{\"kind\":\"message\",\"text\":\" \",\"layout\":\"fullscreen\",\"theme\":\"dark\"}")]
    [InlineData("{\"kind\":\"message\",\"text\":\"Hi\",\"layout\":\"invalid\",\"theme\":\"dark\"}")]
    [InlineData("{\"kind\":\"message\",\"text\":\"Hi\",\"layout\":\"banner\",\"theme\":\"invalid\"}")]
    [InlineData("{\"kind\":\"countdown\",\"text\":\"Hi\",\"layout\":\"banner\",\"theme\":\"dark\",\"completedText\":\"Done\"}")]
    [InlineData("{\"kind\":\"countdown\",\"text\":\"Hi\",\"layout\":\"banner\",\"theme\":\"dark\",\"completedText\":\"Done\",\"durationSeconds\":2,\"endsAt\":\"2026-10-08T12:30:00Z\"}")]
    public void Rejects_malformed_content(string json) =>
        Assert.NotNull(AnnouncementCommand.Validate(JsonSerializer.Deserialize<JsonElement>(json), Now, out _));

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(604801)]
    public void Rejects_invalid_durations(int seconds) =>
        Assert.NotNull(AnnouncementCommand.Validate(JsonSerializer.SerializeToElement(Countdown(seconds)), Now, out _));

    [Fact]
    public void Rejects_overlong_messages() => Assert.NotNull(AnnouncementCommand.Validate(
        JsonSerializer.SerializeToElement(new { kind = "message", text = new string('x', 241), layout = "banner", theme = "dark" }), Now, out _));

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Dispatch_persists_same_deadline_and_clear_preserves_playback(bool groupTarget)
    {
        await using var factory = new AnnouncementApiFactory();
        using var client = factory.CreateClient();
        var (displayIds, groupId) = await SeedAsync(factory);
        var path = groupTarget ? $"/api/display-groups/{groupId}/commands" : $"/api/displays/{displayIds[0]}/commands";
        var before = DateTimeOffset.UtcNow;
        using var response = await client.PostAsJsonAsync(path, new { type = "ANNOUNCEMENT.SHOW", payload = Countdown() });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        using var scope = factory.Services.CreateScope();
        var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        DateTimeOffset? commonDeadline = null;
        foreach (var id in groupTarget ? displayIds : displayIds.Take(1))
        {
            // Reading through a fresh scope represents reconnect/reload, not in-memory UI state.
            var recovery = await registry.GetRecoveryAsync(id);
            Assert.NotNull(recovery?.Announcement);
            var deadline = recovery.Announcement.Value.GetProperty("endsAt").GetDateTimeOffset();
            Assert.InRange(deadline, before.AddSeconds(300), DateTimeOffset.UtcNow.AddSeconds(300));
            if (commonDeadline.HasValue) Assert.Equal(commonDeadline.Value, deadline);
            commonDeadline = deadline;
            Assert.Equal("Playing", recovery.DesiredState);
            Assert.Equal("Playlist", recovery.ContentType);
        }
        if (!groupTarget) Assert.Null((await registry.GetRecoveryAsync(displayIds[1]))?.Announcement);

        var displays = await client.GetFromJsonAsync<JsonElement>("/api/displays");
        Assert.Contains(displays.EnumerateArray(), item => item.GetProperty("announcement").ValueKind == JsonValueKind.Object);

        using var clear = await client.PostAsJsonAsync(path, new { type = "announcement.clear" });
        Assert.Equal(HttpStatusCode.Accepted, clear.StatusCode);
        var cleared = await registry.GetRecoveryAsync(displayIds[0]);
        Assert.Null(cleared?.Announcement);
        Assert.Equal("Playing", cleared?.DesiredState);
        Assert.Equal("Playlist", cleared?.ContentType);
        Assert.Equal("original", cleared?.Payload?.GetProperty("marker").GetString());
    }

    [Theory]
    [InlineData("media.pause")]
    [InlineData("media.stop")]
    [InlineData("playlist.stop")]
    [InlineData("display.blackout")]
    public async Task Playback_controls_preserve_the_independent_announcement(string command)
    {
        await using var factory = new AnnouncementApiFactory();
        using var client = factory.CreateClient();
        var (ids, _) = await SeedAsync(factory);
        var path = $"/api/displays/{ids[0]}/commands";
        using var shown = await client.PostAsJsonAsync(path, new { type = "announcement.show", payload = Countdown() });
        Assert.Equal(HttpStatusCode.Accepted, shown.StatusCode);
        using var controlled = await client.PostAsJsonAsync(path, new { type = command });
        Assert.Equal(HttpStatusCode.Accepted, controlled.StatusCode);
        using var scope = factory.Services.CreateScope();
        var recovery = await scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>().GetRecoveryAsync(ids[0]);
        Assert.NotNull(recovery?.Announcement);
        if (command == "display.blackout") Assert.Equal("Blackout", recovery.DesiredState);
    }

    [Theory]
    [InlineData("displays")]
    [InlineData("display-groups")]
    public async Task Invalid_requests_are_rejected_before_target_lookup(string resource)
    {
        await using var factory = new AnnouncementApiFactory();
        using var client = factory.CreateClient();
        using var response = await client.PostAsJsonAsync($"/api/{resource}/{Guid.NewGuid()}/commands", new { type = "announcement.show", payload = Countdown(0) });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Empty_groups_cannot_receive_announcements()
    {
        await using var factory = new AnnouncementApiFactory();
        using var client = factory.CreateClient();
        var (_, groupId) = await SeedAsync(factory, false);
        using var response = await client.PostAsJsonAsync($"/api/display-groups/{groupId}/commands", new { type = "announcement.show", payload = Countdown() });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static async Task<(Guid[] Displays, Guid Group)> SeedAsync(AnnouncementApiFactory factory, bool members = true)
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

    private sealed class AnnouncementApiFactory : WebApplicationFactory<PlayerHub>
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
