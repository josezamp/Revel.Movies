using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using RevelMovies.Api.Runtime;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Events;
using RevelMovies.Domain.Scenes;
using RevelMovies.Infrastructure.Persistence;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class SceneScheduleTests
{
    [Theory]
    [InlineData("2026-10-31T21:00", "America/Argentina/Buenos_Aires", "2026-11-01T00:00:00+00:00")]
    [InlineData("2026-11-01T00:15", "America/Argentina/Buenos_Aires", "2026-11-01T03:15:00+00:00")]
    public void Local_schedule_preserves_the_date_across_midnight(string local, string zone, string utc) =>
        Assert.Equal(DateTimeOffset.Parse(utc), SceneScheduleRegistry.ParseStart(local, zone));

    [Theory]
    [InlineData("2026-03-08T02:30", "America/New_York")]
    [InlineData("2026-11-01T01:30", "America/New_York")]
    [InlineData("2026-10-31T21:00", "Invalid/Zone")]
    [InlineData("2026-10-31T21:00Z", "UTC")]
    public void Ambiguous_nonexistent_and_invalid_times_are_rejected(string local, string zone) =>
        Assert.Throws<SceneValidationException>(() => SceneScheduleRegistry.ParseStart(local, zone));

    [Fact]
    public async Task Server_prepares_and_activates_without_panel_reads_and_freezes_confirmed_history()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var start = f.Clock.Now.AddMinutes(3);
        var entry = await Save(f, seed, start);
        await Tick(f);
        using (var scope = f.Services.CreateScope()) Assert.Empty(await Db(scope).SceneSessions.ToListAsync());
        f.Clock.Now = start.AddSeconds(-90); await Tick(f);
        using (var scope = f.Services.CreateScope())
        {
            Assert.Null((await Db(scope).DisplayPlaybackStates.SingleAsync()).AnnouncementJson);
            await Ready(scope, entry.Id);
        }
        await Tick(f);
        using (var scope = f.Services.CreateScope()) Assert.False(await Db(scope).SceneSessions.AnyAsync(x => x.Kind == "activate"));
        f.Clock.Now = start; await Tick(f);
        using (var scope = f.Services.CreateScope())
        {
            var state = await Db(scope).DisplayPlaybackStates.SingleAsync();
            Assert.Contains("Bienvenida", state.AnnouncementJson);
            var session = await scope.ServiceProvider.GetRequiredService<SceneRegistry>().Session(entry.Id, default);
            Assert.Equal("pending", session.Targets.Single().Status);
            await scope.ServiceProvider.GetRequiredService<CommandAcknowledgementRegistry>().RecordAsync(seed.DisplayId,
                state.LastCommandId!.Value, "scene.apply", "applied", null, null);
        }
        await Tick(f);
        using (var scope = f.Services.CreateScope())
        {
            Assert.Equal("activating", (await Db(scope).SceneSchedules.SingleAsync()).Status);
            var state = await Db(scope).DisplayPlaybackStates.SingleAsync();
            await scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>().ReportAsync(seed.DisplayId,
                new("Playing", null, null, null, 0, null, state.LastCommandId, state.Revision));
        }
        await Tick(f);
        using (var scope = f.Services.CreateScope())
        {
            var result = Assert.Single(await scope.ServiceProvider.GetRequiredService<SceneScheduleRegistry>().List(seed.EventId, default));
            Assert.Equal("completed", result.Status); Assert.Equal("applied", result.Targets.Single().Status);
            await scope.ServiceProvider.GetRequiredService<PlayerCommandDispatcher>().SendAsync([seed.DisplayId],
                new(1, Guid.NewGuid(), "announcement.clear", DateTimeOffset.UtcNow, null));
        }
        await Tick(f);
        using (var scope = f.Services.CreateScope())
        {
            Assert.Equal("completed", (await Db(scope).SceneSchedules.SingleAsync()).Status);
            Assert.Single(await Db(scope).SceneSessions.Where(x => x.Kind == "activate").ToArrayAsync());
        }
    }

    [Fact]
    public async Task Restart_after_activation_commit_does_not_repeat_playback_even_when_the_due_time_has_passed()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var entry = await Save(f, seed, f.Clock.Now.AddSeconds(20)); await Tick(f);
        long revision;
        using (var scope = f.Services.CreateScope())
        {
            await Ready(scope, entry.Id);
            var item = await Db(scope).SceneSchedules.SingleAsync();
            await scope.ServiceProvider.GetRequiredService<SceneRegistry>().Activate(seed.EventId, seed.SceneId,
                new(1, PreparationId: item.PreparationId), default, entry.Id);
            // Simulates termination after the activation transaction, before the scheduler status update.
            revision = (await Db(scope).DisplayPlaybackStates.SingleAsync()).Revision;
            Assert.Equal("preparing", item.Status);
        }
        f.Clock.Now = f.Clock.Now.AddMinutes(5); await Tick(f); await Tick(f);
        using var read = f.Services.CreateScope();
        Assert.Equal(revision, (await Db(read).DisplayPlaybackStates.SingleAsync()).Revision);
        Assert.Single(await Db(read).SceneSessions.Where(x => x.Kind == "activate").ToArrayAsync());
        Assert.Equal("activating", (await Db(read).SceneSchedules.SingleAsync()).Status);
    }

    [Fact]
    public async Task Repeated_occurrences_of_the_same_scene_do_not_invalidate_each_others_preparation()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var first = await Save(f, seed, f.Clock.Now.AddSeconds(30));
        var second = await Save(f, seed, f.Clock.Now.AddSeconds(90)); await Tick(f);
        using var scope = f.Services.CreateScope();
        await Ready(scope, first.Id); await Ready(scope, second.Id);
        var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        foreach (var item in await Db(scope).SceneSchedules.ToArrayAsync())
            Assert.Equal("ready", (await scenes.Session(item.PreparationId!.Value, default)).Status);
    }

    [Fact]
    public async Task Available_policy_records_offline_destinations_and_all_policy_does_not_partially_activate()
    {
        foreach (var policy in new[] { "all", "available" })
        {
            await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f, true);
            var start = f.Clock.Now.AddSeconds(20); var entry = await Save(f, seed, start, policy); await Tick(f);
            using (var scope = f.Services.CreateScope()) await Ready(scope, entry.Id, seed.DisplayId);
            f.Clock.Now = start; await Tick(f); await Tick(f);
            using var read = f.Services.CreateScope();
            var result = (await read.ServiceProvider.GetRequiredService<SceneScheduleRegistry>().List(seed.EventId, default)).Single();
            Assert.Equal("offline", result.Targets.Single(x => x.DisplayId != seed.DisplayId).PreparationStatus);
            if (policy == "available")
            {
                Assert.Equal("skipped", result.Targets.Single(x => x.DisplayId != seed.DisplayId).Status);
                Assert.True(await Db(read).SceneSessions.AnyAsync(x => x.Kind == "activate"));
            }
            else
            {
                Assert.False(await Db(read).SceneSessions.AnyAsync(x => x.Kind == "activate"));
                f.Clock.Now = start.AddSeconds(61); await Tick(f);
                var final = (await read.ServiceProvider.GetRequiredService<SceneScheduleRegistry>().List(seed.EventId, default)).Single();
                Assert.Equal("failed", final.Status);
            }
        }
    }

    [Fact]
    public async Task Reconnection_automatically_reprepares_before_activation()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var start = f.Clock.Now.AddSeconds(30); var entry = await Save(f, seed, start); await Tick(f);
        Guid original;
        using (var scope = f.Services.CreateScope())
        {
            await Ready(scope, entry.Id);
            original = (await Db(scope).SceneSchedules.SingleAsync()).PreparationId!.Value;
            await scope.ServiceProvider.GetRequiredService<SceneRegistry>().InvalidatePreparation(seed.DisplayId, default);
        }
        f.Clock.Now = start.AddSeconds(-29); await Tick(f);
        using (var scope = f.Services.CreateScope())
        {
            Assert.NotEqual(original, (await Db(scope).SceneSchedules.SingleAsync()).PreparationId);
            await Ready(scope, entry.Id);
        }
        f.Clock.Now = start; await Tick(f);
        using var read = f.Services.CreateScope(); Assert.True(await Db(read).SceneSessions.AnyAsync(x => x.Id == entry.Id));
    }

    [Fact]
    public async Task Cancelled_stale_and_changed_scenes_never_activate()
    {
        foreach (var scenario in new[] { "cancelled", "missed", "changed", "deleted" })
        {
            await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
            var start = f.Clock.Now.AddSeconds(20); var entry = await Save(f, seed, start);
            using (var scope = f.Services.CreateScope())
            {
                var db = Db(scope);
                if (scenario == "cancelled") await scope.ServiceProvider.GetRequiredService<SceneScheduleRegistry>().Cancel(seed.EventId, entry.Id, entry.Version, default);
                if (scenario == "changed") (await db.Scenes.SingleAsync()).Version++;
                if (scenario == "deleted") db.Scenes.Remove(await db.Scenes.SingleAsync());
                await db.SaveChangesAsync();
            }
            f.Clock.Now = scenario == "missed" ? start.AddMinutes(2) : start; await Tick(f);
            using var read = f.Services.CreateScope();
            Assert.False(await Db(read).SceneSessions.AnyAsync(x => x.Kind == "activate"));
            Assert.Equal(scenario is "changed" or "deleted" ? "failed" : scenario, (await Db(read).SceneSchedules.SingleAsync()).Status);
        }
    }

    [Fact]
    public async Task A_late_restart_selects_the_latest_due_entry_instead_of_playing_every_missed_change()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var first = await Save(f, seed, f.Clock.Now.AddSeconds(20));
        var second = await Save(f, seed, f.Clock.Now.AddSeconds(40));
        f.Clock.Now = f.Clock.Now.AddSeconds(45); await Tick(f);
        using (var scope = f.Services.CreateScope())
        {
            Assert.Equal("missed", (await Db(scope).SceneSchedules.SingleAsync(x => x.Id == first.Id)).Status);
            await Ready(scope, second.Id);
        }
        await Tick(f);
        using var read = f.Services.CreateScope();
        Assert.Equal(second.Id, (await Db(read).SceneSessions.SingleAsync(x => x.Kind == "activate")).Id);
        Assert.Equal(1, (await Db(read).DisplayPlaybackStates.SingleAsync()).Revision);
    }

    [Fact]
    public async Task Preparation_progress_does_not_interrupt_an_open_edit_and_rescheduling_discards_the_old_preparation()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var entry = await Save(f, seed, f.Clock.Now.AddSeconds(30)); await Tick(f);
        using (var scope = f.Services.CreateScope()) await Ready(scope, entry.Id);
        await Tick(f);
        using var edit = f.Services.CreateScope();
        var updated = await edit.ServiceProvider.GetRequiredService<SceneScheduleRegistry>().Save(seed.EventId, entry.Id,
            Input(seed, f.Clock.Now.AddHours(1)) with { Version = entry.Version, TimeZone = "UTC" }, default);
        Assert.Equal("scheduled", updated.Status);
        Assert.Equal(entry.Version + 1, updated.Version);
        Assert.Null((await Db(edit).SceneSchedules.SingleAsync()).PreparationId);
    }

    [Fact]
    public async Task A_failed_future_entry_can_be_replaced_at_the_same_time_after_confirming_the_new_scene_version()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var start = f.Clock.Now.AddSeconds(30); await Save(f, seed, start);
        using (var scope = f.Services.CreateScope())
        { (await Db(scope).Scenes.SingleAsync()).Version++; await Db(scope).SaveChangesAsync(); }
        await Tick(f);
        using var edit = f.Services.CreateScope();
        Assert.Equal("failed", (await Db(edit).SceneSchedules.SingleAsync()).Status);
        var replacement = await edit.ServiceProvider.GetRequiredService<SceneScheduleRegistry>().Save(seed.EventId, null,
            Input(seed, start) with { SceneVersion = 2 }, default);
        Assert.Equal("scheduled", replacement.Status);
        Assert.Equal(2, await Db(edit).SceneSchedules.CountAsync());
    }

    [Fact]
    public async Task Api_rejects_conflicts_cross_event_edits_and_past_dates_and_supports_rescheduling()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var start = f.Clock.Now.AddMinutes(5);
        var request = Input(seed, start);
        var response = await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule", request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var entry = (await response.Content.ReadFromJsonAsync<SceneScheduleResponse>())!;
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule", request)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule", Input(seed, f.Clock.Now.AddMinutes(-1)))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/events/{Guid.NewGuid()}/schedule/{entry.Id}", request with { Version = entry.Version })).StatusCode);
        var changed = await client.PutAsJsonAsync($"/api/events/{seed.EventId}/schedule/{entry.Id}", Input(seed, start.AddHours(1)) with { Version = entry.Version });
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule/{entry.Id}/cancel", new { entry.Version })).StatusCode);
        var updated = (await changed.Content.ReadFromJsonAsync<SceneScheduleResponse>())!;
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule/{entry.Id}/cancel", new { updated.Version })).StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Delete_pending_entry_prevents_execution_even_after_preparation(bool prepare)
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var start = f.Clock.Now.AddSeconds(20); var entry = await Save(f, seed, start);
        if (prepare) { await Tick(f); using var ready = f.Services.CreateScope(); await Ready(ready, entry.Id); }
        var status = prepare ? "preparing" : "scheduled";
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(DeleteUrl(seed.EventId, entry, status))).StatusCode);
        f.Clock.Now = start; await Tick(f);
        using var read = f.Services.CreateScope();
        Assert.Empty(await Db(read).SceneSchedules.ToArrayAsync());
        Assert.False(await Db(read).SceneSessions.AnyAsync(x => x.Kind == "activate"));
        Assert.True(await Db(read).Scenes.AnyAsync(x => x.Id == seed.SceneId));
        Assert.Null((await Db(read).DisplayPlaybackStates.SingleAsync()).AnnouncementJson);
    }

    [Theory]
    [InlineData("version")]
    [InlineData("event")]
    [InlineData("status")]
    [InlineData("activating")]
    [InlineData("committed")]
    public async Task Delete_rejects_changed_or_executing_entries(string scenario)
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var entry = await Save(f, seed, f.Clock.Now.AddMinutes(5));
        using (var edit = f.Services.CreateScope())
        {
            var item = await Db(edit).SceneSchedules.SingleAsync();
            if (scenario == "version") item.Version++;
            if (scenario == "status") item.Status = "completed";
            if (scenario == "activating") item.Status = "activating";
            if (scenario == "committed") Db(edit).SceneSessions.Add(new() { Id = entry.Id, EventId = seed.EventId, SceneId = seed.SceneId, Kind = "activate" });
            await Db(edit).SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync(DeleteUrl(scenario == "event" ? Guid.NewGuid() : seed.EventId,
            entry, scenario == "activating" ? "activating" : "scheduled"))).StatusCode);
        using var read = f.Services.CreateScope(); Assert.Single(await Db(read).SceneSchedules.ToArrayAsync());
    }

    [Fact]
    public async Task Deleting_completed_entry_preserves_playback_and_temporary_return()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using (var edit = f.Services.CreateScope()) { (await Db(edit).Scenes.SingleAsync()).TemporaryDurationSeconds = 60; await Db(edit).SaveChangesAsync(); }
        var start = f.Clock.Now.AddSeconds(20); var entry = await Save(f, seed, start); await Tick(f);
        using (var ready = f.Services.CreateScope()) await Ready(ready, entry.Id);
        f.Clock.Now = start; await Tick(f);
        long revision;
        using (var report = f.Services.CreateScope())
        {
            var state = await Db(report).DisplayPlaybackStates.SingleAsync(); revision = state.Revision;
            await report.ServiceProvider.GetRequiredService<PlaybackStateRegistry>().ReportAsync(seed.DisplayId,
                new("Idle", null, null, null, 0, null, state.LastCommandId, state.Revision));
        }
        await Tick(f);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync(DeleteUrl(seed.EventId, entry, "completed"))).StatusCode);
        using var read = f.Services.CreateScope();
        var playback = read.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var recovery = (await playback.GetRecoveryAsync(seed.DisplayId))!;
        Assert.Equal(revision, recovery.Revision); Assert.Equal(entry.Id, recovery.SceneSessionId);
        Assert.Equal("Bienvenida", recovery.Announcement!.Value.GetProperty("text").GetString());
        Assert.Empty(await Db(read).SceneSchedules.ToArrayAsync());
        await read.ServiceProvider.GetRequiredService<SceneRegistry>().Restore(entry.Id, default);
        Assert.Null((await playback.GetRecoveryAsync(seed.DisplayId))!.Announcement);
    }

    [Fact]
    public async Task Clear_history_deletes_only_confirmed_terminal_rows_of_the_event()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f); var other = await Seed(f);
        var selected = new List<SceneScheduleReference>();
        using (var edit = f.Services.CreateScope())
        {
            foreach (var status in new[] { "completed", "partial", "failed", "missed", "cancelled" })
            {
                var item = new SceneSchedule { EventId = seed.EventId, SceneId = seed.SceneId, Status = status };
                Db(edit).SceneSchedules.Add(item); selected.Add(new(item.Id, item.Version));
            }
            foreach (var status in new[] { "scheduled", "preparing", "activating", "completed" })
                Db(edit).SceneSchedules.Add(new() { EventId = seed.EventId, SceneId = seed.SceneId, Status = status });
            Db(edit).SceneSchedules.Add(new() { EventId = other.EventId, SceneId = other.SceneId, Status = "cancelled" });
            await Db(edit).SaveChangesAsync();
        }
        var response = await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule/clear-history", new ClearSceneScheduleHistoryRequest(selected.ToArray()));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(5, (await response.Content.ReadFromJsonAsync<ClearSceneScheduleHistoryResponse>())!.DeletedCount);
        using var read = f.Services.CreateScope();
        Assert.Equal(4, await Db(read).SceneSchedules.CountAsync(x => x.EventId == seed.EventId));
        Assert.Single(await Db(read).SceneSchedules.Where(x => x.EventId == other.EventId).ToArrayAsync());
        Assert.False(await Db(read).SceneSchedules.AnyAsync(x => selected.Select(s => s.Id).Contains(x.Id)));
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("version")]
    [InlineData("event")]
    [InlineData("duplicate")]
    public async Task Clear_history_rejects_invalid_selection_without_partial_deletion(string scenario)
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f); var other = await Seed(f);
        var valid = new SceneSchedule { EventId = seed.EventId, SceneId = seed.SceneId, Status = "cancelled" };
        var invalid = new SceneSchedule { EventId = scenario == "event" ? other.EventId : seed.EventId,
            SceneId = seed.SceneId, Status = scenario == "pending" ? "scheduled" : "completed" };
        using (var edit = f.Services.CreateScope()) { Db(edit).SceneSchedules.AddRange(valid, invalid); await Db(edit).SaveChangesAsync(); }
        SceneScheduleReference[] selected = [new(valid.Id, valid.Version), new(scenario == "duplicate" ? valid.Id : invalid.Id, scenario == "version" ? 2 : 1)];
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule/clear-history",
            new ClearSceneScheduleHistoryRequest(selected))).StatusCode);
        using var read = f.Services.CreateScope(); Assert.Equal(2, await Db(read).SceneSchedules.CountAsync());
    }

    [Fact]
    public async Task Clearing_newer_history_does_not_revive_an_older_pending_occurrence()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        var start = f.Clock.Now.AddSeconds(20);
        var older = await Save(f, seed, start); var newer = await Save(f, seed, start.AddSeconds(5)); await Tick(f);
        using (var edit = f.Services.CreateScope())
        {
            await Ready(edit, older.Id);
            (await Db(edit).SceneSchedules.SingleAsync(x => x.Id == newer.Id)).Status = "completed";
            await Db(edit).SaveChangesAsync();
        }
        f.Clock.Now = start.AddSeconds(10);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/events/{seed.EventId}/schedule/clear-history",
            new ClearSceneScheduleHistoryRequest([new(newer.Id, newer.Version)]))).StatusCode);
        await Tick(f);
        using var read = f.Services.CreateScope();
        Assert.Equal("missed", (await Db(read).SceneSchedules.SingleAsync()).Status);
        Assert.False(await Db(read).SceneSessions.AnyAsync(x => x.Kind == "activate"));
    }

    private static string DeleteUrl(Guid eventId, SceneScheduleResponse entry, string status) =>
        $"/api/events/{eventId}/schedule/{entry.Id}?version={entry.Version}&status={status}";
    private static RevelMoviesDbContext Db(IServiceScope scope) => scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
    private static async Task Tick(Factory factory) { using var scope = factory.Services.CreateScope(); await scope.ServiceProvider.GetRequiredService<SceneScheduleRegistry>().Tick(default); }
    private static SaveSceneScheduleRequest Input(SeedData seed, DateTimeOffset start, string policy = "available") =>
        new(seed.SceneId, 1, start.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss"), "UTC", policy);
    private static async Task<SceneScheduleResponse> Save(Factory f, SeedData seed, DateTimeOffset start, string policy = "available")
    { using var scope = f.Services.CreateScope(); return await scope.ServiceProvider.GetRequiredService<SceneScheduleRegistry>().Save(seed.EventId, null, Input(seed, start, policy), default); }
    private static async Task Ready(IServiceScope scope, Guid scheduleId, Guid? displayId = null)
    {
        var schedule = await Db(scope).SceneSchedules.SingleAsync(x => x.Id == scheduleId);
        var session = await scope.ServiceProvider.GetRequiredService<SceneRegistry>().Session(schedule.PreparationId!.Value, default);
        foreach (var target in session.Targets.Where(x => !displayId.HasValue || x.DisplayId == displayId))
            await scope.ServiceProvider.GetRequiredService<CommandAcknowledgementRegistry>().RecordAsync(target.DisplayId, target.CommandId, "scene.prepare", "ready", null, null);
    }
    private sealed record SeedData(Guid EventId, Guid DisplayId, Guid SceneId);
    private static async Task<SeedData> Seed(Factory f, bool offline = false)
    {
        using var scope = f.Services.CreateScope(); var db = Db(scope);
        var evt = new Event { Name = "Agenda", Slug = Guid.NewGuid().ToString() };
        var display = new Display { EventId = evt.Id, Name = "Patio", Status = DisplayStatus.Online, DeviceTokenHash = Guid.NewGuid().ToString() };
        db.Events.Add(evt); db.Displays.Add(display); db.DisplayPlaybackStates.Add(new() { DisplayId = display.Id });
        var ids = new List<Guid> { display.Id };
        if (offline) { var other = new Display { EventId = evt.Id, Name = "Barra", Status = DisplayStatus.Offline, DeviceTokenHash = Guid.NewGuid().ToString() }; db.Displays.Add(other); ids.Add(other.Id); }
        await db.SaveChangesAsync();
        var scene = await scope.ServiceProvider.GetRequiredService<SceneRegistry>().Save(evt.Id, null, new("Bienvenida",
            [new(ids.ToArray(), [], new(), new(), new("replace", JsonSerializer.SerializeToElement(new { kind = "message", text = "Bienvenida", layout = "banner", theme = "dark" })))]), default);
        return new(evt.Id, display.Id, scene.Id);
    }
    private sealed class TestClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Factory : AuthenticatedApiFactory
    {
        public TestClock Clock { get; } = new();
        private readonly string database = Guid.NewGuid().ToString();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["Database:ApplyMigrationsOnStartup"] = "false" }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>(); services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseInMemoryDatabase(database));
                services.RemoveAll<TimeProvider>(); services.AddSingleton<TimeProvider>(Clock);
                // Drive the production worker operation deterministically with a controlled clock.
                var worker = services.Single(x => x.ServiceType == typeof(IHostedService) && x.ImplementationType == typeof(SceneScheduleService));
                services.Remove(worker);
            });
        }
    }
}
