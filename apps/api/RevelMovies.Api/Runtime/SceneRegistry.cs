using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Displays;
using RevelMovies.Domain.Playback;
using RevelMovies.Domain.Scenes;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class SceneValidationException(string message) : Exception(message);

public sealed class SceneRegistry(RevelMoviesDbContext db, PlaybackStateRegistry playback, PlayerCommandDispatcher dispatcher,
    MediaMaintenanceGate maintenance)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record ResolvedTarget(Guid DisplayId, string Name, SceneAssignment Assignment, JsonElement? MediaPayload,
        SceneResource[] Resources, bool NetworkRequired);
    private static T Read<T>(string json) => JsonSerializer.Deserialize<T>(json, Json)!;
    private static string Write<T>(T value) => JsonSerializer.Serialize(value, Json);
    public static SceneResponse View(Scene scene) => new(scene.Id, scene.EventId, scene.Name, scene.Version,
        Read<SceneAssignment[]>(scene.AssignmentsJson), scene.TemporaryDurationSeconds, scene.CreatedAt, scene.UpdatedAt);
    private async Task<Scene> Find(Guid eventId, Guid sceneId, CancellationToken ct) =>
        await db.Scenes.FirstOrDefaultAsync(x => x.Id == sceneId && x.EventId == eventId, ct)
        ?? throw new SceneValidationException("La escena no pertenece al evento.");
    public async Task<SceneResponse[]> List(Guid eventId, CancellationToken ct) =>
        (await db.Scenes.AsNoTracking().Where(x => x.EventId == eventId).OrderBy(x => x.Name).ToListAsync(ct)).Select(View).ToArray();

    public async Task<SceneResponse> Save(Guid eventId, Guid? id, SaveSceneRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 200)
            throw new SceneValidationException("El nombre debe tener entre 1 y 200 caracteres.");
        if (request.Assignments is null || request.Assignments.Length > 100 || request.Assignments.Any(x => x is null))
            throw new SceneValidationException("La escena admite hasta 100 asignaciones.");
        if (request.TemporaryDurationSeconds is < 1 or > 604800)
            throw new SceneValidationException("La duración temporal debe ser de 1 segundo a 7 días.");
        if (!await db.Events.AnyAsync(x => x.Id == eventId, ct)) throw new SceneValidationException("El evento no existe.");
        await Resolve(eventId, request.Assignments, ct);
        var scene = id.HasValue ? await Find(eventId, id.Value, ct) : new Scene { EventId = eventId };
        if (id.HasValue && request.Version != scene.Version)
            throw new SceneValidationException("La escena cambió. Recargá antes de guardar para no sobrescribir otra edición.");
        if (id.HasValue) scene.Version++;
        else db.Scenes.Add(scene);
        scene.Name = request.Name.Trim();
        scene.AssignmentsJson = Write(request.Assignments);
        scene.TemporaryDurationSeconds = request.TemporaryDurationSeconds;
        scene.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return View(scene);
    }

    public async Task Delete(Guid eventId, Guid sceneId, CancellationToken ct)
    {
        db.Scenes.Remove(await Find(eventId, sceneId, ct));
        await db.SaveChangesAsync(ct);
    }

    public async Task<SceneResponse> Duplicate(Guid eventId, Guid sceneId, CancellationToken ct)
    {
        var scene = await Find(eventId, sceneId, ct);
        return await Save(eventId, null, new SaveSceneRequest((scene.Name.Length > 190 ? scene.Name[..190] : scene.Name) + " (copia)",
            Read<SceneAssignment[]>(scene.AssignmentsJson), scene.TemporaryDurationSeconds), ct);
    }

    public async Task<SceneResponse> Snapshot(Guid eventId, SnapshotSceneRequest request, CancellationToken ct)
    {
        if (request.DisplayIds is not { Length: > 0 }) throw new SceneValidationException("Elegí las pantallas que querés guardar.");
        var assignments = new List<SceneAssignment>();
        foreach (var id in request.DisplayIds.Distinct())
        {
            if (!await db.Displays.AnyAsync(x => x.Id == id && x.EventId == eventId, ct)) throw new SceneValidationException("Una pantalla no pertenece al evento.");
            var state = await playback.GetAsync(id, ct);
            var recovery = await playback.GetRecoveryAsync(id, ct);
            assignments.Add(new([id], [], state?.ContentType is "Media" or "Playlist"
                ? new("replace", state.ContentType.ToLowerInvariant(), state.MediaAssetId, state.PlaylistId, PlaybackStateRegistry.ReadLoop(state), state.DesiredState, recovery?.ResumePositionSeconds, recovery?.ResumePlaylistIndex)
                : new("remove"), new(state?.WebPageJson is null ? "remove" : "replace", PlaybackStateRegistry.ReadWebPage(state)),
                SnapshotAnnouncement(state),
                state?.Blackout == true ? "on" : "off", "keep"));
        }
        return await Save(eventId, null, new(request.Name, assignments.ToArray()), ct);
    }

    private static SceneLayer SnapshotAnnouncement(DisplayPlaybackState? state)
    {
        var announcement = PlaybackStateRegistry.ReadAnnouncement(state);
        if (announcement is null) return new("remove");
        var payload = JsonNode.Parse(announcement.Value.GetRawText())!.AsObject();
        if (payload["kind"]?.GetValue<string>() == "countdown" &&
            DateTimeOffset.TryParse(payload["endsAt"]?.GetValue<string>(), out var deadline) && deadline <= DateTimeOffset.UtcNow)
        {
            payload["kind"] = "message";
            payload["text"] = payload["completedText"]?.GetValue<string>() ?? "Finalizó";
            payload.Remove("endsAt"); payload.Remove("completedText"); payload.Remove("durationSeconds");
        }
        return new("replace", JsonSerializer.SerializeToElement(payload, Json));
    }

    private async Task<ResolvedTarget[]> Resolve(Guid eventId, SceneAssignment[] assignments, CancellationToken ct)
    {
        var resolved = new Dictionary<Guid, ResolvedTarget>();
        foreach (var assignment in assignments)
        {
            if (assignment.DisplayIds is null || assignment.GroupIds is null || assignment.Media is null || assignment.WebPage is null || assignment.Announcement is null)
                throw new SceneValidationException("Cada asignación debe declarar destinos y todas sus capas.");
            if (new[] { assignment.Media.Action, assignment.WebPage.Action, assignment.Announcement.Action }.Any(x => x is not ("keep" or "replace" or "remove")) ||
                assignment.Blackout is not ("keep" or "on" or "off") || assignment.Promotions is not ("keep" or "suspend"))
                throw new SceneValidationException("Elegí mantener, reemplazar o retirar cada capa; cortes: mantener o suspender.");
            var ids = assignment.DisplayIds.ToHashSet();
            foreach (var groupId in assignment.GroupIds.Distinct())
            {
                if (!await db.DisplayGroups.AnyAsync(x => x.Id == groupId && x.EventId == eventId, ct)) throw new SceneValidationException("Un grupo no pertenece al evento.");
                ids.UnionWith(await db.DisplayGroupMembers.Where(x => x.DisplayGroupId == groupId).Select(x => x.DisplayId).ToArrayAsync(ct));
            }
            if (assignment.DisplayIds.Length + assignment.GroupIds.Length == 0) throw new SceneValidationException("Elegí un destino para cada asignación.");
            if (assignment.WebPage.Action == "replace" && WebPageCommand.Validate(assignment.WebPage.Payload, out _) is { } webError)
                throw new SceneValidationException(webError);
            if (assignment.Announcement.Action == "replace" && AnnouncementCommand.Validate(assignment.Announcement.Payload, DateTimeOffset.UtcNow, out _) is { } announcementError)
                throw new SceneValidationException(announcementError);
            if (assignment.Media.State is not (null or "Playing" or "Paused" or "Stopped") ||
                (assignment.Media.ResumePositionSeconds is { } position && (!double.IsFinite(position) || position < 0)) ||
                assignment.Media.ResumePlaylistIndex < 0)
                throw new SceneValidationException("El punto de reanudación no es válido.");
            JsonElement? mediaPayload = null;
            var resources = new List<SceneResource>();
            if (assignment.Media.Action == "replace")
            {
                if (assignment.Media.Type == "media")
                {
                    var media = await db.MediaAssets.AsNoTracking().FirstOrDefaultAsync(x => x.Id == assignment.Media.MediaId && x.EventId == eventId, ct)
                        ?? throw new SceneValidationException("El archivo no pertenece al evento o fue eliminado.");
                    resources.Add(new(media.Id, media.Type.ToString(), media.FileSize));
                    mediaPayload = JsonSerializer.SerializeToElement(new { mediaId = media.Id, mediaType = media.Type.ToString(), fileSize = media.FileSize, checksum = media.Checksum, loop = assignment.Media.Loop ?? false }, Json);
                }
                else if (assignment.Media.Type == "playlist")
                {
                    var playlist = await db.Playlists.AsNoTracking().FirstOrDefaultAsync(x => x.Id == assignment.Media.PlaylistId && x.EventId == eventId, ct)
                        ?? throw new SceneValidationException("La playlist no pertenece al evento o fue eliminada.");
                    var items = await (from item in db.PlaylistItems join media in db.MediaAssets on item.MediaAssetId equals media.Id
                        where item.PlaylistId == playlist.Id orderby item.Position
                        select new { mediaId = media.Id, mediaType = media.Type.ToString(), fileSize = media.FileSize, checksum = media.Checksum, durationSeconds = item.DurationSeconds }).ToArrayAsync(ct);
                    if (items.Length == 0) throw new SceneValidationException("La playlist está vacía.");
                    resources.AddRange(items.Select(x => new SceneResource(x.mediaId, x.mediaType, x.fileSize)));
                    mediaPayload = JsonSerializer.SerializeToElement(new { playlistId = playlist.Id, playlistUpdatedAt = playlist.UpdatedAt, loop = assignment.Media.Loop ?? playlist.IsLoop, items }, Json);
                }
                else throw new SceneValidationException("Elegí un archivo o una playlist para reemplazar el fondo.");
            }
            foreach (var id in ids.Order())
            {
                var display = await db.Displays.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.EventId == eventId, ct)
                    ?? throw new SceneValidationException("Una pantalla no pertenece al evento o fue desvinculada.");
                var normalized = assignment with { DisplayIds = [], GroupIds = [] };
                var target = new ResolvedTarget(id, display.Name, normalized, mediaPayload, resources.DistinctBy(x => x.MediaId).ToArray(), assignment.WebPage.Action == "replace");
                if (resolved.TryGetValue(id, out var prior) && Write(prior.Assignment) != Write(normalized))
                    throw new SceneValidationException($"{display.Name} recibe asignaciones incompatibles por destinos superpuestos.");
                resolved[id] = target;
            }
        }
        return resolved.Values.OrderBy(x => x.DisplayId).ToArray();
    }

    private static string Fingerprint(ResolvedTarget[] targets) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        Write(targets.Select(x => new { x.DisplayId, x.Assignment, x.MediaPayload, x.Resources })))));
    private static ResolvedTarget[] SelectTargets(ResolvedTarget[] targets, Guid[]? ids)
    {
        if (ids is not null && (ids.Length == 0 || ids.Except(targets.Select(x => x.DisplayId)).Any()))
            throw new SceneValidationException("Los destinos elegidos no corresponden a esta versión de la escena.");
        var selected = ids is null ? targets : targets.Where(x => ids.Contains(x.DisplayId)).ToArray();
        if (selected.Length == 0) throw new SceneValidationException("La escena no tiene pantallas. Revisá sus grupos y asignaciones.");
        return selected;
    }

    public async Task<SceneSessionResponse> Prepare(Guid eventId, Guid sceneId, SceneOperationRequest request, CancellationToken ct)
    {
        var scene = await Find(eventId, sceneId, ct);
        if (scene.Version != request.Version) throw new SceneValidationException("La versión cambió. Guardá y prepará la versión actual.");
        var all = await Resolve(eventId, Read<SceneAssignment[]>(scene.AssignmentsJson), ct);
        var selected = SelectTargets(all, request.DisplayIds);
        var session = new SceneSession { EventId = eventId, SceneId = sceneId, Version = scene.Version, Fingerprint = Fingerprint(all) };
        var older = await db.SceneSessions.Where(x => x.SceneId == sceneId && x.Kind == "prepare").ToListAsync(ct);
        foreach (var prior in older)
        {
            var priorTargets = Read<SceneTargetResult[]>(prior.TargetsJson);
            foreach (var item in priorTargets.Where(x => selected.Any(y => y.DisplayId == x.DisplayId)))
            { item.Status = "superseded"; item.Detail = "Hay un intento de preparación más reciente."; }
            prior.TargetsJson = Write(priorTargets);
        }
        var results = new List<SceneTargetResult>();
        var commands = new List<(Guid Id, RevelMovies.Application.Commands.PlayerCommand Command)>();
        foreach (var target in selected)
        {
            var command = dispatcher.Create("scene.prepare", JsonSerializer.SerializeToElement(new { sceneId, version = scene.Version,
                sessionId = session.Id, resources = target.Resources, networkRequired = target.NetworkRequired }, Json));
            var display = await db.Displays.AsNoTracking().SingleAsync(x => x.Id == target.DisplayId, ct);
            results.Add(new() { DisplayId = target.DisplayId, DisplayName = target.Name, CommandId = command.CommandId,
                Status = display.Status == DisplayStatus.Online ? "pending" : "offline", AppliedRevision = (await playback.GetAsync(target.DisplayId, ct))?.Revision ?? 0 });
            if (display.Status == DisplayStatus.Online) commands.Add((target.DisplayId, command));
        }
        session.TargetsJson = Write(results);
        db.SceneSessions.Add(session);
        await db.SaveChangesAsync(ct);
        await Dispatch(session, results, commands, ct);
        return await Session(session.Id, ct);
    }

    public async Task<SceneSessionResponse> Activate(Guid eventId, Guid sceneId, SceneOperationRequest request, CancellationToken ct)
    {
        await Expire(ct);
        var scene = await Find(eventId, sceneId, ct);
        if (scene.Version != request.Version) throw new SceneValidationException("La versión cambió. Prepará la versión actual.");
        if (request.Policy is not ("all" or "available")) throw new SceneValidationException("Elegí esperar todas o activar sólo disponibles.");
        var all = await Resolve(eventId, Read<SceneAssignment[]>(scene.AssignmentsJson), ct);
        var selected = SelectTargets(all, request.DisplayIds);
        var preparation = await db.SceneSessions.FirstOrDefaultAsync(x => x.Id == request.PreparationId && x.SceneId == sceneId && x.Kind == "prepare", ct)
            ?? throw new SceneValidationException("Prepará esta versión antes de activarla.");
        var prepared = await Session(preparation.Id, ct);
        if (preparation.Version != scene.Version || preparation.Fingerprint != Fingerprint(all))
            throw new SceneValidationException("Cambió el contenido o los destinos. Volvé a preparar.");
        var ready = prepared.Targets.Where(x => x.Status is "ready" or "network").Select(x => x.DisplayId).ToHashSet();
        if (request.Policy == "all" && selected.Any(x => !ready.Contains(x.DisplayId)))
            throw new SceneValidationException("Faltan pantallas listas. Esperá, reintentá o elegí activar sólo disponibles.");
        if (!selected.Any(x => ready.Contains(x.DisplayId))) throw new SceneValidationException("No hay pantallas listas para activar.");
        await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(ct) : null;
        var now = DateTimeOffset.UtcNow;
        var startAt = now.AddSeconds(1);
        foreach (var target in selected.Where(x => x.Assignment.Announcement.Action == "replace"))
            if (AnnouncementCommand.Validate(target.Assignment.Announcement.Payload, startAt, out _) is { } deadlineError)
                throw new SceneValidationException(deadlineError);
        var session = new SceneSession { EventId = eventId, SceneId = sceneId, Version = scene.Version, Kind = "activate", Status = "activating",
            Fingerprint = preparation.Fingerprint, ExpiresAt = scene.TemporaryDurationSeconds is { } seconds ? startAt.AddSeconds(seconds) : null };
        var results = new List<SceneTargetResult>();
        var commands = new List<(Guid Id, RevelMovies.Application.Commands.PlayerCommand Command)>();
        foreach (var target in selected)
        {
            var result = new SceneTargetResult { DisplayId = target.DisplayId, DisplayName = target.Name };
            results.Add(result);
            if (!ready.Contains(target.DisplayId)) { result.Status = "skipped"; result.Detail = "No estaba lista; no se envió la activación."; continue; }
            result.Previous = await playback.GetRecoveryAsync(target.DisplayId, ct) ?? EmptyRecovery;
            // A permanent previous scene needs only its current configuration for return.
            // Its own history remains in its session; nesting it into every next scene grows without bound.
            if (result.Previous.SceneExpiresAt is null)
                result.Previous = result.Previous with { ScenePrevious = null, SceneComposition = null };
            var state = await State(target.DisplayId, ct);
            var command = dispatcher.Create("scene.apply");
            result.CommandId = command.CommandId;
            var assignment = target.Assignment;
            result.Composition = new(assignment.Media.Action, assignment.WebPage.Action, assignment.Announcement.Action, assignment.Blackout, assignment.Promotions);
            if (assignment.Media.Action == "remove") { state.DesiredState = "Stopped"; state.ContentType = null; state.PayloadJson = null; state.MediaAssetId = null; state.PlaylistId = null; state.StartedAt = null; state.PromotionProgressJson = null; }
            if (assignment.Media.Action == "replace")
            {
                var payload = JsonNode.Parse(target.MediaPayload!.Value.GetRawText())!.AsObject();
                payload["startAt"] = startAt.ToString("O");
                if (assignment.Media.Type == "playlist") payload["playbackId"] = Guid.NewGuid().ToString();
                state.PayloadJson = payload.ToJsonString(); state.ContentType = assignment.Media.Type == "media" ? "Media" : "Playlist";
                state.MediaAssetId = assignment.Media.MediaId; state.PlaylistId = assignment.Media.PlaylistId;
                var position = assignment.Media.ResumePositionSeconds ?? 0;
                payload["resumePositionSeconds"] = position;
                payload["resumePlaylistIndex"] = assignment.Media.ResumePlaylistIndex ?? 0;
                state.PayloadJson = payload.ToJsonString();
                state.DesiredState = assignment.Media.State ?? "Playing";
                state.StartedAt = state.DesiredState == "Playing" ? startAt.AddSeconds(-position) : null;
                state.PausedPositionSeconds = state.DesiredState == "Paused" ? position : null;
                state.PromotionProgressJson = null; state.Health = "Starting"; state.ActualDurationSeconds = null;
            }
            if (assignment.WebPage.Action != "keep") state.WebPageJson = assignment.WebPage.Action == "remove" ? null : assignment.WebPage.Payload?.GetRawText();
            if (assignment.Announcement.Action == "remove") state.AnnouncementJson = null;
            if (assignment.Announcement.Action == "replace")
            {
                if (AnnouncementCommand.Validate(assignment.Announcement.Payload, startAt, out var announcement) is { } error) throw new SceneValidationException(error);
                state.AnnouncementJson = announcement.GetRawText();
            }
            if (assignment.Blackout != "keep") state.Blackout = assignment.Blackout == "on";
            if (assignment.Promotions == "suspend") state.PromotionPolicyJson = Write(new PromotionPolicy(Guid.NewGuid(), false, null, "", 5, []));
            PlaybackStateRegistry.MarkMutation(state, command.CommandId);
            state.SceneSessionId = session.Id; state.SceneExpiresAt = session.ExpiresAt; state.UpdatedAt = now;
            result.AppliedRevision = state.Revision;
            await db.SaveChangesAsync(ct);
            var recovery = (await playback.GetRecoveryAsync(target.DisplayId, ct))! with { ScenePrevious = result.Previous, SceneComposition = result.Composition };
            command = command with { Payload = JsonSerializer.SerializeToElement(new { sceneId, version = scene.Version, sessionId = session.Id,
                startAt, expiresAt = session.ExpiresAt, recovery, composition = result.Composition }, Json) };
            commands.Add((target.DisplayId, command));
        }
        session.TargetsJson = Write(results); db.SceneSessions.Add(session); await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        await Dispatch(session, results, commands, ct);
        return await Session(session.Id, ct);
    }

    private static readonly PlaybackRecoveryState EmptyRecovery = new("Stopped", null, null, null, null, "Stopped", null, DateTimeOffset.UtcNow, null);
    private async Task<DisplayPlaybackState> State(Guid id, CancellationToken ct)
    {
        var state = await db.DisplayPlaybackStates.FirstOrDefaultAsync(x => x.DisplayId == id, ct);
        if (state is not null) return state;
        state = new() { DisplayId = id }; db.DisplayPlaybackStates.Add(state); return state;
    }

    public async Task<SceneSessionResponse[]> Sessions(Guid eventId, CancellationToken ct)
    {
        await Expire(ct);
        var ids = await db.SceneSessions.AsNoTracking().Where(x => x.EventId == eventId).OrderByDescending(x => x.CreatedAt).Select(x => x.Id).Take(50).ToArrayAsync(ct);
        var results = new List<SceneSessionResponse>();
        foreach (var id in ids) results.Add(await Session(id, ct));
        return results.ToArray();
    }

    public async Task<SceneSessionResponse> Session(Guid id, CancellationToken ct, int retries = 1)
    {
        var session = await db.SceneSessions.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new SceneValidationException("El intento no existe.");
        var targets = Read<SceneTargetResult[]>(session.TargetsJson);
        var now = DateTimeOffset.UtcNow;
        if (session.Kind == "prepare")
        {
            var scene = await db.Scenes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == session.SceneId && x.EventId == session.EventId, ct);
            var current = false;
            try
            {
                current = scene?.Version == session.Version && Fingerprint(await Resolve(session.EventId, Read<SceneAssignment[]>(scene.AssignmentsJson), ct)) == session.Fingerprint;
            }
            catch (SceneValidationException) { /* Deleted resources or expired fixed deadlines require preparation again. */ }
            if (!current)
                foreach (var target in targets) { target.Status = "superseded"; target.Detail = "Cambió la escena, su contenido o sus destinos. Volvé a preparar."; }
        }
        foreach (var target in targets)
        {
            if (target.Status is "restored" or "superseded" or "skipped") continue;
            var display = await db.Displays.AsNoTracking().FirstOrDefaultAsync(x => x.Id == target.DisplayId, ct);
            var state = await playback.GetAsync(target.DisplayId, ct);
            if (session.Kind == "prepare" && (state?.Revision ?? 0) != target.AppliedRevision)
            { target.Status = "superseded"; target.Detail = "Hubo una acción más reciente en la pantalla. Volvé a preparar."; continue; }
            if (session.Kind == "activate" && state?.LastCommandId != target.CommandId) { target.Status = "superseded"; continue; }
            if (session.Kind == "activate" && state?.ActualCommandId == target.CommandId && state.ActualState == "Error")
            { target.Status = "error"; target.Detail = "El reproductor informó un error al mostrar el contenido."; target.ReportedAt = state.ActualReportedAt; continue; }
            if (session.Kind == "activate" && state?.ActualCommandId == target.CommandId && state.ActualState is not ("Buffering" or "Loading" or "Error"))
            { target.Status = target.Restoring ? "restored" : "applied"; target.ReportedAt = state.ActualReportedAt; continue; }
            var ack = await db.CommandAcknowledgements.AsNoTracking().Where(x => x.DisplayId == target.DisplayId && x.CommandId == target.CommandId)
                .OrderByDescending(x => x.ServerReceivedAt).FirstOrDefaultAsync(ct);
            if (ack is not null)
            {
                target.ReportedAt = ack.ServerReceivedAt; target.Detail = ack.Detail;
                if (session.Kind == "prepare" && ack.Status is "ready" or "network" or "partial" or "error") target.Status = ack.Status;
                else if (ack.Status == "error") target.Status = "error";
            }
            if (session.Kind == "prepare" && display?.Status != DisplayStatus.Online) target.Status = "offline";
            if (target.Status is "pending" or "restoring" && now - (target.Restoring ? session.RestoredAt ?? now : session.CreatedAt) > TimeSpan.FromSeconds(45)) target.Status = "timeout";
            // Preparation is a short-lived capability, never a permanent offline promise.
            if (session.Kind == "prepare" && now - session.CreatedAt > TimeSpan.FromMinutes(15)) { target.Status = "timeout"; target.Detail = "La verificación venció. Volvé a preparar."; }
        }
        session.Status = session.Kind == "prepare"
            ? targets.All(x => x.Status == "ready") ? "ready" : targets.All(x => x.Status is "ready" or "network") ? "network" : targets.Any(x => x.Status == "pending") ? "preparing" : "attention"
            : targets.All(x => x.Status == "restored") ? "restored" : targets.Any(x => x.Status == "restoring") ? "restoring" : targets.All(x => x.Status == "applied") ? "active" : targets.Any(x => x.Status == "pending") ? "activating" : "partial";
        session.TargetsJson = Write(targets);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) when (retries > 0)
        {
            await db.Entry(session).ReloadAsync(ct);
            return await Session(id, ct, retries - 1);
        }
        return new(session.Id, session.SceneId, session.Version, session.Kind, session.Status,
            targets.Select(x => new SceneTargetResponse(x.DisplayId, x.DisplayName, x.CommandId, x.Status, x.Detail, x.ReportedAt, x.AppliedRevision)).ToArray(), session.CreatedAt, session.ExpiresAt);
    }

    public async Task<SceneSessionResponse> Restore(Guid id, CancellationToken ct)
    {
        var session = await db.SceneSessions.FirstOrDefaultAsync(x => x.Id == id && x.Kind == "activate", ct)
            ?? throw new SceneValidationException("La activación no existe.");
        await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(ct) : null;
        var targets = Read<SceneTargetResult[]>(session.TargetsJson);
        var commands = new List<(Guid Id, RevelMovies.Application.Commands.PlayerCommand Command)>();
        foreach (var target in targets)
        {
            if (target.Restoring || target.Previous is null || target.Composition is null || target.Status is "restored" or "skipped" or "superseded") continue;
            var state = await db.DisplayPlaybackStates.FirstOrDefaultAsync(x => x.DisplayId == target.DisplayId, ct);
            if (state?.SceneSessionId != session.Id || state.Revision != target.AppliedRevision) { target.Status = "superseded"; continue; }
            var previous = target.Previous;
            var composition = target.Composition;
            // A later scene may cover a temporary scene. Never revive an expired moment when returning.
            var visited = new HashSet<Guid>();
            while (previous.SceneSessionId is { } previousId && previous.SceneExpiresAt <= DateTimeOffset.UtcNow && visited.Add(previousId))
            {
                var previousSession = await db.SceneSessions.FirstOrDefaultAsync(x => x.Id == previousId, ct);
                var previousTarget = previousSession is null ? null : Read<SceneTargetResult[]>(previousSession.TargetsJson).FirstOrDefault(x => x.DisplayId == target.DisplayId);
                if (previousTarget?.Previous is null || previousTarget.Composition is null) { previous = EmptyRecovery; break; }
                var priorComposition = previousTarget.Composition;
                composition = new(composition.Media != "keep" ? composition.Media : priorComposition.Media,
                    composition.WebPage != "keep" ? composition.WebPage : priorComposition.WebPage,
                    composition.Announcement != "keep" ? composition.Announcement : priorComposition.Announcement,
                    composition.Blackout != "keep" ? composition.Blackout : priorComposition.Blackout,
                    composition.Promotions != "keep" ? composition.Promotions : priorComposition.Promotions);
                previous = previousTarget.Previous;
            }
            if (composition.Media != "keep")
            {
                state.DesiredState = previous.DesiredState; state.ContentType = previous.ContentType;
                state.PayloadJson = previous.Payload?.GetRawText();
                state.MediaAssetId = previous.Payload?.TryGetProperty("mediaId", out var mediaId) == true ? mediaId.GetGuid() : null;
                state.PlaylistId = previous.Payload?.TryGetProperty("playlistId", out var playlistId) == true ? playlistId.GetGuid() : null;
                state.StartedAt = previous.DesiredState == "Playing" ? DateTimeOffset.UtcNow.AddSeconds(-(previous.ResumePositionSeconds ?? 0)) : null;
                state.PausedPositionSeconds = previous.ResumePositionSeconds;
                state.ActualPositionSeconds = previous.ResumePositionSeconds; state.ActualPlaylistIndex = previous.ResumePlaylistIndex;
                state.PromotionProgressJson = previous.PromotionProgress is null ? null : Write(previous.PromotionProgress);
                state.Health = "Restoring";
                if (state.PayloadJson is not null)
                {
                    var payload = JsonNode.Parse(state.PayloadJson)!.AsObject();
                    payload.Remove("startAt"); payload["resumePlaylistIndex"] = previous.ResumePlaylistIndex ?? 0;
                    payload["resumePositionSeconds"] = previous.ResumePositionSeconds ?? 0;
                    state.PayloadJson = payload.ToJsonString();
                }
            }
            if (composition.WebPage != "keep") state.WebPageJson = previous.WebPage?.GetRawText();
            if (composition.Announcement != "keep") state.AnnouncementJson = previous.Announcement?.GetRawText();
            if (composition.Blackout != "keep") state.Blackout = previous.Blackout;
            if (composition.Promotions != "keep") state.PromotionPolicyJson = previous.PromotionPolicy is null ? null : Write(previous.PromotionPolicy);
            var command = dispatcher.Create("scene.restore");
            PlaybackStateRegistry.MarkMutation(state, command.CommandId);
            if (previous.SceneSessionId is { } resumedId && previous.SceneExpiresAt > DateTimeOffset.UtcNow)
            {
                var resumed = await db.SceneSessions.FirstOrDefaultAsync(x => x.Id == resumedId, ct);
                if (resumed is not null)
                {
                    var resumedTargets = Read<SceneTargetResult[]>(resumed.TargetsJson);
                    var resumedTarget = resumedTargets.FirstOrDefault(x => x.DisplayId == target.DisplayId);
                    if (resumedTarget is not null)
                    {
                        state.SceneSessionId = resumedId; state.SceneExpiresAt = previous.SceneExpiresAt;
                        resumedTarget.CommandId = command.CommandId; resumedTarget.AppliedRevision = state.Revision;
                        resumedTarget.Status = "pending"; resumedTarget.Restoring = false;
                        resumed.TargetsJson = Write(resumedTargets); resumed.RestoredAt = null;
                    }
                }
            }
            state.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            var recovery = await playback.GetRecoveryAsync(target.DisplayId, ct);
            commands.Add((target.DisplayId, command with { Payload = JsonSerializer.SerializeToElement(new { sessionId = session.Id, recovery, composition }, Json) }));
            target.CommandId = command.CommandId; target.AppliedRevision = state.Revision;
            target.Restoring = true; target.Status = "restoring"; target.ReportedAt = null;
        }
        session.RestoredAt = DateTimeOffset.UtcNow; session.TargetsJson = Write(targets); await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        await Dispatch(session, targets, commands, ct);
        return await Session(id, ct);
    }

    private async Task Dispatch(SceneSession session, IReadOnlyCollection<SceneTargetResult> targets,
        IReadOnlyCollection<(Guid Id, RevelMovies.Application.Commands.PlayerCommand Command)> commands, CancellationToken ct)
    {
        var failed = false;
        foreach (var pair in commands)
        {
            try { await dispatcher.SendRawAsync([pair.Id], pair.Command, ct); }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                var target = targets.Single(x => x.DisplayId == pair.Id);
                target.Status = "error"; target.Detail = "No se pudo enviar a esta pantalla. Reintentá o esperá su reconexión.";
                failed = true;
            }
        }
        if (failed) { session.TargetsJson = Write(targets); await db.SaveChangesAsync(ct); }
    }

    public async Task Expire(CancellationToken ct)
    {
        using var activity = maintenance.TryEnter();
        if (activity is null) return;
        var now = DateTimeOffset.UtcNow;
        var expired = await db.SceneSessions.Where(x => x.Kind == "activate" && x.ExpiresAt <= now && x.RestoredAt == null).Select(x => x.Id).ToArrayAsync(ct);
        foreach (var id in expired) await Restore(id, ct);
    }

    public async Task InvalidatePreparation(Guid displayId, CancellationToken ct)
    {
        var cutoff = DateTimeOffset.UtcNow.AddMinutes(-15);
        var sessions = await db.SceneSessions.Where(x => x.Kind == "prepare" && x.CreatedAt > cutoff).ToListAsync(ct);
        foreach (var session in sessions)
        {
            var targets = Read<SceneTargetResult[]>(session.TargetsJson);
            var target = targets.FirstOrDefault(x => x.DisplayId == displayId);
            if (target is null) continue;
            target.Status = "superseded"; target.Detail = "La pantalla se reconectó. Volvé a verificar los recursos.";
            session.TargetsJson = Write(targets);
        }
        await db.SaveChangesAsync(ct);
    }
}

public sealed class SceneExpiryService(IServiceScopeFactory scopes, ILogger<SceneExpiryService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { using var scope = scopes.CreateScope(); await scope.ServiceProvider.GetRequiredService<SceneRegistry>().Expire(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { logger.LogWarning(exception, "Could not restore expired scenes; retrying"); }
        }
    }
}
