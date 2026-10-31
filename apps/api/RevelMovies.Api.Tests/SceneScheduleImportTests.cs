using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using RevelMovies.Api.Runtime;
using RevelMovies.Domain.DisplayGroups;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Events;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Playlists;
using RevelMovies.Infrastructure.Persistence;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class SceneScheduleImportTests
{
    [Fact]
    public async Task The_example_in_the_exported_context_is_accepted_by_the_real_preview_validator()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var context = await client.GetFromJsonAsync<JsonElement>($"/api/events/{seed.EventId}/schedule/import-context");
        var prompt = context.GetProperty("prompt").GetString()!;
        var exampleHeading = prompt.IndexOf("EJEMPLO DE FORMATO", StringComparison.Ordinal);
        Assert.True(exampleHeading >= 0);
        var exampleStart = prompt.IndexOf('{', exampleHeading);
        var example = JsonNode.Parse(prompt[exampleStart..])!.AsObject();
        Assert.Equal(seed.EventId.ToString(), example["eventId"]!.GetValue<string>());
        var preview = await Preview(client, seed.EventId, example);
        Assert.Equal(3, preview.GetProperty("schedule").GetArrayLength());
        await AssertUnchanged(factory);
    }

    [Fact]
    public async Task Context_and_preview_are_read_only_and_import_preserves_midnight_dates_without_activation()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var context = await client.GetFromJsonAsync<JsonElement>($"/api/events/{seed.EventId}/schedule/import-context");
        var prompt = context.GetProperty("prompt").GetString()!;
        Assert.Contains(seed.EventId.ToString(), prompt);
        Assert.Contains(seed.DisplayId.ToString(), prompt);
        Assert.Contains(seed.PlaylistId.ToString(), prompt);
        Assert.Contains(seed.GroupId.ToString(), prompt);

        var package = Package(seed);
        var preview = await Preview(client, seed.EventId, package);
        Assert.Equal(3, preview.GetProperty("scenes").GetArrayLength());
        Assert.Equal(3, preview.GetProperty("schedule").GetArrayLength());
        await AssertUnchanged(factory);

        using var response = await Import(client, seed.EventId, package, preview);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(result.GetProperty("alreadyImported").GetBoolean());
        Assert.Equal(3, result.GetProperty("sceneCount").GetInt32());
        Assert.Equal(3, result.GetProperty("scheduleCount").GetInt32());
        using var scope = factory.Services.CreateScope(); var db = Db(scope);
        Assert.Equal(3, await db.Scenes.CountAsync());
        var schedule = await db.SceneSchedules.OrderBy(x => x.StartsAt).ToArrayAsync();
        Assert.Equal(new[] { "2035-11-01T00:00:00+00:00", "2035-11-01T03:00:00+00:00", "2035-11-01T04:00:00+00:00" },
            schedule.Select(x => x.StartsAt.ToString("yyyy-MM-dd'T'HH:mm:sszzz")));
        Assert.All(schedule, entry => Assert.Equal("scheduled", entry.Status));
        Assert.Equal(new[] { "2035-10-31T21:00", "2035-11-01T00:00", "2035-11-01T01:00" }, schedule.Select(x => x.LocalStartsAt));
        Assert.Empty(await db.SceneSessions.ToArrayAsync());
        var state = await db.DisplayPlaybackStates.SingleAsync();
        Assert.Null(state.AnnouncementJson); Assert.Equal(0, state.Revision);
    }

    [Fact]
    public async Task Reimport_is_idempotent_even_after_the_scheduled_dates_have_passed()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var package = Package(seed); var preview = await Preview(client, seed.EventId, package);
        using var first = await Import(client, seed.EventId, package, preview); first.EnsureSuccessStatusCode();
        factory.Clock.Now = DateTimeOffset.Parse("2035-11-02T12:00:00Z");
        var repeatedPreview = await Preview(client, seed.EventId, package);
        Assert.True(repeatedPreview.GetProperty("alreadyImported").GetBoolean());
        using var repeated = await Import(client, seed.EventId, package, repeatedPreview);
        Assert.Equal(HttpStatusCode.OK, repeated.StatusCode);
        Assert.True((await repeated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("alreadyImported").GetBoolean());
        using var scope = factory.Services.CreateScope();
        Assert.Equal(3, await Db(scope).Scenes.CountAsync()); Assert.Equal(3, await Db(scope).SceneSchedules.CountAsync());
    }

    [Fact]
    public async Task Preview_orders_changes_by_time_even_when_the_package_is_unordered()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var package = Package(seed);
        package["schedule"] = new JsonArray(package["schedule"]!.AsArray().Reverse().Select(entry => entry!.DeepClone()).ToArray());
        var preview = await Preview(client, seed.EventId, package);
        Assert.Equal(new[] { "previa", "anuncios", "fiesta" }, preview.GetProperty("schedule").EnumerateArray().Select(entry => entry.GetProperty("sceneKey").GetString()));
        await AssertUnchanged(factory);
    }

    [Fact]
    public async Task Simultaneous_changes_are_allowed_when_their_destinations_are_different()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var package = Package(seed);
        package["scenes"]![1]!["assignments"]![0]!["displayIds"] = new JsonArray(seed.SecondDisplayId.ToString());
        package["schedule"]![1]!["localStartsAt"] = "2035-10-31T21:00";
        using var response = await Import(client, seed.EventId, package, await Preview(client, seed.EventId, package));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var scope = factory.Services.CreateScope();
        Assert.Equal(2, await Db(scope).SceneSchedules.CountAsync(x => x.StartsAt == DateTimeOffset.Parse("2035-11-01T00:00:00Z")));
    }

    [Fact]
    public async Task Oversized_documents_are_rejected_without_writing_anything()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var package = Package(seed); package["scenes"]![0]!["name"] = new string('a', 1024 * 1024);
        using var response = await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule/preview-import", package);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("1 MiB", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        await AssertUnchanged(factory);
    }

    [Theory]
    [InlineData("foreign-event")]
    [InlineData("missing-display")]
    [InlineData("foreign-display")]
    [InlineData("missing-group")]
    [InlineData("missing-media")]
    [InlineData("unknown-scene")]
    [InlineData("duplicate-key")]
    [InlineData("duplicate-time")]
    [InlineData("invalid-zone")]
    [InlineData("past-time")]
    [InlineData("unknown-root-field")]
    [InlineData("unknown-layer-field")]
    [InlineData("null-scenes")]
    [InlineData("null-scene")]
    [InlineData("null-assignment")]
    [InlineData("null-layer")]
    [InlineData("null-schedule-entry")]
    public async Task Invalid_packages_are_rejected_without_creating_any_part_of_the_batch(string scenario)
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var package = Package(seed); var scene = package["scenes"]![0]!; var assignment = scene["assignments"]![0]!;
        switch (scenario)
        {
            case "foreign-event": package["eventId"] = Guid.NewGuid().ToString(); break;
            case "missing-display": assignment["displayIds"] = new JsonArray(Guid.NewGuid().ToString()); break;
            case "foreign-display": assignment["displayIds"] = new JsonArray(seed.ForeignDisplayId.ToString()); break;
            case "missing-group": assignment["groupIds"] = new JsonArray(Guid.NewGuid().ToString()); break;
            case "missing-media": assignment["media"] = JsonSerializer.SerializeToNode(new { action = "replace", type = "media", mediaId = Guid.NewGuid() }); break;
            case "unknown-scene": package["schedule"]![2]!["sceneKey"] = "no-existe"; break;
            case "duplicate-key": package["scenes"]![1]!["key"] = "previa"; break;
            case "duplicate-time": package["schedule"]![1]!["localStartsAt"] = "2035-10-31T21:00"; break;
            case "invalid-zone": package["timeZone"] = "Invalid/Zone"; break;
            case "past-time": package["schedule"]![2]!["localStartsAt"] = "2030-01-01T01:00"; break;
            case "unknown-root-field": package["extra"] = true; break;
            case "unknown-layer-field": assignment["media"]!["unknown"] = true; break;
            case "null-scenes": package["scenes"] = null; break;
            case "null-scene": package["scenes"]![1] = null; break;
            case "null-assignment": scene["assignments"]![0] = null; break;
            case "null-layer": assignment["media"] = null; break;
            case "null-schedule-entry": package["schedule"]![1] = null; break;
        }
        using var response = await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule/preview-import", package);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace((await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()));
        await AssertUnchanged(factory);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{")]
    [InlineData("[]")]
    [InlineData("{\"schemaVersion\":1,\"schemaVersion\":1}")]
    public async Task Malformed_documents_return_client_errors_instead_of_server_errors(string json)
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        using var response = await client.PostAsync($"/api/events/{seed.EventId}/schedule/preview-import", new StringContent(json, Encoding.UTF8, "application/json"));
        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Conflict });
        await AssertUnchanged(factory);
    }

    [Theory]
    [InlineData("playlist")]
    [InlineData("group")]
    [InlineData("package")]
    [InlineData("token")]
    public async Task Changed_resources_or_package_require_a_new_preview(string change)
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var package = Package(seed, useResources: true); var preview = await Preview(client, seed.EventId, package);
        using (var scope = factory.Services.CreateScope())
        {
            var db = Db(scope);
            if (change == "playlist") (await db.PlaylistItems.SingleAsync()).DurationSeconds = 42;
            if (change == "group") db.DisplayGroupMembers.Add(new() { DisplayGroupId = seed.GroupId, DisplayId = seed.SecondDisplayId });
            await db.SaveChangesAsync();
        }
        if (change == "package") package["scenes"]![0]!["name"] = "Previa modificada";
        using var response = await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule/import", new
        { package, previewToken = change == "token" ? "invalid-token" : preview.GetProperty("previewToken").GetString() });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        await AssertUnchanged(factory);
        var refreshed = await Preview(client, seed.EventId, package);
        using var accepted = await Import(client, seed.EventId, package, refreshed);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
    }

    [Fact]
    public async Task A_conflicting_entry_added_after_preview_rejects_the_whole_import()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var package = Package(seed); var preview = await Preview(client, seed.EventId, package);
        var other = Package(seed); other["scenes"]![0]!["name"] = "Otra previa";
        using var competing = await Import(client, seed.EventId, other, await Preview(client, seed.EventId, other));
        competing.EnsureSuccessStatusCode();
        using var rejected = await Import(client, seed.EventId, package, preview);
        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        using var scope = factory.Services.CreateScope();
        Assert.Equal(3, await Db(scope).Scenes.CountAsync()); Assert.Equal(3, await Db(scope).SceneSchedules.CountAsync());
        Assert.DoesNotContain(await Db(scope).Scenes.Select(x => x.Name).ToArrayAsync(), name => name == "Previa");
    }

    [Fact]
    public async Task A_database_failure_rolls_back_scenes_schedules_and_the_import_receipt()
    {
        await using var factory = new Factory(); using var client = factory.CreateClient(); var seed = await Seed(factory);
        var package = Package(seed); var preview = await Preview(client, seed.EventId, package);
        factory.Failure.Enabled = true;
        using var failed = await Import(client, seed.EventId, package, preview);
        Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        factory.Failure.Enabled = false;
        await AssertUnchanged(factory);
        var retryPreview = await Preview(client, seed.EventId, package);
        Assert.False(retryPreview.GetProperty("alreadyImported").GetBoolean());
        using var retry = await Import(client, seed.EventId, package, retryPreview);
        retry.EnsureSuccessStatusCode();
        Assert.False((await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("alreadyImported").GetBoolean());
    }

    private static JsonObject Package(SeedData seed, bool useResources = false)
    {
        var names = new[] { ("previa", "Previa", "2035-10-31T21:00"), ("anuncios", "Anuncios", "2035-11-01T00:00"), ("fiesta", "Fiesta", "2035-11-01T01:00") };
        return JsonSerializer.SerializeToNode(new
        {
            schemaVersion = 1, eventId = seed.EventId, timeZone = "America/Argentina/Buenos_Aires",
            scenes = names.Select(item => new
            {
                key = item.Item1, name = item.Item2,
                assignments = new[] { new
                {
                    displayIds = useResources ? Array.Empty<Guid>() : new[] { seed.DisplayId },
                    groupIds = useResources ? new[] { seed.GroupId } : Array.Empty<Guid>(),
                    media = useResources ? JsonSerializer.SerializeToElement(new { action = "replace", type = "playlist", playlistId = seed.PlaylistId }) : JsonSerializer.SerializeToElement(new { action = "keep" }),
                    webPage = new { action = "remove" },
                    announcement = new { action = "replace", payload = new { kind = "message", text = item.Item2, layout = "banner", theme = "dark" } },
                    blackout = "off", promotions = "keep"
                } }
            }),
            schedule = names.Select(item => new { sceneKey = item.Item1, localStartsAt = item.Item3, policy = "available" })
        })!.AsObject();
    }

    private static async Task<JsonElement> Preview(HttpClient client, Guid eventId, JsonObject package)
    {
        using var response = await client.PostAsJsonAsync($"/api/events/{eventId}/schedule/preview-import", package);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
    private static Task<HttpResponseMessage> Import(HttpClient client, Guid eventId, JsonObject package, JsonElement preview) =>
        client.PostAsJsonAsync($"/api/events/{eventId}/schedule/import", new { package, previewToken = preview.GetProperty("previewToken").GetString() });
    private static RevelMoviesDbContext Db(IServiceScope scope) => scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
    private static async Task AssertUnchanged(Factory factory)
    {
        using var scope = factory.Services.CreateScope(); var db = Db(scope);
        Assert.Empty(await db.Scenes.ToArrayAsync()); Assert.Empty(await db.SceneSchedules.ToArrayAsync()); Assert.Empty(await db.SceneSessions.ToArrayAsync());
        var state = await db.DisplayPlaybackStates.SingleAsync(); Assert.Null(state.AnnouncementJson); Assert.Equal(0, state.Revision);
    }
    private sealed record SeedData(Guid EventId, Guid DisplayId, Guid SecondDisplayId, Guid ForeignDisplayId, Guid GroupId, Guid PlaylistId);
    private static async Task<SeedData> Seed(Factory factory)
    {
        using var scope = factory.Services.CreateScope(); var db = Db(scope); await db.Database.EnsureCreatedAsync();
        var evt = new Event { Name = "Noche importada", Slug = Guid.NewGuid().ToString(), TimeZone = "America/Argentina/Buenos_Aires" };
        var other = new Event { Name = "Otro evento", Slug = Guid.NewGuid().ToString() };
        var display = new Display { EventId = evt.Id, Name = "Patio", Status = DisplayStatus.Online, DeviceTokenHash = Guid.NewGuid().ToString() };
        var second = new Display { EventId = evt.Id, Name = "Barra", DeviceTokenHash = Guid.NewGuid().ToString() };
        var foreign = new Display { EventId = other.Id, Name = "Ajena", DeviceTokenHash = Guid.NewGuid().ToString() };
        var group = new DisplayGroup { EventId = evt.Id, Name = "Pantallas de la fiesta" };
        var media = new MediaAsset { EventId = evt.Id, Name = "Bienvenida.png", Type = MediaType.Image, FileSize = 128, Checksum = "test-image" };
        var playlist = new Playlist { EventId = evt.Id, Name = "Visuales de la previa", IsLoop = true };
        db.Events.AddRange(evt, other); db.Displays.AddRange(display, second, foreign); db.DisplayGroups.Add(group);
        db.DisplayGroupMembers.Add(new() { DisplayGroupId = group.Id, DisplayId = display.Id });
        db.DisplayPlaybackStates.Add(new() { DisplayId = display.Id }); db.MediaAssets.Add(media); db.Playlists.Add(playlist);
        db.PlaylistItems.Add(new() { PlaylistId = playlist.Id, MediaAssetId = media.Id, Position = 0, DurationSeconds = 10 });
        await db.SaveChangesAsync();
        return new(evt.Id, display.Id, second.Id, foreign.Id, group.Id, playlist.Id);
    }

    private sealed class TestClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.Parse("2035-10-31T18:00:00Z");
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class ScheduleInsertFailure : DbCommandInterceptor
    {
        public bool Enabled { get; set; }
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (Enabled && command.CommandText.Contains("INSERT INTO \"scene_schedules\"", StringComparison.Ordinal))
                throw new InvalidOperationException("Injected schedule write failure");
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
    private sealed class Factory : AuthenticatedApiFactory
    {
        private readonly SqliteConnection keeper = new($"Data Source=ScheduleImport-{Guid.NewGuid()};Mode=Memory;Cache=Shared");
        public TestClock Clock { get; } = new();
        public ScheduleInsertFailure Failure { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder); keeper.Open();
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            { ["Database:ApplyMigrationsOnStartup"] = "false", ["Logging:LogLevel:Default"] = "Critical" }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>(); services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseSqlite(keeper.ConnectionString)
                    .ReplaceService<IModelCustomizer, SqliteDates>().AddInterceptors(Failure));
                services.RemoveAll<TimeProvider>(); services.AddSingleton<TimeProvider>(Clock);
                // Preview/import must never depend on a background worker mutating the test state.
                foreach (var worker in services.Where(x => x.ServiceType == typeof(IHostedService) &&
                    x.ImplementationType?.Assembly == typeof(SceneScheduleService).Assembly).ToArray()) services.Remove(worker);
            });
        }
        public override async ValueTask DisposeAsync() { await base.DisposeAsync(); await keeper.DisposeAsync(); }
    }
    private sealed class SqliteDates(ModelCustomizerDependencies dependencies) : ModelCustomizer(dependencies)
    {
        public override void Customize(ModelBuilder builder, DbContext context)
        {
            base.Customize(builder, context);
            foreach (var property in builder.Model.GetEntityTypes().SelectMany(entity => entity.GetProperties()))
                if (property.ClrType == typeof(DateTimeOffset) || property.ClrType == typeof(DateTimeOffset?))
                    property.SetValueConverter(new DateTimeOffsetToBinaryConverter());
        }
    }
}
