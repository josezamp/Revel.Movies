using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RevelMovies.Api.Hubs;
using RevelMovies.Api.Runtime;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Playback;
using RevelMovies.Domain.Scenes;
using RevelMovies.Application.Media;
using RevelMovies.Infrastructure.Media;
using RevelMovies.Infrastructure.Persistence;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed partial class MediaUploadTests
{
    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=");

    [Fact]
    public async Task Duplicate_names_require_a_decision_and_are_scoped_to_the_event()
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        using var first = await Upload(client, eventId, "Logo.png");
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var original = await first.Content.ReadFromJsonAsync<JsonElement>();
        using var duplicate = await Upload(client, eventId, "logo.PNG");
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        var conflict = await duplicate.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(original.GetProperty("id").GetGuid(), conflict.GetProperty("existing").GetProperty("id").GetGuid());
        Assert.Single((await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/media")).EnumerateArray());
        var otherEvent = await CreateEvent(factory, client);
        using var other = await Upload(client, otherEvent, "Logo.png");
        Assert.Equal(HttpStatusCode.Created, other.StatusCode);
        Assert.Equal(2, Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories).Length);
    }

    [Fact]
    public async Task Replacement_keeps_identity_and_playlist_references_and_changes_content_and_cache_version()
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        using var first = await Upload(client, eventId, "Logo.png");
        var original = await first.Content.ReadFromJsonAsync<JsonElement>();
        var mediaId = original.GetProperty("id").GetGuid();
        using var playlistResponse = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new
        { name = "Sponsors", items = new[] { new { mediaAssetId = mediaId, durationSeconds = 12 } } });
        var playlist = await playlistResponse.Content.ReadFromJsonAsync<JsonElement>();
        using var oldContent = await client.GetAsync($"/api/media/{mediaId}/content");
        var updatedBytes = Png.Concat(new byte[] { 1, 2, 3 }).ToArray();
        using var replacement = await Upload(client, eventId, "Logo.png", updatedBytes, mediaId);
        Assert.Equal(HttpStatusCode.Created, replacement.StatusCode);
        var updated = await replacement.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(mediaId, updated.GetProperty("id").GetGuid());
        Assert.NotEqual(original.GetProperty("checksum").GetString(), updated.GetProperty("checksum").GetString());
        Assert.NotEqual(original.GetProperty("contentUrl").GetString(), updated.GetProperty("contentUrl").GetString());
        using var content = await client.GetAsync(updated.GetProperty("contentUrl").GetString());
        Assert.Equal(updatedBytes, await content.Content.ReadAsByteArrayAsync());
        Assert.NotEqual(oldContent.Headers.ETag, content.Headers.ETag);
        Assert.True(content.Headers.CacheControl!.NoCache);
        using var head = await client.SendAsync(new HttpRequestMessage(HttpMethod.Head, $"/api/media/{mediaId}/content"));
        Assert.Equal(HttpStatusCode.OK, head.StatusCode);
        Assert.Equal(content.Headers.ETag, head.Headers.ETag);
        Assert.Empty(await head.Content.ReadAsByteArrayAsync());
        var playlists = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/playlists");
        var saved = Assert.Single(playlists.EnumerateArray());
        Assert.Equal(playlist.GetProperty("items")[0].GetProperty("id").GetGuid(), saved.GetProperty("items")[0].GetProperty("id").GetGuid());
        Assert.Equal(mediaId, saved.GetProperty("items")[0].GetProperty("mediaAssetId").GetGuid());
        Assert.Equal(12, saved.GetProperty("items")[0].GetProperty("durationSeconds").GetDouble());
        Assert.NotEqual(playlist.GetProperty("updatedAt").GetString(), saved.GetProperty("updatedAt").GetString());
        Assert.Single(Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Invalid_or_foreign_replacement_preserves_the_original_bytes()
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        using var first = await Upload(client, eventId, "Logo.png");
        var mediaId = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var invalid = await Upload(client, eventId, "Logo.png", [1, 2, 3], mediaId);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var renamed = await Upload(client, eventId, "Different.png", replace: mediaId);
        Assert.Equal(HttpStatusCode.BadRequest, renamed.StatusCode);
        var otherEvent = await CreateEvent(factory, client);
        using var foreign = await Upload(client, otherEvent, "Logo.png", replace: mediaId);
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
        Assert.Equal(Png, await client.GetByteArrayAsync($"/api/media/{mediaId}/content"));
        Assert.Single(Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Simultaneous_duplicate_uploads_create_only_one_file()
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        var results = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Upload(client, eventId, "Logo.png")));
        try
        {
            Assert.Single(results.Where(x => x.StatusCode == HttpStatusCode.Created));
            Assert.Equal(2, results.Count(x => x.StatusCode == HttpStatusCode.Conflict));
            Assert.Single(Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories));
        }
        finally { foreach (var result in results) result.Dispose(); }
    }

    [Fact]
    public async Task Failed_file_copy_removes_partial_storage()
    {
        var root = Path.Combine(Path.GetTempPath(), "revel-upload-test-" + Guid.NewGuid());
        try
        {
            var storage = new LocalMediaStorage(root);
            await Assert.ThrowsAsync<IOException>(() => storage.SaveAsync(Guid.NewGuid(), Guid.NewGuid(), ".png", new FailingStream()));
            Assert.Empty(Directory.GetFiles(root, "*", SearchOption.AllDirectories));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Cleanup_deletes_physical_files_and_orphans_only_for_selected_event_and_clears_recovery()
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        var otherId = await CreateEvent(factory, client);
        using var uploaded = await Upload(client, eventId, "logo.png");
        var mediaId = (await uploaded.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var other = await Upload(client, otherId, "otro.png");
        var otherMediaId = (await other.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var orphan = Path.Combine(factory.MediaRoot, eventId.ToString("N"), "orphan.mp4");
        await File.WriteAllBytesAsync(orphan, new byte[15]);
        var nested = Path.Combine(factory.MediaRoot, eventId.ToString("N"), "empty"); Directory.CreateDirectory(nested);
        using var playlist = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new { name = "Lista", isLoop = true });
        var playlistId = (await playlist.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        (await client.PostAsJsonAsync($"/api/playlists/{playlistId}/items", new { items = new[] { new { mediaAssetId = mediaId, durationSeconds = 5 } } })).EnsureSuccessStatusCode();
        Guid displayId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            var display = new Display { EventId = eventId, Name = "Pantalla", DeviceTokenHash = Guid.NewGuid().ToString() };
            displayId = display.Id; db.Displays.Add(display);
            db.DisplayPlaybackStates.Add(new DisplayPlaybackState { DisplayId = displayId, DesiredState = "Playing", ContentType = "Media",
                MediaAssetId = mediaId, PayloadJson = "{}", PromotionPolicyJson = "{}", Revision = 4 });
            var scene = new Scene { EventId = eventId, Name = "Escena" }; db.Scenes.Add(scene);
            db.SceneSchedules.Add(new SceneSchedule { EventId = eventId, SceneId = scene.Id, SceneName = scene.Name,
                StartsAt = DateTimeOffset.UtcNow.AddHours(1), TargetsJson = JsonSerializer.Serialize(new[] { new ScheduleTarget { DisplayId = displayId, DisplayName = display.Name } }, SceneRegistry.Json) });
            db.SceneSchedules.Add(new SceneSchedule { EventId = otherId, StartsAt = DateTimeOffset.UtcNow.AddHours(1) });
            db.SceneSessions.Add(new SceneSession { EventId = eventId, SceneId = scene.Id, Kind = "activate" });
            await db.SaveChangesAsync();
        }
        var preview = await client.GetFromJsonAsync<MediaCleanupPreview>($"/api/events/{eventId}/media-cleanup");
        Assert.Equal(1, preview!.MediaCount); Assert.Equal(2, preview.FileCount); Assert.Equal(1, preview.OrphanFileCount);
        Assert.Equal(Png.Length + 15, preview.TotalBytes);
        using var cleaned = await client.PostAsJsonAsync($"/api/events/{eventId}/media-cleanup", new { confirmation = "ELIMINAR", preview.SnapshotToken });
        cleaned.EnsureSuccessStatusCode();
        var result = await cleaned.Content.ReadFromJsonAsync<MediaCleanupResult>();
        Assert.Equal(2, result!.DeletedFileCount); Assert.Equal(0, result.FailedFileCount); Assert.Empty(result.Warnings);
        Assert.False(Directory.Exists(Path.Combine(factory.MediaRoot, eventId.ToString("N"))));
        Assert.Equal(Png, await client.GetByteArrayAsync($"/api/media/{otherMediaId}/content"));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/media/{mediaId}")).StatusCode);
        using var verify = factory.Services.CreateScope(); var database = verify.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        Assert.Empty(await database.PlaylistItems.ToListAsync()); Assert.Single(await database.Playlists.ToListAsync());
        Assert.Empty(await database.SceneSessions.ToListAsync()); Assert.Single(await database.Scenes.ToListAsync());
        var cancelledSchedule = await database.SceneSchedules.SingleAsync(x => x.EventId == eventId);
        Assert.Equal("cancelled", cancelledSchedule.Status);
        Assert.Equal("cancelled", JsonSerializer.Deserialize<ScheduleTarget[]>(cancelledSchedule.TargetsJson, SceneRegistry.Json)!.Single().Status);
        Assert.Equal("scheduled", (await database.SceneSchedules.SingleAsync(x => x.EventId == otherId)).Status);
        Assert.Equal(2, await database.Events.CountAsync()); Assert.True(await database.Displays.AnyAsync(x => x.Id == displayId));
        var state = await database.DisplayPlaybackStates.SingleAsync();
        Assert.Equal("Stopped", state.DesiredState); Assert.Null(state.PayloadJson); Assert.Null(state.MediaAssetId);
        Assert.Null(state.PromotionPolicyJson); Assert.Equal(5, state.Revision);
        var empty = await client.GetFromJsonAsync<MediaCleanupPreview>($"/api/events/{eventId}/media-cleanup");
        (await client.PostAsJsonAsync($"/api/events/{eventId}/media-cleanup", new { confirmation = "ELIMINAR", empty!.SnapshotToken })).EnsureSuccessStatusCode();
        // The storage root stays usable after removing the event directory.
        (await Upload(client, eventId, "nuevo.png")).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Cleanup_requires_confirmation_and_a_current_event_specific_preview()
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        var preview = await client.GetFromJsonAsync<MediaCleanupPreview>($"/api/events/{eventId}/media-cleanup");
        (await Upload(client, eventId, "logo.png")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/events/{eventId}/media-cleanup", new { confirmation = "", preview!.SnapshotToken })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/events/{eventId}/media-cleanup", new { confirmation = "ELIMINAR", preview!.SnapshotToken })).StatusCode);
        var otherId = await CreateEvent(factory, client);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/events/{otherId}/media-cleanup", new { confirmation = "ELIMINAR", preview!.SnapshotToken })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/events/{Guid.NewGuid()}/media-cleanup")).StatusCode);
        Assert.Single(Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Cleanup_conflicts_with_inflight_operations_and_blocks_new_uploads()
    {
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        (await Upload(client, eventId, "logo.png")).EnsureSuccessStatusCode();
        var preview = await client.GetFromJsonAsync<MediaCleanupPreview>($"/api/events/{eventId}/media-cleanup");
        var gate = factory.Services.GetRequiredService<MediaMaintenanceGate>();
        using (var operation = gate.TryEnter())
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/events/{eventId}/media-cleanup", new { confirmation = "ELIMINAR", preview!.SnapshotToken })).StatusCode);
        using (var cleaning = gate.TryEnter(cleanup: true))
        {
            Assert.NotNull(cleaning);
            Assert.Equal(HttpStatusCode.Conflict, (await Upload(client, eventId, "nuevo.png")).StatusCode);
        }
        Assert.Single(Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Locked_files_are_reported_and_retained_for_retry()
    {
        if (!OperatingSystem.IsWindows()) return; // Windows enforces FileShare.None against deletion.
        await using var factory = new MediaApiFactory(); using var client = factory.CreateClient();
        var eventId = await CreateEvent(factory, client);
        (await Upload(client, eventId, "locked.png")).EnsureSuccessStatusCode();
        (await Upload(client, eventId, "free.png")).EnsureSuccessStatusCode();
        var path = Directory.GetFiles(Path.Combine(factory.MediaRoot, eventId.ToString("N")))[0];
        using (var locked = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            var preview = await client.GetFromJsonAsync<MediaCleanupPreview>($"/api/events/{eventId}/media-cleanup");
            var response = await client.PostAsJsonAsync($"/api/events/{eventId}/media-cleanup", new { confirmation = "ELIMINAR", preview!.SnapshotToken });
            response.EnsureSuccessStatusCode();
            var result = await response.Content.ReadFromJsonAsync<MediaCleanupResult>();
            Assert.Equal(1, result!.FailedFileCount); Assert.Equal(1, result.DeletedMediaCount); Assert.NotEmpty(result.Warnings);
        }
        var remaining = await client.GetFromJsonAsync<MediaCleanupPreview>($"/api/events/{eventId}/media-cleanup");
        Assert.Equal(1, remaining!.MediaCount);
        (await client.PostAsJsonAsync($"/api/events/{eventId}/media-cleanup", new { confirmation = "ELIMINAR", remaining.SnapshotToken })).EnsureSuccessStatusCode();
        Assert.Empty(Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public void Cleanup_directory_rejects_traversal()
    {
        var root = Path.Combine(Path.GetTempPath(), "revel-safe-cleanup-" + Guid.NewGuid());
        Directory.CreateDirectory(root);
        try
        {
            var directory = new MediaDirectory(root);
            Assert.Throws<IOException>(() => directory.ListFiles("../outside"));
            Assert.Throws<IOException>(() => directory.DeleteFile("../outside.txt"));
            Assert.Throws<IOException>(() => directory.RemoveEmptyDirectories(".."));
        }
        finally { Directory.Delete(root); }
    }

    private sealed class FailingStream : MemoryStream
    {
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => throw new IOException("Read failed");
    }

    private static async Task<Guid> CreateEvent(MediaApiFactory factory, HttpClient client)
    {
        using var scope = factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>().Database.EnsureCreatedAsync();
        using var response = await client.PostAsJsonAsync("/api/events", new { name = "Upload " + Guid.NewGuid(), timeZone = "UTC" });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static async Task<HttpResponseMessage> Upload(HttpClient client, Guid eventId, string name, byte[]? bytes = null, Guid? replace = null)
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes ?? Png);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(file, "file", name);
        if (replace.HasValue) form.Add(new StringContent(replace.Value.ToString()), "replaceMediaId");
        return await client.PostAsync($"/api/events/{eventId}/media", form);
    }

    private sealed class MediaApiFactory : AuthenticatedApiFactory
    {
        private readonly SqliteConnection connection = new($"Data Source=Uploads-{Guid.NewGuid()};Mode=Memory;Cache=Shared");
        public string MediaRoot { get; } = Path.Combine(Path.GetTempPath(), "revel-upload-test-" + Guid.NewGuid());
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            connection.Open();
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            { ["Database:ApplyMigrationsOnStartup"] = "false", ["MediaStorage:RootPath"] = MediaRoot, ["Logging:LogLevel:Default"] = "Warning" }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseSqlite(connection.ConnectionString).ReplaceService<IModelCustomizer, SqliteDates>());
                services.RemoveAll<IMediaStorage>();
                services.AddSingleton<IMediaStorage>(new LocalMediaStorage(MediaRoot));
            });
        }
        public override async ValueTask DisposeAsync()
        {
            await base.DisposeAsync(); await connection.DisposeAsync();
            if (Directory.Exists(MediaRoot)) Directory.Delete(MediaRoot, true);
        }
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
