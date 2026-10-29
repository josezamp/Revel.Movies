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
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using RevelMovies.Api.Hubs;
using RevelMovies.Api.Runtime;
using RevelMovies.Application.Media;
using RevelMovies.Domain.Media;
using RevelMovies.Infrastructure.Media;
using RevelMovies.Infrastructure.Persistence;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class MediaOptimizationTests
{
    [Fact]
    public async Task Creates_independent_smaller_copy_preserves_original_and_playlist_and_deduplicates_requests()
    {
        await using var factory = new OptimizationFactory(); using var client = factory.CreateClient();
        var original = await factory.SeedAsync(client);
        var id = original.GetProperty("id").GetGuid(); var eventId = original.GetProperty("eventId").GetGuid();
        using var playlist = await client.PostAsJsonAsync($"/api/events/{eventId}/playlists", new
            { name = "Originals", items = new[] { new { mediaAssetId = id } } });
        playlist.EnsureSuccessStatusCode();
        var responses = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => client.PostAsync($"/api/media/{id}/tv-optimization", null)));
        foreach (var response in responses) { Assert.Equal(HttpStatusCode.Accepted, response.StatusCode); response.Dispose(); }
        Assert.True(await factory.Worker().ProcessNextAsync(default));
        Assert.False(await factory.Worker().ProcessNextAsync(default));
        var job = await factory.JobAsync(id);
        Assert.Equal("Completed", job.Status); Assert.Equal(100, job.Progress);
        Assert.NotEqual(id, job.ResultMediaId);
        Assert.Equal(OptimizationFactory.Source, await client.GetByteArrayAsync(original.GetProperty("contentUrl").GetString()));
        var result = await client.GetFromJsonAsync<JsonElement>($"/api/media/{job.ResultMediaId}");
        Assert.Equal(4, result.GetProperty("fileSize").GetInt64());
        Assert.Equal(640, result.GetProperty("width").GetInt32());
        Assert.EndsWith(" · TV", result.GetProperty("name").GetString());
        var playlists = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/playlists");
        Assert.Equal(id, playlists[0].GetProperty("items")[0].GetProperty("mediaAssetId").GetGuid());
        using var repeated = await client.PostAsync($"/api/media/{id}/tv-optimization", null);
        Assert.Equal(HttpStatusCode.OK, repeated.StatusCode); Assert.Equal(1, factory.Optimizer.Calls);
        Assert.Equal(2, Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories).Length);
        Assert.Empty(Directory.GetFiles(factory.WorkRoot, "*", SearchOption.AllDirectories));

        using var deleted = await client.DeleteAsync($"/api/media/{job.ResultMediaId}"); deleted.EnsureSuccessStatusCode();
        var listing = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/media-optimizations");
        Assert.Equal("Deleted", listing.GetProperty("jobs")[0].GetProperty("status").GetString());
        using var retry = await client.PostAsync($"/api/media/{id}/tv-optimization", null);
        Assert.Equal(HttpStatusCode.Accepted, retry.StatusCode);
    }

    [Fact]
    public async Task Larger_output_is_discarded_and_reported_without_losing_original()
    {
        await using var factory = new OptimizationFactory(); using var client = factory.CreateClient();
        factory.Optimizer.OutputSize = 2048;
        var original = await factory.SeedAsync(client); var id = original.GetProperty("id").GetGuid();
        (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).EnsureSuccessStatusCode();
        await factory.Worker().ProcessNextAsync(default);
        Assert.Equal("NoSaving", (await factory.JobAsync(id)).Status);
        Assert.Single(Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories));
        Assert.Empty(Directory.GetFiles(factory.WorkRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Replacing_generated_copy_invalidates_the_old_optimization_result()
    {
        await using var factory = new OptimizationFactory(); using var client = factory.CreateClient();
        var original = await factory.SeedAsync(client); var id = original.GetProperty("id").GetGuid();
        var eventId = original.GetProperty("eventId").GetGuid();
        (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).EnsureSuccessStatusCode();
        await factory.Worker().ProcessNextAsync(default);
        var job = await factory.JobAsync(id);
        var result = await client.GetFromJsonAsync<JsonElement>($"/api/media/{job.ResultMediaId}");
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(OptimizationFactory.Source);
        file.Headers.ContentType = new MediaTypeHeaderValue("video/mp4");
        form.Add(file, "file", result.GetProperty("fileName").GetString()!);
        form.Add(new StringContent(job.ResultMediaId.ToString()!), "replaceMediaId");
        (await client.PostAsync($"/api/events/{eventId}/media", form)).EnsureSuccessStatusCode();
        var listing = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/media-optimizations");
        Assert.Equal(0, listing.GetProperty("jobs").GetArrayLength());
        Assert.Equal(OptimizationFactory.Source, await client.GetByteArrayAsync(original.GetProperty("contentUrl").GetString()));
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).StatusCode);
    }

    [Fact]
    public async Task Failure_cleans_partial_output_and_can_be_retried()
    {
        await using var factory = new OptimizationFactory(); using var client = factory.CreateClient();
        factory.Optimizer.AfterWrite = () => throw new InvalidOperationException("Encoder failed");
        var original = await factory.SeedAsync(client); var id = original.GetProperty("id").GetGuid();
        (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).EnsureSuccessStatusCode();
        await factory.Worker().ProcessNextAsync(default);
        Assert.Equal("Failed", (await factory.JobAsync(id)).Status);
        Assert.Single(Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories));
        Assert.Empty(Directory.GetFiles(factory.WorkRoot, "*", SearchOption.AllDirectories));
        factory.Optimizer.AfterWrite = null;
        (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).EnsureSuccessStatusCode();
        await factory.Worker().ProcessNextAsync(default);
        Assert.Equal("Completed", (await factory.JobAsync(id)).Status);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Replaced_or_deleted_original_cannot_publish_stale_output(bool delete)
    {
        await using var factory = new OptimizationFactory(); using var client = factory.CreateClient();
        var original = await factory.SeedAsync(client); var id = original.GetProperty("id").GetGuid();
        var eventId = original.GetProperty("eventId").GetGuid();
        factory.Optimizer.AfterWrite = async () =>
        {
            if (delete) (await client.DeleteAsync($"/api/media/{id}")).EnsureSuccessStatusCode();
            else (await OptimizationFactory.UploadAsync(client, eventId, id)).EnsureSuccessStatusCode();
        };
        (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).EnsureSuccessStatusCode();
        await factory.Worker().ProcessNextAsync(default);
        var library = await client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/media");
        Assert.Equal(delete ? 0 : 1, library.GetArrayLength());
        if (!delete) Assert.Equal("Failed", (await factory.JobAsync(id)).Status);
        Assert.Equal(delete ? 0 : 1, Directory.GetFiles(factory.MediaRoot, "*", SearchOption.AllDirectories).Length);
    }

    [Fact]
    public async Task Expired_claim_is_recovered_and_only_one_worker_can_claim_a_request()
    {
        await using var factory = new OptimizationFactory(); using var client = factory.CreateClient();
        var original = await factory.SeedAsync(client); var id = original.GetProperty("id").GetGuid();
        (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).EnsureSuccessStatusCode();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
            var job = await db.MediaOptimizationJobs.SingleAsync();
            job.Status = "Processing"; job.LeaseExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        factory.Optimizer.AfterWrite = async () => { entered.SetResult(); await release.Task; };
        var first = factory.Worker().ProcessNextAsync(default);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(await factory.Worker().ProcessNextAsync(default));
        release.SetResult(); await first;
        Assert.Equal(1, factory.Optimizer.Calls); Assert.Equal("Completed", (await factory.JobAsync(id)).Status);
    }

    [Fact]
    public async Task Shutdown_requeues_interrupted_work_and_removes_temporary_files()
    {
        await using var factory = new OptimizationFactory(); using var client = factory.CreateClient();
        var original = await factory.SeedAsync(client); var id = original.GetProperty("id").GetGuid();
        (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).EnsureSuccessStatusCode();
        using var stopping = new CancellationTokenSource();
        factory.Optimizer.AfterWrite = () => { stopping.Cancel(); throw new OperationCanceledException(stopping.Token); };
        await factory.Worker().ProcessNextAsync(stopping.Token);
        Assert.Equal("Queued", (await factory.JobAsync(id)).Status);
        Assert.Empty(Directory.GetFiles(factory.WorkRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Unavailable_tools_missing_assets_and_images_are_rejected()
    {
        await using var factory = new OptimizationFactory(); using var client = factory.CreateClient();
        var original = await factory.SeedAsync(client); var id = original.GetProperty("id").GetGuid();
        factory.Optimizer.IsAvailable = false;
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/api/media/{Guid.NewGuid()}/tv-optimization", null)).StatusCode);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var media = await db.MediaAssets.SingleAsync(); media.Type = MediaType.Image; await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"/api/media/{id}/tv-optimization", null)).StatusCode);
        Assert.Empty(await db.MediaOptimizationJobs.ToListAsync());
    }

    private sealed class FakeOptimizer : ITvVideoOptimizer
    {
        public bool IsAvailable { get; set; } = true;
        public int Calls { get; private set; }
        public int OutputSize { get; set; } = 4;
        public Func<Task>? AfterWrite { get; set; }
        public async Task<VideoDetails> OptimizeAsync(string inputPath, string outputPath, Action<double> progress, CancellationToken token)
        {
            Calls++; await File.WriteAllBytesAsync(outputPath, new byte[OutputSize], token); progress(.5);
            if (AfterWrite is not null) await AfterWrite();
            return new(640, 360, 10, 30, false, "h264", "yuv420p");
        }
    }

    private sealed class OptimizationFactory : WebApplicationFactory<PlayerHub>
    {
        public static readonly byte[] Source = new byte[1024];
        static OptimizationFactory() { "ftyp"u8.CopyTo(Source.AsSpan(4)); }
        private readonly SqliteConnection keeper = new($"Data Source=Optimization-{Guid.NewGuid()};Mode=Memory;Cache=Shared");
        private readonly string root = Path.Combine(Path.GetTempPath(), "revel-optimization-test-" + Guid.NewGuid());
        public string MediaRoot => Path.Combine(root, "media");
        public string WorkRoot => Path.Combine(root, "work");
        public FakeOptimizer Optimizer { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            keeper.Open();
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            { ["Database:ApplyMigrationsOnStartup"] = "false", ["MediaStorage:RootPath"] = MediaRoot,
                ["TvOptimization:Enabled"] = "true", ["TvOptimization:WorkPath"] = WorkRoot, ["Logging:LogLevel:Default"] = "Error" }));
            builder.ConfigureServices(services =>
            {
                services.Remove(services.Single(x => x.ServiceType == typeof(IHostedService) && x.ImplementationType == typeof(MediaOptimizationWorker)));
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseSqlite(keeper.ConnectionString).ReplaceService<IModelCustomizer, SqliteDates>());
                services.RemoveAll<IMediaStorage>(); services.AddSingleton<IMediaStorage>(new LocalMediaStorage(MediaRoot));
                services.RemoveAll<ITvVideoOptimizer>(); services.AddSingleton<ITvVideoOptimizer>(Optimizer);
            });
        }
        public MediaOptimizationWorker Worker() => new(Services.GetRequiredService<IServiceScopeFactory>(), Optimizer,
            new TvOptimizationOptions { Enabled = true, WorkPath = WorkRoot }, NullLogger<MediaOptimizationWorker>.Instance);
        public async Task<JsonElement> SeedAsync(HttpClient client)
        {
            using var scope = Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>().Database.EnsureCreatedAsync();
            using var created = await client.PostAsJsonAsync("/api/events", new { name = "TV " + Guid.NewGuid(), timeZone = "UTC" });
            created.EnsureSuccessStatusCode();
            var eventId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            using var uploaded = await UploadAsync(client, eventId); uploaded.EnsureSuccessStatusCode();
            return await uploaded.Content.ReadFromJsonAsync<JsonElement>();
        }
        public async Task<MediaOptimizationJob> JobAsync(Guid id)
        {
            using var scope = Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>().MediaOptimizationJobs.AsNoTracking().SingleAsync(x => x.MediaId == id);
        }
        public static async Task<HttpResponseMessage> UploadAsync(HttpClient client, Guid eventId, Guid? replace = null)
        {
            using var form = new MultipartFormDataContent();
            var file = new ByteArrayContent(replace.HasValue ? Source.Concat(new byte[] { 1 }).ToArray() : Source);
            file.Headers.ContentType = new MediaTypeHeaderValue("video/mp4"); form.Add(file, "file", "clip.mp4");
            if (replace.HasValue) form.Add(new StringContent(replace.Value.ToString()), "replaceMediaId");
            return await client.PostAsync($"/api/events/{eventId}/media", form);
        }
        public override async ValueTask DisposeAsync()
        {
            await base.DisposeAsync(); await keeper.DisposeAsync();
            if (Directory.Exists(root)) Directory.Delete(root, true);
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
