using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using RevelMovies.Api.Hubs;
using RevelMovies.Api.Runtime;
using RevelMovies.Application.Commands;
using RevelMovies.Domain.Commands;
using RevelMovies.Domain.DisplayGroups;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Pairing;
using RevelMovies.Domain.Playback;
using RevelMovies.Domain.Playlists;
using RevelMovies.Infrastructure.Persistence;
using Xunit;
using RevelEvent = RevelMovies.Domain.Events.Event;

namespace RevelMovies.Api.Tests;

public sealed class DisplayDeletionTests
{
    private const string DeviceToken = "paired-device-token";

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Deletion_revokes_identity_cleans_dependents_and_preserves_event_content(bool notificationFails)
    {
        await using var factory = new DisplayApiFactory();
        using var client = factory.CreateClient();
        var (displayId, otherId) = await SeedAsync(factory);
        var notifications = factory.Services.GetRequiredService<RecordingHubLifetimeManager>();
        notifications.FailSend = notificationFails;
        client.DefaultRequestHeaders.Add("X-Device-Token", DeviceToken);
        using var before = await client.GetAsync("/api/player/identity");
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);

        using var response = await client.DeleteAsync($"/api/displays/{displayId}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        using var identity = await client.GetAsync("/api/player/identity");
        Assert.Equal(HttpStatusCode.Unauthorized, identity.StatusCode);
        var displays = await client.GetFromJsonAsync<JsonElement>("/api/displays");
        Assert.Equal(otherId, Assert.Single(displays.EnumerateArray()).GetProperty("id").GetGuid());
        var notification = Assert.Single(notifications.Sent);
        Assert.Equal(PlayerHub.GroupName(displayId), notification.Group);
        Assert.Equal("display.unpaired", notification.Command.Type);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        Assert.False(await db.PairingSessions.AnyAsync(x => x.DisplayId == displayId));
        Assert.False(await db.DisplayGroupMembers.AnyAsync(x => x.DisplayId == displayId));
        Assert.False(await db.DisplayPlaybackStates.AnyAsync(x => x.DisplayId == displayId));
        Assert.False(await db.CommandAcknowledgements.AnyAsync(x => x.DisplayId == displayId));
        Assert.True(await db.PairingSessions.AnyAsync(x => x.DisplayId == otherId));
        Assert.True(await db.DisplayGroupMembers.AnyAsync(x => x.DisplayId == otherId));
        Assert.True(await db.DisplayPlaybackStates.AnyAsync(x => x.DisplayId == otherId));
        Assert.True(await db.CommandAcknowledgements.AnyAsync(x => x.DisplayId == otherId));
        Assert.Equal(1, await db.Events.CountAsync());
        Assert.Equal(1, await db.DisplayGroups.CountAsync());
        Assert.Equal(1, await db.MediaAssets.CountAsync());
        Assert.Equal(1, await db.Playlists.CountAsync());
        Assert.Equal(1, await db.PlaylistItems.CountAsync());

        using var again = await client.DeleteAsync($"/api/displays/{displayId}");
        Assert.Equal(HttpStatusCode.NotFound, again.StatusCode);
        Assert.Single(notifications.Sent);
    }

