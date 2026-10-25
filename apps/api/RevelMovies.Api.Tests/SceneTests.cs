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
using RevelMovies.Domain.Events;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Playback;
using RevelMovies.Infrastructure.Persistence;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class SceneTests
{
    private static JsonElement Announcement(string text = "Sorteo") => JsonSerializer.SerializeToElement(new { kind = "message", text, layout = "banner", theme = "dark" });
    private static SceneAssignment Overlay(Guid id) => new([id], [], new(), new(), new("replace", Announcement()));

    [Fact]
    public async Task Rename_offline_preserves_identity_pairing_group_and_playback()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var beforeScope = f.Services.CreateScope(); var db = beforeScope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var display = await db.Displays.SingleAsync(x => x.Id == seed.A); display.Status = DisplayStatus.Offline; await db.SaveChangesAsync();
        var before = await db.DisplayPlaybackStates.AsNoTracking().SingleAsync(x => x.DisplayId == seed.A);
        using var response = await client.PutAsJsonAsync($"/api/displays/{seed.A}/settings", new { name = "  Patio nuevo  " });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var afterScope = f.Services.CreateScope(); var afterDb = afterScope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var renamed = await afterDb.Displays.SingleAsync(x => x.Id == seed.A);
        Assert.Equal("Patio nuevo", renamed.Name); Assert.Equal("unchanged-token", renamed.DeviceTokenHash);
        Assert.Equal(seed.EventId, renamed.EventId); Assert.Equal(DisplayStatus.Offline, renamed.Status);
        Assert.True(await afterDb.DisplayGroupMembers.AnyAsync(x => x.DisplayId == seed.A));
        var after = await afterDb.DisplayPlaybackStates.SingleAsync(x => x.DisplayId == seed.A);
        Assert.Equal(before.PayloadJson, after.PayloadJson); Assert.Equal(before.LastCommandId, after.LastCommandId); Assert.Equal(before.Revision, after.Revision);
    }

    [Fact]
    public async Task Save_prepare_and_partial_ack_do_not_change_the_broadcast_or_validate_new_versions()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var playback = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var before = await playback.GetRecoveryAsync(seed.A);
        var scene = await scenes.Save(seed.EventId, null, new("Sorteo", [Overlay(seed.A)]), default);
        var prepared = await scenes.Prepare(seed.EventId, scene.Id, new(scene.Version), default);
        var after = await playback.GetRecoveryAsync(seed.A);
        Assert.Equal(before!.CommandId, after!.CommandId); Assert.Equal(before.Revision, after.Revision);
        Assert.Equal(before.Payload?.GetRawText(), after.Payload?.GetRawText()); Assert.Equal(before.UpdatedAt, after.UpdatedAt);
        Assert.Equal(before.DesiredState, after.DesiredState); Assert.Null(after.Announcement);
        await Ack(scope, prepared, seed.A, "partial");
        Assert.Equal("attention", (await scenes.Session(prepared.Id, default)).Status);
        await Assert.ThrowsAsync<SceneValidationException>(() => scenes.Activate(seed.EventId, scene.Id, new(scene.Version, PreparationId: prepared.Id), default));
        var edited = await scenes.Save(seed.EventId, scene.Id, new("Nuevo", scene.Assignments, Version: scene.Version), default);
        await Ack(scope, prepared, seed.A, "ready");
        await Assert.ThrowsAsync<SceneValidationException>(() => scenes.Activate(seed.EventId, scene.Id, new(edited.Version, PreparationId: prepared.Id), default));
    }

    [Fact]
    public async Task Old_ack_and_manual_action_cannot_validate_a_new_preparation()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var scene = await scenes.Save(seed.EventId, null, new("Sorteo", [Overlay(seed.A)]), default);
        var first = await scenes.Prepare(seed.EventId, scene.Id, new(1), default);
        var second = await scenes.Prepare(seed.EventId, scene.Id, new(1), default);
        await Ack(scope, first, seed.A, "ready");
        Assert.Equal("superseded", (await scenes.Session(first.Id, default)).Targets.Single().Status);
        Assert.Equal("pending", (await scenes.Session(second.Id, default)).Targets.Single().Status);
        await Ack(scope, second, seed.A, "ready");
        await scope.ServiceProvider.GetRequiredService<PlayerCommandDispatcher>().SendAsync([seed.A], new(1, Guid.NewGuid(), "announcement.clear", DateTimeOffset.UtcNow, null));
        Assert.Equal("superseded", (await scenes.Session(second.Id, default)).Targets.Single().Status);
    }

    [Fact]
    public async Task Partial_activation_names_skipped_targets_and_requires_correlated_telemetry()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var scene = await scenes.Save(seed.EventId, null, new("Sorteo", [Overlay(seed.A), Overlay(seed.B)]), default);
        var prepare = await scenes.Prepare(seed.EventId, scene.Id, new(1), default); await Ack(scope, prepare, seed.A, "ready");
        await Assert.ThrowsAsync<SceneValidationException>(() => scenes.Activate(seed.EventId, scene.Id, new(1, PreparationId: prepare.Id), default));
        var active = await scenes.Activate(seed.EventId, scene.Id, new(1, PreparationId: prepare.Id, Policy: "available"), default);
        Assert.Equal("skipped", active.Targets.Single(x => x.DisplayId == seed.B).Status);
        var target = active.Targets.Single(x => x.DisplayId == seed.A);
        await Ack(scope, active, seed.A, "received");
        Assert.Equal("pending", (await scenes.Session(active.Id, default)).Targets.Single(x => x.DisplayId == seed.A).Status);
        var playback = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        await playback.ReportAsync(seed.A, new("Playing", seed.MediaId, null, null, 5, 20, Guid.NewGuid(), target.AppliedRevision));
        Assert.NotEqual(target.CommandId, (await playback.GetAsync(seed.A))!.ActualCommandId);
        await playback.ReportAsync(seed.A, new("Playing", seed.MediaId, null, null, 5, 20, target.CommandId, target.AppliedRevision,
            new(false, Announcement())));
        Assert.Equal("applied", (await scenes.Session(active.Id, default)).Targets.Single(x => x.DisplayId == seed.A).Status);
        Assert.Equal("partial", (await scenes.Session(active.Id, default)).Status);
    }

    [Fact]
    public async Task Overlapping_groups_deduplicate_identical_assignments_and_reject_conflicts()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var assignment = Overlay(seed.A);
        var groupAssignment = assignment with { DisplayIds = [], GroupIds = [seed.GroupId] };
        var scene = await scenes.Save(seed.EventId, null, new("Iguales", [assignment, groupAssignment]), default);
        Assert.Single((await scenes.Prepare(seed.EventId, scene.Id, new(1), default)).Targets);
        await Assert.ThrowsAsync<SceneValidationException>(() => scenes.Save(seed.EventId, null, new("Conflicto", [assignment,
            groupAssignment with { Announcement = new("replace", Announcement("Diferente")) }]), default));
    }

    [Fact]
    public async Task Expired_scene_restores_only_unchanged_targets_and_recovery_never_returns_it()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var scene = await scenes.Save(seed.EventId, null, new("Temporal", [Overlay(seed.A), Overlay(seed.B)], 30), default);
        var prepare = await scenes.Prepare(seed.EventId, scene.Id, new(1), default);
        await Ack(scope, prepare, seed.A, "ready"); await Ack(scope, prepare, seed.B, "network");
        var activation = await scenes.Activate(seed.EventId, scene.Id, new(1, PreparationId: prepare.Id), default);
        var playback = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var dispatcher = scope.ServiceProvider.GetRequiredService<PlayerCommandDispatcher>();
        await dispatcher.SendAsync([seed.B], dispatcher.Create("announcement.show", Announcement("Manual posterior")));
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        (await db.SceneSessions.SingleAsync(x => x.Id == activation.Id)).ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        await db.SaveChangesAsync(); await scenes.Expire(default);
        var a = await playback.GetRecoveryAsync(seed.A); var b = await playback.GetRecoveryAsync(seed.B);
        Assert.Null(a!.Announcement); Assert.Null(a.SceneSessionId); Assert.Equal("Playing", a.DesiredState);
        Assert.Equal("Manual posterior", b!.Announcement!.Value.GetProperty("text").GetString());
        var restored = await scenes.Session(activation.Id, default);
        var restoring = restored.Targets.Single(x => x.DisplayId == seed.A);
        Assert.Equal("restoring", restoring.Status);
        await playback.ReportAsync(seed.A, new("Playing", seed.MediaId, null, null, 6, 20, restoring.CommandId, restoring.AppliedRevision, new()));
        Assert.Equal("restored", (await scenes.Session(activation.Id, default)).Targets.Single(x => x.DisplayId == seed.A).Status);
        Assert.Equal("superseded", restored.Targets.Single(x => x.DisplayId == seed.B).Status);
    }

    [Fact]
    public async Task Countdown_duration_begins_at_activation_and_blackout_restore_keeps_background()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var countdown = JsonSerializer.SerializeToElement(new { kind = "countdown", text = "Pronto", completedText = "Ahora", durationSeconds = 300, layout = "fullscreen", theme = "dark" });
        var assignment = Overlay(seed.A) with { Announcement = new("replace", countdown) };
        var scene = await scenes.Save(seed.EventId, null, new("Cuenta", [assignment]), default);
        Assert.True(scene.Assignments[0].Announcement.Payload!.Value.TryGetProperty("durationSeconds", out _));
        var prepared = await scenes.Prepare(seed.EventId, scene.Id, new(1), default); await Ack(scope, prepared, seed.A, "ready");
        var active = await scenes.Activate(seed.EventId, scene.Id, new(1, PreparationId: prepared.Id), default);
        var playback = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        var deadline = (await playback.GetRecoveryAsync(seed.A))!.Announcement!.Value.GetProperty("endsAt").GetDateTimeOffset();
        Assert.InRange((deadline - DateTimeOffset.UtcNow).TotalSeconds, 298, 302);
        var before = await playback.GetRecoveryAsync(seed.A);
        await playback.ApplyControlAsync([seed.A], "display.blackout", Guid.NewGuid());
        Assert.True((await playback.GetRecoveryAsync(seed.A))!.Blackout);
        await playback.ApplyControlAsync([seed.A], "display.restore", Guid.NewGuid());
        var restored = await playback.GetRecoveryAsync(seed.A);
        Assert.False(restored!.Blackout); Assert.Equal(before!.DesiredState, restored.DesiredState); Assert.Equal(before.Payload?.GetRawText(), restored.Payload?.GetRawText());
    }

    [Fact]
    public async Task Reconnect_invalidates_readiness_and_migration_matches_the_model()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var scene = await scenes.Save(seed.EventId, null, new("Preparada", [Overlay(seed.A)]), default);
        var prepare = await scenes.Prepare(seed.EventId, scene.Id, new(1), default); await Ack(scope, prepare, seed.A, "ready");
        await scenes.InvalidatePreparation(seed.A, default);
        Assert.Equal("superseded", (await scenes.Session(prepare.Id, default)).Targets.Single().Status);
        using var db = new RevelMoviesDbContext(new DbContextOptionsBuilder<RevelMoviesDbContext>().UseSqlServer("Server=localhost;Database=ScriptOnly;Integrated Security=true;TrustServerCertificate=true").Options);
        Assert.False(db.Database.HasPendingModelChanges());
        var script = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>().GenerateScript("20261017120000_AddWebPages");
        Assert.Contains("CREATE TABLE [scenes]", script); Assert.Contains("CREATE TABLE [scene_sessions]", script); Assert.Contains("[actual_command_id]", script);
    }

    [Fact]
    public async Task Snapshot_keeps_pause_checkpoint_and_restore_replaced_media_resumes_the_previous_assignment()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var playback = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        await playback.ApplyControlAsync([seed.A], "media.pause", Guid.NewGuid());
        var snapshot = await scenes.Snapshot(seed.EventId, new("Pausa", [seed.A]), default);
        Assert.Equal("Paused", snapshot.Assignments.Single().Media.State);
        Assert.InRange(snapshot.Assignments.Single().Media.ResumePositionSeconds!.Value, 5, 7);
        var prepare = await scenes.Prepare(seed.EventId, snapshot.Id, new(1), default); await Ack(scope, prepare, seed.A, "ready");
        var activation = await scenes.Activate(seed.EventId, snapshot.Id, new(1, PreparationId: prepare.Id), default);
        Assert.Equal("Paused", (await playback.GetRecoveryAsync(seed.A))!.DesiredState);
        var restored = await scenes.Restore(activation.Id, default);
        Assert.Equal("restoring", restored.Targets.Single().Status);
        var recovery = await playback.GetRecoveryAsync(seed.A);
        Assert.Equal("Paused", recovery!.DesiredState);
        Assert.InRange(recovery.ResumePositionSeconds!.Value, 5, 7);
        Assert.Equal(seed.MediaId, recovery.Payload!.Value.GetProperty("mediaId").GetGuid());
    }

    [Fact]
    public async Task Telemetry_advances_playlist_item_and_exposes_visible_layers_without_changing_the_assignment()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var state = await db.DisplayPlaybackStates.SingleAsync(x => x.DisplayId == seed.A);
        var playlistId = Guid.NewGuid(); var commandId = Guid.NewGuid(); var secondMedia = Guid.NewGuid();
        state.ContentType = "Playlist"; state.PlaylistId = playlistId; state.LastCommandId = commandId; state.Revision = 4;
        await db.SaveChangesAsync();
        var playback = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        await playback.ReportAsync(seed.A, new("Playing", seed.MediaId, playlistId, 0, 5, 20, commandId, 4));
        await playback.ReportAsync(seed.A, new("Playing", secondMedia, playlistId, 1, 8, 30, commandId, 4,
            new(false, Announcement(), JsonSerializer.SerializeToElement(new { url = "https://example.com" }), "assigned", true)));
        var displays = await client.GetFromJsonAsync<JsonElement>("/api/displays");
        var display = displays.EnumerateArray().Single(x => x.GetProperty("id").GetGuid() == seed.A);
        Assert.Equal(secondMedia, display.GetProperty("actualMediaAssetId").GetGuid());
        Assert.Equal(1, display.GetProperty("actualPlaylistIndex").GetInt32());
        Assert.Equal(30, display.GetProperty("actualDurationSeconds").GetDouble());
        Assert.Equal("assigned", display.GetProperty("actualWebPageStatus").GetString());
        Assert.Equal("Sorteo", display.GetProperty("actualAnnouncement").GetProperty("text").GetString());
        Assert.Equal(commandId, display.GetProperty("actualCommandId").GetGuid());
        await playback.ReportAsync(seed.A, new("Ended", seed.MediaId, playlistId, 0, 20, 20, Guid.NewGuid(), 3));
        Assert.Equal(secondMedia, (await playback.GetAsync(seed.A))!.ActualMediaAssetId);
        Assert.Equal("Playing", (await playback.GetAsync(seed.A))!.DesiredState);
    }

    [Fact]
    public async Task A_delayed_session_update_cannot_overwrite_a_restore_command()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var scene = await scenes.Save(seed.EventId, null, new("Retorno", [Overlay(seed.A)]), default);
        var prepare = await scenes.Prepare(seed.EventId, scene.Id, new(1), default); await Ack(scope, prepare, seed.A, "ready");
        var activation = await scenes.Activate(seed.EventId, scene.Id, new(1, PreparationId: prepare.Id), default);
        using var staleScope = f.Services.CreateScope(); var staleDb = staleScope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var stale = await staleDb.SceneSessions.SingleAsync(x => x.Id == activation.Id);
        var restore = await scenes.Restore(activation.Id, default);
        stale.TargetsJson = stale.TargetsJson.Replace("pending", "applied");
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => staleDb.SaveChangesAsync());
        using var readScope = f.Services.CreateScope();
        var result = await readScope.ServiceProvider.GetRequiredService<SceneRegistry>().Session(activation.Id, default);
        Assert.Equal(restore.Targets.Single().CommandId, result.Targets.Single().CommandId);
        Assert.Equal("restoring", result.Targets.Single().Status);
    }

    [Fact]
    public async Task Snapshot_of_a_finished_countdown_saves_its_visible_completion_message()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var state = await db.DisplayPlaybackStates.SingleAsync(x => x.DisplayId == seed.A);
        state.AnnouncementJson = JsonSerializer.Serialize(new { kind = "countdown", text = "Falta poco", completedText = "¡Ahora!", layout = "fullscreen", theme = "dark", endsAt = DateTimeOffset.UtcNow.AddMinutes(-1) });
        await db.SaveChangesAsync();
        var scene = await scope.ServiceProvider.GetRequiredService<SceneRegistry>().Snapshot(seed.EventId, new("Final", [seed.A]), default);
        var announcement = scene.Assignments.Single().Announcement.Payload!.Value;
        Assert.Equal("message", announcement.GetProperty("kind").GetString());
        Assert.Equal("¡Ahora!", announcement.GetProperty("text").GetString());
    }

    [Fact]
    public async Task Returning_from_a_later_scene_does_not_revive_an_expired_temporary_scene()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var first = await scenes.Save(seed.EventId, null, new("Temporal previa", [Overlay(seed.A)], 30), default);
        var prepA = await scenes.Prepare(seed.EventId, first.Id, new(1), default); await Ack(scope, prepA, seed.A, "ready");
        var activeA = await scenes.Activate(seed.EventId, first.Id, new(1, PreparationId: prepA.Id), default);
        var assignment = Overlay(seed.A) with { Announcement = new(), WebPage = new("replace", JsonSerializer.SerializeToElement(new { url = "https://example.com" })) };
        var next = await scenes.Save(seed.EventId, null, new("Página posterior", [assignment]), default);
        var prepB = await scenes.Prepare(seed.EventId, next.Id, new(1), default); await Ack(scope, prepB, seed.A, "network");
        var activeB = await scenes.Activate(seed.EventId, next.Id, new(1, PreparationId: prepB.Id), default);
        var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var record = await db.SceneSessions.SingleAsync(x => x.Id == activeB.Id);
        var targets = JsonSerializer.Deserialize<SceneTargetResult[]>(record.TargetsJson, SceneRegistry.Json)!;
        targets[0].Previous = targets[0].Previous! with { SceneExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1) };
        record.TargetsJson = JsonSerializer.Serialize(targets, SceneRegistry.Json);
        (await db.SceneSessions.SingleAsync(x => x.Id == activeA.Id)).ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        await db.SaveChangesAsync();
        await scenes.Restore(activeB.Id, default);
        var recovery = await scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>().GetRecoveryAsync(seed.A);
        Assert.Null(recovery!.Announcement); Assert.Null(recovery.WebPage); Assert.Null(recovery.SceneSessionId);
        Assert.Equal("Playing", recovery.DesiredState);
    }

    [Fact]
    public async Task Many_successive_permanent_scenes_remain_activatable_and_return_to_the_immediately_previous_content()
    {
        await using var f = new Factory(); using var client = f.CreateClient(); var seed = await Seed(f);
        using var scope = f.Services.CreateScope(); var scenes = scope.ServiceProvider.GetRequiredService<SceneRegistry>();
        var scene = await scenes.Save(seed.EventId, null, new("Momentos", [Overlay(seed.A)]), default);
        SceneSessionResponse? lastActivation = null;
        for (var i = 1; i <= 24; i++)
        {
            scene = await scenes.Save(seed.EventId, scene.Id, new("Momentos", [Overlay(seed.A) with
                { Announcement = new("replace", Announcement($"Momento {i}")) }], Version: scene.Version), default);
            var prepared = await scenes.Prepare(seed.EventId, scene.Id, new(scene.Version), default);
            await Ack(scope, prepared, seed.A, "ready");
            lastActivation = await scenes.Activate(seed.EventId, scene.Id, new(scene.Version, PreparationId: prepared.Id), default);
        }
        var playback = scope.ServiceProvider.GetRequiredService<PlaybackStateRegistry>();
        Assert.Equal("Momento 24", (await playback.GetRecoveryAsync(seed.A))!.Announcement!.Value.GetProperty("text").GetString());
        await scenes.Restore(lastActivation!.Id, default);
        var restored = await playback.GetRecoveryAsync(seed.A);
        Assert.Equal("Momento 23", restored!.Announcement!.Value.GetProperty("text").GetString());
        Assert.Equal("Playing", restored.DesiredState);
        Assert.Equal(seed.MediaId, restored.Payload!.Value.GetProperty("mediaId").GetGuid());
    }

    private static Task Ack(IServiceScope scope, SceneSessionResponse session, Guid displayId, string status) =>
        scope.ServiceProvider.GetRequiredService<CommandAcknowledgementRegistry>().RecordAsync(displayId,
            session.Targets.Single(x => x.DisplayId == displayId).CommandId, session.Kind == "prepare" ? "scene.prepare" : "scene.apply", status, null, null);

    private static async Task<(Guid EventId, Guid A, Guid B, Guid GroupId, Guid MediaId)> Seed(Factory factory)
    {
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<RevelMoviesDbContext>();
        var evt = new Event { Name = "Fiesta", Slug = Guid.NewGuid().ToString() };
        var a = new Display { EventId = evt.Id, Name = "Patio", DeviceTokenHash = "unchanged-token", Status = DisplayStatus.Online };
        var b = new Display { EventId = evt.Id, Name = "Barra", DeviceTokenHash = "second-token", Status = DisplayStatus.Online };
        var media = new MediaAsset { EventId = evt.Id, Name = "Ambientación", Type = MediaType.Video };
        var group = new DisplayGroup { EventId = evt.Id, Name = "Patio" };
        db.Events.Add(evt); db.Displays.AddRange(a, b); db.MediaAssets.Add(media); db.DisplayGroups.Add(group);
        db.DisplayGroupMembers.Add(new DisplayGroupMember { DisplayGroupId = group.Id, DisplayId = a.Id });
        foreach (var display in new[] { a, b }) db.DisplayPlaybackStates.Add(new() { DisplayId = display.Id, DesiredState = "Playing", ContentType = "Media", MediaAssetId = media.Id,
            StartedAt = DateTimeOffset.UtcNow.AddSeconds(-5), PayloadJson = JsonSerializer.Serialize(new { mediaId = media.Id, mediaType = "Video" }) });
        await db.SaveChangesAsync(); return (evt.Id, a.Id, b.Id, group.Id, media.Id);
    }

    private sealed class Factory : WebApplicationFactory<PlayerHub>
    {
        private readonly string database = Guid.NewGuid().ToString();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["Database:ApplyMigrationsOnStartup"] = "false" }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<RevelMoviesDbContext>>(); services.RemoveAll<IDbContextOptionsConfiguration<RevelMoviesDbContext>>();
                services.AddDbContext<RevelMoviesDbContext>(options => options.UseInMemoryDatabase(database));
            });
        }
    }
}
