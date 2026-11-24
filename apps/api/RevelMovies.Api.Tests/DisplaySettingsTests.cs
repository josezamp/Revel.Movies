using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using RevelMovies.Api.Hubs;
using RevelMovies.Application.Commands;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Playback;
using RevelMovies.Infrastructure.Persistence;
using Xunit;
using RevelEvent = RevelMovies.Domain.Events.Event;

namespace RevelMovies.Api.Tests;

public sealed class DisplaySettingsTests
{
    private const string DeviceToken = "display-fit-device-token";

    [Fact]
    public void Migration_keeps_existing_displays_in_contain_mode()
    {
        using var db = new RevelMoviesDbContext(new DbContextOptionsBuilder<RevelMoviesDbContext>()
            .UseSqlServer("Server=localhost;Database=ScriptOnly;Integrated Security=true;TrustServerCertificate=true").Options);
        var script = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>()
            .GenerateScript("20261029132437_AddSceneSchedules", "20261031120000_AddDisplayImageFit");
        Assert.Contains("ALTER TABLE [displays] ADD [image_fit] nvarchar(16) NOT NULL DEFAULT N'contain'", script);
    }

    [Fact]
    public void Migration_enables_audio_for_existing_displays()
    {
        using var db = new RevelMoviesDbContext(new DbContextOptionsBuilder<RevelMoviesDbContext>()
            .UseSqlServer("Server=localhost;Database=ScriptOnly;Integrated Security=true;TrustServerCertificate=true").Options);
        var script = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>()
            .GenerateScript("20261124134352_AddAutomaticUploadOptimization", "20261124160000_AddDisplayAudioEnabled");
        Assert.Contains("ALTER TABLE [displays] ADD [audio_enabled] bit NOT NULL DEFAULT CAST(1 AS bit)", script);
        Assert.False(db.Database.HasPendingModelChanges());
    }

    [Fact]
    public async Task Displays_default_to_contain_and_player_identity_exposes_the_setting()
    {
        await using var factory = new Factory();
        using var client = factory.CreateClient();
        var displayId = await Seed(factory);

        var displays = await client.GetFromJsonAsync<JsonElement>("/api/displays");
        var display = Assert.Single(displays.EnumerateArray());
        Assert.Equal(displayId, display.GetProperty("id").GetGuid());
        Assert.Equal("contain", display.GetProperty("imageFit").GetString());
        Assert.True(display.GetProperty("audioEnabled").GetBoolean());
        client.DefaultRequestHeaders.Add("X-Device-Token", DeviceToken);
        var identity = await client.GetFromJsonAsync<JsonElement>("/api/player/identity");
        Assert.Equal("contain", identity.GetProperty("imageFit").GetString());
        Assert.True(identity.GetProperty("audioEnabled").GetBoolean());
    }

    [Fact]
    public async Task Audio_setting_is_saved_dispatched_and_recovered_without_resetting_playback_or_other_settings()
    {
        await using var factory = new Factory();
        using var client = factory.CreateClient();
        var displayId = await Seed(factory);

        using var muted = await client.PutAsJsonAsync($"/api/displays/{displayId}/settings", new { audioEnabled = false });
        Assert.Equal(HttpStatusCode.OK, muted.StatusCode);
        var response = await muted.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(response.GetProperty("audioEnabled").GetBoolean());
        Assert.Equal(90, response.GetProperty("rotation").GetInt32());
        Assert.Equal("contain", response.GetProperty("imageFit").GetString());
        Assert.Equal("TV vertical", response.GetProperty("name").GetString());

        var notification = Assert.Single(factory.Services.GetRequiredService<RecordingHubLifetimeManager>().Sent);
        Assert.Equal(PlayerHub.GroupName(displayId), notification.Group);
        Assert.Equal("display.settings", notification.Command.Type);
        Assert.False(notification.Command.Payload!.Value.GetProperty("audioEnabled").GetBoolean());

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            Assert.False((await db.Displays.SingleAsync()).AudioEnabled);
            var playback = await db.DisplayPlaybackStates.SingleAsync();
            Assert.Equal("Playing", playback.DesiredState);
            Assert.Equal(7, playback.Revision);
            Assert.Equal("{\"mediaId\":\"unchanged\"}", playback.PayloadJson);
        }
        client.DefaultRequestHeaders.Add("X-Device-Token", DeviceToken);
        var identity = await client.GetFromJsonAsync<JsonElement>("/api/player/identity");
        Assert.False(identity.GetProperty("audioEnabled").GetBoolean());