    [Fact]
    public async Task Unknown_display_returns_not_found_without_changing_existing_devices()
    {
        await using var factory = new DisplayApiFactory();
        using var client = factory.CreateClient();
        await SeedAsync(factory);
        using var response = await client.DeleteAsync($"/api/displays/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using var scope = factory.Services.CreateScope();
        Assert.Equal(2, await scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>().Displays.CountAsync());
        Assert.Empty(factory.Services.GetRequiredService<RecordingHubLifetimeManager>().Sent);
    }

    [Fact]
    public async Task Existing_connection_cannot_recreate_playback_or_acknowledgements_after_deletion()
    {
        await using var factory = new DisplayApiFactory();
        using var client = factory.CreateClient();
        var (displayId, _) = await SeedAsync(factory);
        using var deleted = await client.DeleteAsync($"/api/displays/{displayId}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        using var scope = factory.Services.CreateScope();
        var context = new ExistingConnectionContext(displayId);
        using var hub = new PlayerHub(
            scope.ServiceProvider.GetRequiredService<DisplayRegistry>(),
            scope.ServiceProvider.GetRequiredService<CommandAcknowledgementRegistry>(),
            scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>()) { Context = context };

        Assert.Null(await hub.ReportPlayback("Playing", null, null, null, 10, 60));
        await hub.Acknowledge(Guid.NewGuid(), "media.play", "executed", null, null);
        await hub.Heartbeat();
        await hub.ReportClockSample(10, 20);
        Assert.Null(await hub.GetDesiredPlaybackState());
        Assert.True(context.Aborted);
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        Assert.False(await db.DisplayPlaybackStates.AnyAsync(x => x.DisplayId == displayId));
        Assert.False(await db.CommandAcknowledgements.AnyAsync(x => x.DisplayId == displayId));
    }

    private static async Task<(Guid DisplayId, Guid OtherId)> SeedAsync(DisplayApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        await db.Database.EnsureCreatedAsync();
        var item = new RevelEvent { Name = "Event", Slug = "event" };
        var display = new Display
        {
            EventId = item.Id, Name = "Remove me",
            DeviceTokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(DeviceToken))).ToLowerInvariant()
        };
        var other = new Display { EventId = item.Id, Name = "Keep me", DeviceTokenHash = "other-token-hash" };
        var group = new DisplayGroup { EventId = item.Id, Name = "Group" };
        var media = new MediaAsset { EventId = item.Id, Name = "Video", StorageKey = "video.mp4" };
        var playlist = new Playlist { EventId = item.Id, Name = "Playlist" };
        db.AddRange(item, display, other, group, media, playlist);
        db.PlaylistItems.Add(new PlaylistItem { PlaylistId = playlist.Id, MediaAssetId = media.Id });
        foreach (var device in new[] { display, other })
        {
            var session = new PairingSession(Guid.NewGuid().ToString("N"), "123456", DateTimeOffset.UtcNow.AddMinutes(10));
            session.Pair(device.Id, device == display ? DeviceToken : "other-device-token");
            db.PairingSessions.Add(session);
            db.DisplayGroupMembers.Add(new DisplayGroupMember { DisplayId = device.Id, DisplayGroupId = group.Id });
            db.DisplayPlaybackStates.Add(new DisplayPlaybackState
            {
                DisplayId = device.Id, DesiredState = "Playing", MediaAssetId = media.Id,
                AnnouncementJson = "{\"kind\":\"message\",\"text\":\"Hello\"}"
            });
            db.CommandAcknowledgements.Add(new CommandAcknowledgement
            {
                DisplayId = device.Id, CommandId = Guid.NewGuid(), CommandType = "media.play", Status = "executed"
            });
        }
        await db.SaveChangesAsync();
        return (display.Id, other.Id);
    }

    private sealed class DisplayApiFactory : WebApplicationFactory<PlayerHub>
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:;Foreign Keys=True");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            connection.Open();
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:ApplyMigrationsOnStartup"] = "false"
            }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseSqlite(connection));
                services.AddSingleton<RecordingHubLifetimeManager>();
                services.AddSingleton<HubLifetimeManager<PlayerHub>>(provider => provider.GetRequiredService<RecordingHubLifetimeManager>());
            });
        }

        public override async ValueTask DisposeAsync()
        {
            await base.DisposeAsync();
            await connection.DisposeAsync();
        }
    }

    private sealed class RecordingHubLifetimeManager(ILogger<DefaultHubLifetimeManager<PlayerHub>> logger)
        : DefaultHubLifetimeManager<PlayerHub>(logger)
    {
        public List<(string Group, PlayerCommand Command)> Sent { get; } = [];
        public bool FailSend { get; set; }

        public override Task SendGroupAsync(string groupName, string methodName, object?[] args, CancellationToken cancellationToken = default)
        {
            Assert.Equal("command", methodName);
            Sent.Add((groupName, Assert.IsType<PlayerCommand>(Assert.Single(args))));
            return FailSend ? Task.FromException(new IOException("Connection closed")) : Task.CompletedTask;
        }
    }

    private sealed class ExistingConnectionContext(Guid displayId) : HubCallerContext
    {
        public bool Aborted { get; private set; }
        public override string ConnectionId => "existing-connection";
        public override string? UserIdentifier => null;
        public override ClaimsPrincipal? User => null;
        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?> { ["display-id"] = displayId };
        public override IFeatureCollection Features { get; } = new FeatureCollection();
        public override CancellationToken ConnectionAborted => CancellationToken.None;
        public override void Abort() => Aborted = true;
    }
}
