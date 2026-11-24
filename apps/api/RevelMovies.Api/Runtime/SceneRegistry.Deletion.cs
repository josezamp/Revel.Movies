using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RevelMovies.Application.Commands;

namespace RevelMovies.Api.Runtime;

public sealed partial class SceneRegistry
{
    private static readonly SceneComposition ClearComposition = new("remove", "remove", "remove", "off", "suspend");
    private static readonly SceneComposition KeepComposition = new("keep", "keep", "keep", "keep", "keep");

    private async Task ClearDeletedScenes(Guid eventId, Guid[] sceneIds, CancellationToken ct)
    {
        await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(ct) : null;
        var now = DateTimeOffset.UtcNow;
        var sessions = await db.SceneSessions.Where(x => x.EventId == eventId).ToArrayAsync(ct);
        var deletedIds = sessions.Where(x => sceneIds.Contains(x.SceneId)).Select(x => x.Id).ToHashSet();
        var states = await db.DisplayPlaybackStates.Where(x => x.SceneSessionId != null &&
            db.Displays.Any(display => display.Id == x.DisplayId && display.EventId == eventId)).ToArrayAsync(ct);
        var notifications = new List<(RevelMovies.Domain.Scenes.SceneSession Session, SceneTargetResult[] Targets,
            List<(Guid Id, PlayerCommand Command)> Commands)>();

        foreach (var session in sessions)
        {
            var deleted = deletedIds.Contains(session.Id);
            var targets = Read<SceneTargetResult[]>(session.TargetsJson);
            var commands = new List<(Guid Id, PlayerCommand Command)>();
            foreach (var target in targets)
            {
                var previous = target.Previous;
                target.Previous = deleted ? null : RemoveDeletedSnapshots(previous, deletedIds);
                var changedReturn = previous != target.Previous;
                if (changedReturn && !deleted) target.Composition = ClearComposition;
                if (deleted)
                {
                    target.Status = "superseded";
                    target.Detail = "La escena fue eliminada.";
                }
                var state = states.FirstOrDefault(x => x.DisplayId == target.DisplayId && x.SceneSessionId == session.Id);
                if (state is null || (!deleted && !changedReturn)) continue;

                var command = dispatcher.Create("scene.restore");
                var expiresAt = state.SceneExpiresAt;
                if (deleted)
                {
                    PlaybackStateRegistry.ClearMediaAssignment(state);
                    state.AnnouncementJson = null;
                    state.WebPageJson = null;
                    state.PromotionPolicyJson = null;
                    state.Blackout = false;
                }
                PlaybackStateRegistry.MarkMutation(state, command.CommandId);
                if (!deleted)
                {
                    // Keep the newer scene on air, but replace its saved return on connected players too.
                    state.SceneSessionId = session.Id;
                    state.SceneExpiresAt = expiresAt;
                }
                state.UpdatedAt = now;
                target.CommandId = command.CommandId;
                target.AppliedRevision = state.Revision;
                commands.Add((target.DisplayId, command));
            }
            if (deleted) session.RestoredAt = now;
            session.TargetsJson = Write(targets);
            if (commands.Count > 0) notifications.Add((session, targets, commands));
        }

        var schedules = await db.SceneSchedules.Where(x => x.EventId == eventId && sceneIds.Contains(x.SceneId) &&
            (x.Status == "scheduled" || x.Status == "preparing" || x.Status == "activating")).ToArrayAsync(ct);
        foreach (var schedule in schedules)
        {
            schedule.Status = "cancelled";
            schedule.Detail = "Cancelada al eliminar la escena.";
            schedule.CompletedAt = now;
            schedule.Version++;
            var targets = Read<ScheduleTarget[]>(schedule.TargetsJson);
            foreach (var target in targets.Where(x => x.Status == "pending"))
            { target.Status = "cancelled"; target.Detail = schedule.Detail; }
            schedule.TargetsJson = Write(targets);
        }
        // Commit the deletion, cleared playback and invalidated returns together before notifying TVs.
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        foreach (var notification in notifications)
        {
            var commands = new List<(Guid Id, PlayerCommand Command)>();
            foreach (var (displayId, command) in notification.Commands)
            {
                var recovery = await playback.GetRecoveryAsync(displayId, ct);
                var composition = deletedIds.Contains(notification.Session.Id) ? ClearComposition : KeepComposition;
                commands.Add((displayId, command with { Payload = JsonSerializer.SerializeToElement(new
                    { sessionId = notification.Session.Id, recovery, composition }, Json) }));
            }
            await Dispatch(notification.Session, notification.Targets, commands, ct);
        }
    }

    private static PlaybackRecoveryState? RemoveDeletedSnapshots(PlaybackRecoveryState? recovery, HashSet<Guid> deletedIds)
    {
        if (recovery is null) return null;
        if (recovery.SceneSessionId is { } id && deletedIds.Contains(id)) return EmptyRecovery;
        var previous = RemoveDeletedSnapshots(recovery.ScenePrevious, deletedIds);
        return previous == recovery.ScenePrevious ? recovery : recovery with { ScenePrevious = previous, SceneComposition = ClearComposition };
    }
}
