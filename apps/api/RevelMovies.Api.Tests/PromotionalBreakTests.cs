using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RevelMovies.Api.Hubs;
using RevelMovies.Api.Runtime;
using RevelMovies.Domain.DisplayGroups;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Playback;
using RevelMovies.Domain.Playlists;
using RevelMovies.Infrastructure.Persistence;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class PromotionalBreakTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Configuration_is_scoped_to_targets_and_does_not_restart_playback(bool group)
    {
        await using var factory = new PromotionApiFactory();
        using var client = factory.CreateClient();
        var seed = await SeedAsync(factory);
        using var configured = await ConfigureAsync(client, seed, group);
        Assert.Equal(HttpStatusCode.Accepted, configured.StatusCode);
        using var scope = factory.Services.CreateScope();
        var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var first = await registry.GetRecoveryAsync(seed.Displays[0]);
        Assert.Equal(seed.PlaylistId, first!.PromotionPolicy!.PlaylistId);
        Assert.Equal(5, first.PromotionPolicy.EveryVideos);
        Assert.Equal("Playing", first.DesiredState);
        Assert.Equal(seed.PlaybackId, first.Payload!.Value.GetProperty("playbackId").GetString());
        var second = await registry.GetRecoveryAsync(seed.Displays[1]);
        if (group) Assert.Equal(first.PromotionPolicy.Id, second!.PromotionPolicy!.Id);
        else Assert.Null(second!.PromotionPolicy);
        Assert.Null((await registry.GetRecoveryAsync(seed.Displays[2]))!.PromotionPolicy);
        var displays = await client.GetFromJsonAsync<JsonElement>("/api/displays");
        Assert.True(displays.EnumerateArray().Single(x => x.GetProperty("id").GetGuid() == seed.Displays[0])
            .GetProperty("promotionPolicy").GetProperty("enabled").GetBoolean());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(101)]
    public async Task Rejects_invalid_frequencies(int everyVideos)
    {
        await using var factory = new PromotionApiFactory();
        using var client = factory.CreateClient();
        var seed = await SeedAsync(factory);
        using var response = await ConfigureAsync(client, seed, everyVideos: everyVideos);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("empty")]
    [InlineData("image")]
    [InlineData("foreign")]
    public async Task Rejects_empty_mixed_or_foreign_promotion_playlists(string kind)
    {
        await using var factory = new PromotionApiFactory();
        using var client = factory.CreateClient();
        var seed = await SeedAsync(factory);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            if (kind == "empty") db.PlaylistItems.RemoveRange(await db.PlaylistItems.ToListAsync());
            if (kind == "image") (await db.MediaAssets.SingleAsync(x => x.Id == seed.PromoId)).Type = MediaType.Image;
            if (kind == "foreign") (await db.Playlists.SingleAsync()).EventId = Guid.NewGuid();
            await db.SaveChangesAsync();
        }
        using var response = await ConfigureAsync(client, seed);
        Assert.Equal(kind == "foreign" ? HttpStatusCode.NotFound : HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Group_membership_is_resolved_once_and_individual_rules_replace_group_rules()
    {
        await using var factory = new PromotionApiFactory();
        using var client = factory.CreateClient();
        var seed = await SeedAsync(factory);
        using var applied = await ConfigureAsync(client, seed, group: true);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            db.DisplayGroupMembers.Add(new DisplayGroupMember { DisplayGroupId = seed.GroupId, DisplayId = seed.Displays[2] });
            await db.SaveChangesAsync();
        }
        using var replacement = await ConfigureAsync(client, seed, everyVideos: 6);
        using var read = factory.Services.CreateScope();
        var registry = read.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        Assert.Equal(6, (await registry.GetRecoveryAsync(seed.Displays[0]))!.PromotionPolicy!.EveryVideos);
        Assert.Equal(5, (await registry.GetRecoveryAsync(seed.Displays[1]))!.PromotionPolicy!.EveryVideos);
        Assert.Null((await registry.GetRecoveryAsync(seed.Displays[2]))!.PromotionPolicy);
    }

    [Fact]
    public async Task Rejects_empty_groups_and_targets_from_other_events()
    {
        await using var factory = new PromotionApiFactory();
        using var client = factory.CreateClient();
        var seed = await SeedAsync(factory);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            db.DisplayGroupMembers.RemoveRange(await db.DisplayGroupMembers.ToListAsync());
            await db.SaveChangesAsync();
        }
        using var empty = await ConfigureAsync(client, seed, group: true);
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        using var foreign = await ConfigureAsync(client, seed with { EventId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
    }

    [Fact]
    public async Task Reload_and_disabling_preserve_active_promotion_and_main_cursor()
    {
        await using var factory = new PromotionApiFactory();
        using var client = factory.CreateClient();
        var seed = await SeedAsync(factory);
        using var configured = await ConfigureAsync(client, seed);
        using (var scope = factory.Services.CreateScope())
        {
            var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
            var policy = (await registry.GetRecoveryAsync(seed.Displays[0]))!.PromotionPolicy!;
            await registry.ReportPlaylistAsync(seed.Displays[0], Report(seed, active: true),
                new(seed.PlaybackId, policy.Id, 0, 0, seed.PromoId, 8));
        }
        using var disabled = await ConfigureAsync(client, seed, enabled: false);
        Assert.Equal(HttpStatusCode.Accepted, disabled.StatusCode);
        using var read = factory.Services.CreateScope();
        var registryAfterReload = read.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var recovery = await registryAfterReload.GetRecoveryAsync(seed.Displays[0]);
        Assert.False(recovery!.PromotionPolicy!.Enabled);
        Assert.Equal(seed.PromoId, recovery.PromotionProgress!.ActiveMediaId);
        Assert.Equal(1, recovery.ResumePlaylistIndex);
        Assert.Equal(7, recovery.ResumePositionSeconds);
        Assert.NotNull(recovery.Announcement);
        // A player applies the new policy without ending its current promo, then reports the return.
        await registryAfterReload.ReportPlaylistAsync(seed.Displays[0], Report(seed, active: false),
            recovery.PromotionProgress with { PolicyId = recovery.PromotionPolicy.Id, ActiveMediaId = null, Sequence = 10 });
        Assert.Null((await registryAfterReload.GetRecoveryAsync(seed.Displays[0]))!.PromotionProgress!.ActiveMediaId);
    }

    [Fact]
    public async Task Stale_reports_cannot_restore_previous_policy_or_promotion()
    {
        await using var factory = new PromotionApiFactory();
        using var client = factory.CreateClient();
        var seed = await SeedAsync(factory);
        using var configured = await ConfigureAsync(client, seed);
        using var scope = factory.Services.CreateScope();
        var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var policy = (await registry.GetRecoveryAsync(seed.Displays[0]))!.PromotionPolicy!;
        var progress = new PromotionProgress(seed.PlaybackId, policy.Id, 0, 0, null, 20);
        await registry.ReportPlaylistAsync(seed.Displays[0], Report(seed, false), progress);
        await registry.ReportPlaylistAsync(seed.Displays[0], Report(seed, true), progress with { ActiveMediaId = seed.PromoId, Sequence = 19 });
        await registry.ReportPlaylistAsync(seed.Displays[0], Report(seed, true), progress with { PolicyId = Guid.NewGuid(), ActiveMediaId = seed.PromoId, Sequence = 21 });
        await registry.ReportPlaylistAsync(seed.Displays[0], Report(seed, true), progress with { PlaybackId = "old", ActiveMediaId = seed.PromoId, Sequence = 22 });
        Assert.Equal(progress, (await registry.GetRecoveryAsync(seed.Displays[0]))!.PromotionProgress);
    }

    [Fact]
    public async Task Pause_resume_preserves_promotion_but_stop_and_play_starts_a_new_session()
    {
        await using var factory = new PromotionApiFactory();
        using var client = factory.CreateClient();
        var seed = await SeedAsync(factory);
        using var configured = await ConfigureAsync(client, seed);
        using var scope = factory.Services.CreateScope();
        var registry = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var policy = (await registry.GetRecoveryAsync(seed.Displays[0]))!.PromotionPolicy!;
        var progress = new PromotionProgress(seed.PlaybackId, policy.Id, 0, 0, seed.PromoId, 10);
        await registry.ReportPlaylistAsync(seed.Displays[0], Report(seed, true), progress);
        await registry.ApplyControlAsync([seed.Displays[0]], "playlist.pause", Guid.NewGuid());
        var paused = await registry.GetRecoveryAsync(seed.Displays[0]);
        Assert.Equal(7, paused!.ResumePositionSeconds);
        var resumed = await registry.ResumeAsync(seed.Displays[0], Guid.NewGuid());
        Assert.Equal(seed.PromoId, resumed!.PromotionProgress!.ActiveMediaId);
        await registry.ApplyControlAsync([seed.Displays[0]], "playlist.stop", Guid.NewGuid());
        var restarted = await registry.ResumeAsync(seed.Displays[0], Guid.NewGuid());
        Assert.Null(restarted!.PromotionProgress);
        Assert.NotEqual(seed.PlaybackId, restarted.Payload!.Value.GetProperty("playbackId").GetString());
        Assert.Equal(0, restarted.ResumePositionSeconds);
        Assert.Equal(0, restarted.ResumePlaylistIndex);
        Assert.True(restarted.PromotionPolicy!.Enabled);
        await registry.ReportPlaylistAsync(seed.Displays[0], Report(seed, true), progress with { Sequence = 100 });
        Assert.Null((await registry.GetRecoveryAsync(seed.Displays[0]))!.PromotionProgress);
    }

    [Theory]
    [InlineData("displays")]
    [InlineData("display-groups")]
    public async Task Generic_commands_cannot_bypass_promotion_validation(string resource)
    {
        await using var factory = new PromotionApiFactory();
        using var client = factory.CreateClient();
        using var result = await client.PostAsJsonAsync($"/api/{resource}/{Guid.NewGuid()}/commands", new { type = "promotions.configure", payload = new { enabled = true } });
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
    }

    [Fact]
    public void Sql_server_migration_and_model_snapshot_include_both_checkpoint_columns()
    {
        using var db = new RevelMoviesDbContext(new DbContextOptionsBuilder<RevelMoviesDbContext>()
            .UseSqlServer("Server=localhost;Database=MigrationScriptOnly;Integrated Security=true;TrustServerCertificate=true").Options);
        Assert.False(db.Database.HasPendingModelChanges());
        var script = db.GetService<IMigrator>().GenerateScript("20261008120000_AddAnnouncements", "20261009120000_AddPromotionalBreaks");
        Assert.Contains("promotion_policy_json", script);
        Assert.Contains("promotion_progress_json", script);
    }

    private static PlaybackTelemetryReport Report(Seed seed, bool active) =>
        new("Playing", active ? seed.PromoId : seed.MainId, seed.MainPlaylistId, 1, 7, 30);

    private static Task<HttpResponseMessage> ConfigureAsync(HttpClient client, Seed seed, bool group = false, bool enabled = true, int everyVideos = 5) =>
        client.PutAsJsonAsync($"/api/events/{seed.EventId}/promotional-breaks", new {
            targetType = group ? "group" : "display", targetId = group ? seed.GroupId : seed.Displays[0],
            enabled, playlistId = seed.PlaylistId, everyVideos,
        });

    private sealed record Seed(Guid EventId, Guid[] Displays, Guid GroupId, Guid PlaylistId, Guid PromoId, Guid MainId, Guid MainPlaylistId, string PlaybackId);

    private static async Task<Seed> SeedAsync(PromotionApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var eventId = Guid.NewGuid();
        var displays = Enumerable.Range(1, 3).Select(i => new Display { Name = $"TV {i}", EventId = eventId }).ToArray();
        var group = new DisplayGroup { Name = "Recepción", EventId = eventId };
        var promo = new MediaAsset { EventId = eventId, Name = "Promo", Type = MediaType.Video };
        var main = new MediaAsset { EventId = eventId, Name = "Principal", Type = MediaType.Video };
        var playlist = new Playlist { Name = "Promociones", EventId = eventId };
        var mainPlaylistId = Guid.NewGuid();
        var playbackId = Guid.NewGuid().ToString();
        db.Displays.AddRange(displays);
        db.DisplayGroups.Add(group);
        db.MediaAssets.AddRange(promo, main);
        db.Playlists.Add(playlist);
        db.PlaylistItems.Add(new PlaylistItem { PlaylistId = playlist.Id, MediaAssetId = promo.Id, Position = 0 });
        foreach (var display in displays)
        {
            if (display != displays[2]) db.DisplayGroupMembers.Add(new DisplayGroupMember { DisplayGroupId = group.Id, DisplayId = display.Id });
            db.DisplayPlaybackStates.Add(new DisplayPlaybackState {
                DisplayId = display.Id, ContentType = "Playlist", PlaylistId = mainPlaylistId, DesiredState = "Playing", Health = "Playing",
                StartedAt = DateTimeOffset.UtcNow.AddMinutes(-1), ActualPlaylistIndex = 1, ActualPositionSeconds = 7,
                AnnouncementJson = "{\"kind\":\"message\",\"text\":\"Hola\",\"layout\":\"banner\",\"theme\":\"dark\"}",
                PayloadJson = JsonSerializer.Serialize(new { playlistId = mainPlaylistId, playbackId, loop = true,
                    items = new[] { new { mediaId = main.Id, mediaType = "Video" }, new { mediaId = main.Id, mediaType = "Video" } } }),
            });
        }
        await db.SaveChangesAsync();
        return new(eventId, displays.Select(x => x.Id).ToArray(), group.Id, playlist.Id, promo.Id, main.Id, mainPlaylistId, playbackId);
    }

    private sealed class PromotionApiFactory : WebApplicationFactory<PlayerHub>
    {
        private readonly string databaseName = Guid.NewGuid().ToString();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["Database:ApplyMigrationsOnStartup"] = "false" }));
            builder.ConfigureServices(services => {
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseInMemoryDatabase(databaseName));
            });
        }
    }
}