        // Older clients and unrelated edits must preserve a deliberately muted device.
        using var updated = await client.PutAsJsonAsync($"/api/displays/{displayId}/settings", new { rotation = 270, imageFit = "cover", name = "Patio" });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.False((await updated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("audioEnabled").GetBoolean());
        using var omitted = await client.PutAsJsonAsync($"/api/displays/{displayId}/settings", new { audioEnabled = (bool?)null });
        Assert.Equal(HttpStatusCode.OK, omitted.StatusCode);
        Assert.False((await omitted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("audioEnabled").GetBoolean());

        using var enabled = await client.PutAsJsonAsync($"/api/displays/{displayId}/settings", new { audioEnabled = true });
        Assert.Equal(HttpStatusCode.OK, enabled.StatusCode);
        var restored = await enabled.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(restored.GetProperty("audioEnabled").GetBoolean());
        Assert.Equal(270, restored.GetProperty("rotation").GetInt32());
        Assert.Equal("cover", restored.GetProperty("imageFit").GetString());
        Assert.Equal("Patio", restored.GetProperty("name").GetString());
        var sent = factory.Services.GetRequiredService<RecordingHubLifetimeManager>().Sent;
        Assert.True(sent.Last().Command.Payload!.Value.GetProperty("audioEnabled").GetBoolean());
    }

    [Fact]
    public async Task Explicitly_muted_new_displays_do_not_get_overridden_by_the_database_default()
    {
        await using var factory = new Factory();
        await Seed(factory);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            var eventId = await db.Events.Select(item => item.Id).SingleAsync();
            db.Displays.Add(new Display { EventId = eventId, Name = "Muted", DeviceTokenHash = "muted-device", AudioEnabled = false });
            await db.SaveChangesAsync();
        }
        using var verificationScope = factory.Services.CreateScope();
        var persisted = await verificationScope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>()
            .Displays.SingleAsync(display => display.DeviceTokenHash == "muted-device");
        Assert.False(persisted.AudioEnabled);
    }

    [Fact]
    public async Task Fit_is_saved_dispatched_and_recovered_without_resetting_orientation_or_playback()
    {
        await using var factory = new Factory();
        using var client = factory.CreateClient();
        var displayId = await Seed(factory);
        using var changed = await client.PutAsJsonAsync($"/api/displays/{displayId}/settings", new { imageFit = "cover" });
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var response = await changed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("cover", response.GetProperty("imageFit").GetString());
        Assert.Equal(90, response.GetProperty("rotation").GetInt32());
        Assert.Equal("TV vertical", response.GetProperty("name").GetString());

        var notification = Assert.Single(factory.Services.GetRequiredService<RecordingHubLifetimeManager>().Sent);
        Assert.Equal(PlayerHub.GroupName(displayId), notification.Group);
        Assert.Equal("display.settings", notification.Command.Type);
        var payload = notification.Command.Payload!.Value;
        Assert.Equal("cover", payload.GetProperty("imageFit").GetString());
        Assert.Equal(90, payload.GetProperty("rotation").GetInt32());

        // A separate scope and identity request exercise persisted reconnect recovery.
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            Assert.Equal("cover", (await db.Displays.SingleAsync()).ImageFit);
            var playback = await db.DisplayPlaybackStates.SingleAsync();
            Assert.Equal("Playing", playback.DesiredState);
            Assert.Equal(7, playback.Revision);
            Assert.Equal("{\"mediaId\":\"unchanged\"}", playback.PayloadJson);
        }
        client.DefaultRequestHeaders.Add("X-Device-Token", DeviceToken);
        var identity = await client.GetFromJsonAsync<JsonElement>("/api/player/identity");
        Assert.Equal("cover", identity.GetProperty("imageFit").GetString());

        // Existing clients changing orientation or name must preserve the chosen fit.
        using var rotated = await client.PutAsJsonAsync($"/api/displays/{displayId}/settings", new { rotation = 270 });
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        Assert.Equal("cover", (await rotated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("imageFit").GetString());
        using var renamed = await client.PutAsJsonAsync($"/api/displays/{displayId}/settings", new { name = "Patio" });
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal("cover", (await renamed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("imageFit").GetString());

        using var reset = await client.PutAsJsonAsync($"/api/displays/{displayId}/settings", new { imageFit = "contain" });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        var restored = await reset.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("contain", restored.GetProperty("imageFit").GetString());
        Assert.Equal(270, restored.GetProperty("rotation").GetInt32());
        Assert.Equal("Patio", restored.GetProperty("name").GetString());
    }

    [Theory]
    [InlineData("fill")]
    [InlineData("COVER")]
    [InlineData("")]
    [InlineData("cover ")]
    public async Task Invalid_fit_is_rejected_without_saving_or_notifying(string imageFit)
    {
        await using var factory = new Factory();
        using var client = factory.CreateClient();
        var displayId = await Seed(factory);
        using var response = await client.PutAsJsonAsync($"/api/displays/{displayId}/settings", new { imageFit, rotation = 270 });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.Services.GetRequiredService<RecordingHubLifetimeManager>().Sent);
        using var scope = factory.Services.CreateScope();
        var display = await scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>().Displays.SingleAsync();
        Assert.Equal("contain", display.ImageFit);
        Assert.Equal(90, display.Rotation);
    }

    private static async Task<Guid> Seed(Factory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        await db.Database.EnsureCreatedAsync();
        var item = new RevelEvent { Name = "Ajuste de imagen", Slug = "image-fit" };
        var display = new Display
        {
            EventId = item.Id, Name = "TV vertical", Rotation = 90,
            DeviceTokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(DeviceToken))).ToLowerInvariant()
        };
        db.AddRange(item, display, new DisplayPlaybackState
        {
            DisplayId = display.Id, DesiredState = "Playing", Revision = 7,
            PayloadJson = "{\"mediaId\":\"unchanged\"}"
        });
        await db.SaveChangesAsync();
        return display.Id;
    }

    private sealed class Factory : AuthenticatedApiFactory
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:;Foreign Keys=True");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
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

        public override Task SendGroupAsync(string groupName, string methodName, object?[] args, CancellationToken cancellationToken = default)
        {
            Assert.Equal("command", methodName);
            Sent.Add((groupName, Assert.IsType<PlayerCommand>(Assert.Single(args))));
            return Task.CompletedTask;
        }
    }
}
