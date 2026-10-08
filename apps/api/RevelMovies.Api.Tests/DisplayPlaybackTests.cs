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
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Playback;
using RevelMovies.Infrastructure.Persistence;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class DisplayPlaybackTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Repeat_is_persisted_per_display_and_survives_stop_and_play(bool playlist)
    {
        await using var factory = new PlaybackApiFactory();
        using var client = factory.CreateClient();
        var id = await SeedAsync(factory, playlist);
        var otherId = await SeedAsync(factory, playlist);
        var path = $"/api/displays/{id}/commands";

        using var repeated = await client.PostAsJsonAsync(path, new { type = "playback.loop", payload = new { loop = true } });
        Assert.Equal(HttpStatusCode.Accepted, repeated.StatusCode);
        var displays = await client.GetFromJsonAsync<JsonElement>("/api/displays");
        var display = displays.EnumerateArray().Single(x => x.GetProperty("id").GetGuid() == id);
        Assert.True(display.GetProperty("playbackLoop").GetBoolean());
        Assert.Equal(playlist ? "Playlist" : "Media", display.GetProperty("playbackContentType").GetString());
        Assert.False(displays.EnumerateArray().Single(x => x.GetProperty("id").GetGuid() == otherId).GetProperty("playbackLoop").GetBoolean());

        using var stopped = await client.PostAsJsonAsync(path, new { type = "media.stop" });
        Assert.Equal(HttpStatusCode.Accepted, stopped.StatusCode);
        using var resumed = await client.PostAsJsonAsync(path, new { type = "playback.resume" });
        Assert.Equal(HttpStatusCode.Accepted, resumed.StatusCode);
        var command = await resumed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("playback.resume", command.GetProperty("type").GetString());
        Assert.Equal(0, command.GetProperty("payload").GetProperty("resumePositionSeconds").GetDouble());
        Assert.Equal(0, command.GetProperty("payload").GetProperty("resumePlaylistIndex").GetInt32());

        using var scope = factory.Services.CreateScope();
        var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var recovery = await registry.GetRecoveryAsync(id);
        Assert.True(recovery!.Payload!.Value.GetProperty("loop").GetBoolean());
        Assert.Equal("Playing", recovery.DesiredState);
        Assert.NotNull(recovery.Announcement);
        if (playlist) Assert.Equal(0, recovery.ResumePlaylistIndex);

        using var once = await client.PostAsJsonAsync(path, new { type = "playback.loop", payload = new { loop = false } });
        Assert.Equal(HttpStatusCode.Accepted, once.StatusCode);
        Assert.False((await registry.GetRecoveryAsync(id))!.Payload!.Value.GetProperty("loop").GetBoolean());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Paused_content_resumes_at_the_saved_position(bool playlist)
    {
        await using var factory = new PlaybackApiFactory();
        using var client = factory.CreateClient();
        var id = await SeedAsync(factory, playlist);
        var path = $"/api/displays/{id}/commands";
        using var pause = await client.PostAsJsonAsync(path, new { type = "media.pause" });
        using var resume = await client.PostAsJsonAsync(path, new { type = "playback.resume" });
        Assert.Equal(HttpStatusCode.Accepted, resume.StatusCode);
        var command = await resume.Content.ReadFromJsonAsync<JsonElement>();
        var recovery = command.GetProperty("payload");
        Assert.InRange(recovery.GetProperty("resumePositionSeconds").GetDouble(), 7, 9);
        if (playlist) Assert.Equal(2, recovery.GetProperty("resumePlaylistIndex").GetInt32());
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("{\"loop\":\"true\"}")]
    [InlineData("{\"loop\":1}")]
    public async Task Repeat_rejects_invalid_payloads(string json)
    {
        await using var factory = new PlaybackApiFactory();
        using var client = factory.CreateClient();
        var id = await SeedAsync(factory);
        using var response = await client.PostAsJsonAsync($"/api/displays/{id}/commands",
            new { type = "playback.loop", payload = JsonSerializer.Deserialize<JsonElement>(json) });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("playback.resume")]
    [InlineData("playback.loop")]
    public async Task Unassigned_displays_cannot_play_or_repeat(string type)
    {
        await using var factory = new PlaybackApiFactory();
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var display = new Display { EventId = Guid.NewGuid(), Name = "Empty TV" };
        db.Displays.Add(display);
        await db.SaveChangesAsync();
        using var response = await client.PostAsJsonAsync($"/api/displays/{display.Id}/commands", new { type, payload = new { loop = true } });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Looping_video_telemetry_and_recovery_wrap_at_the_video_duration()
    {
        await using var factory = new PlaybackApiFactory();
        using var client = factory.CreateClient();
        var id = await SeedAsync(factory);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var state = await db.DisplayPlaybackStates.SingleAsync(x => x.DisplayId == id);
        state.PayloadJson = JsonSerializer.Serialize(new { mediaId = state.MediaAssetId, mediaType = "Video", loop = true });
        state.StartedAt = DateTimeOffset.UtcNow.AddSeconds(-32);
        await db.SaveChangesAsync();
        var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var result = await registry.ReportAsync(id, new PlaybackTelemetryReport("Playing", state.MediaAssetId, null, null, 2, 10));
        Assert.Null(result.SeekToSeconds);
        Assert.Equal("Synchronized", result.Health);
        Assert.InRange((await registry.GetRecoveryAsync(id))!.ResumePositionSeconds!.Value, 2, 3);
        await registry.SetLoopAsync(id, false, Guid.NewGuid());
        Assert.InRange((await registry.GetRecoveryAsync(id))!.ResumePositionSeconds!.Value, 2, 3);
    }

    [Fact]
    public async Task Finished_video_can_be_played_again_from_the_start()
    {
        await using var factory = new PlaybackApiFactory();
        using var client = factory.CreateClient();
        var id = await SeedAsync(factory);
        using var scope = factory.Services.CreateScope();
        var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var state = await registry.GetAsync(id);
        await registry.ReportAsync(id, new PlaybackTelemetryReport("Ended", state!.MediaAssetId, null, null, 10, 10));
        Assert.Equal("Stopped", (await registry.GetRecoveryAsync(id))!.DesiredState);
        var resume = await registry.ResumeAsync(id, Guid.NewGuid());
        Assert.Equal(0, resume!.ResumePositionSeconds);
    }

    private static async Task<Guid> SeedAsync(PlaybackApiFactory factory, bool playlist = false)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var display = new Display { EventId = Guid.NewGuid(), Name = "Test TV", Status = DisplayStatus.Online };
        var media = new MediaAsset { EventId = display.EventId, Name = "Clip", Type = MediaType.Video };
        var playlistId = Guid.NewGuid();
        db.Displays.Add(display);
        db.MediaAssets.Add(media);
        db.DisplayPlaybackStates.Add(new DisplayPlaybackState
        {
            DisplayId = display.Id, DesiredState = "Playing", ContentType = playlist ? "Playlist" : "Media",
            MediaAssetId = playlist ? null : media.Id, PlaylistId = playlist ? playlistId : null,
            PayloadJson = playlist
                ? JsonSerializer.Serialize(new { playlistId, loop = false, items = new[] { new { mediaId = media.Id, mediaType = "Video" } } })
                : JsonSerializer.Serialize(new { mediaId = media.Id, mediaType = "Video" }),
            StartedAt = DateTimeOffset.UtcNow.AddSeconds(-7), ActualPositionSeconds = 7,
            ActualPlaylistIndex = playlist ? 2 : null, ActualDurationSeconds = 10,
            AnnouncementJson = "{\"kind\":\"message\",\"text\":\"Hello\",\"layout\":\"banner\",\"theme\":\"dark\"}"
        });
        await db.SaveChangesAsync();
        return display.Id;
    }

    private sealed class PlaybackApiFactory : WebApplicationFactory<PlayerHub>
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
