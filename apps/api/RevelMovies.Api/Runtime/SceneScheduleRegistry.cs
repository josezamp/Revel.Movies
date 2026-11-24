using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Scenes;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed record SaveSceneScheduleRequest(Guid SceneId, int SceneVersion, string LocalStartsAt, string TimeZone,
    string Policy = "available", int? Version = null);
public sealed record CancelSceneScheduleRequest(int Version);
public sealed record SceneScheduleReference(Guid Id, int Version);
public sealed record ClearSceneScheduleHistoryRequest(SceneScheduleReference[] Entries);
public sealed record ClearSceneScheduleHistoryResponse(int DeletedCount);
public sealed class ScheduleTarget
{
    public Guid DisplayId { get; set; }
    public string DisplayName { get; set; } = "";
    public string PreparationStatus { get; set; } = "pending";
    public string Status { get; set; } = "pending";
    public string? Detail { get; set; }
    public DateTimeOffset? ReportedAt { get; set; }
}
public sealed record SceneScheduleResponse(Guid Id, Guid EventId, Guid SceneId, string SceneName, int SceneVersion,
    DateTimeOffset StartsAt, string LocalStartsAt, string TimeZone, string Policy, string Status, string? Detail,
    ScheduleTarget[] Targets, DateTimeOffset? CompletedAt, int Version);

// The deployment uses one API process (also required by local media storage). Serialize cancellation,
// editing and timer execution within it. Persisted operation IDs protect activation across process restarts.
public sealed class SceneScheduleGate
{
    public SemaphoreSlim Mutex { get; } = new(1, 1);
}

public sealed class SceneScheduleRegistry(RevelMoviesDbContext db, SceneRegistry scenes, SceneScheduleGate gate,
    MediaMaintenanceGate maintenance, TimeProvider clock, ILogger<SceneScheduleRegistry> logger)
{
    private static readonly string[] Pending = ["scheduled", "preparing"];
    private static readonly string[] Running = ["scheduled", "preparing", "activating"];
    private static readonly string[] History = ["completed", "partial", "failed", "missed", "cancelled"];
    private static ScheduleTarget[] Targets(SceneSchedule item) => JsonSerializer.Deserialize<ScheduleTarget[]>(item.TargetsJson, SceneRegistry.Json)!;
    private static void SetTargets(SceneSchedule item, ScheduleTarget[] targets) => item.TargetsJson = JsonSerializer.Serialize(targets, SceneRegistry.Json);
    private static SceneScheduleResponse View(SceneSchedule item) => new(item.Id, item.EventId, item.SceneId,
        item.SceneName, item.SceneVersion, item.StartsAt, item.LocalStartsAt, item.TimeZone, item.Policy, item.Status,
        item.Detail, Targets(item), item.CompletedAt, item.Version);

    public async Task<SceneScheduleResponse[]> List(Guid eventId, CancellationToken ct) =>
        (await db.SceneSchedules.AsNoTracking().Where(x => x.EventId == eventId).OrderBy(x => x.StartsAt).ToArrayAsync(ct)).Select(View).ToArray();

    public static DateTimeOffset ParseStart(string localStartsAt, string timeZone)
    {
        if (!DateTime.TryParseExact(localStartsAt, ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss"],
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            throw new SceneValidationException("Ingresá una fecha y hora local válidas.");
        if (string.IsNullOrWhiteSpace(timeZone) || timeZone.Length > 100)
            throw new SceneValidationException("Elegí una zona horaria válida.");
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone); }
        catch (Exception error) when (error is TimeZoneNotFoundException or InvalidTimeZoneException)
        { throw new SceneValidationException("La zona horaria no existe en el servidor."); }
        var local = DateTime.SpecifyKind(parsed, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local) || zone.IsAmbiguousTime(local))
            throw new SceneValidationException("Esa hora es inexistente o ambigua por el cambio de horario. Elegí otra hora.");
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, zone));
    }

    public async Task<SceneScheduleResponse> Save(Guid eventId, Guid? id, SaveSceneScheduleRequest request, CancellationToken ct)
    {
        await gate.Mutex.WaitAsync(ct);
        try
        {
            var now = clock.GetUtcNow();
            var start = ParseStart(request.LocalStartsAt, request.TimeZone);
            if (start <= now) throw new SceneValidationException("La fecha y hora deben estar en el futuro.");
            if (request.Policy is not ("all" or "available")) throw new SceneValidationException("Elegí una política de pantallas válida.");
            var plan = await scenes.DescribeSchedule(eventId, request.SceneId, request.SceneVersion, start, ct);
            var item = id is { } key ? await Find(eventId, key, ct) : new SceneSchedule { EventId = eventId };
            if (id.HasValue)
            {
                CheckEditable(item, request.Version, now);
                item.Version++;
            }
            var others = await db.SceneSchedules.AsNoTracking().Where(x => x.EventId == eventId && x.Id != item.Id &&
                x.StartsAt == start && Running.Contains(x.Status)).ToArrayAsync(ct);
            if (others.Any(other => Targets(other).Any(target => plan.Targets.Any(x => x.DisplayId == target.DisplayId))))
                throw new SceneValidationException("Hay otra escena a esa misma hora para alguna de estas pantallas.");
            item.SceneId = plan.Scene.Id; item.SceneName = plan.Scene.Name; item.SceneVersion = plan.Scene.Version;
            item.Fingerprint = plan.Fingerprint; item.StartsAt = start; item.LocalStartsAt = request.LocalStartsAt;
            item.TimeZone = TimeZoneInfo.TryConvertWindowsIdToIanaId(request.TimeZone, out var iana) ? iana : request.TimeZone;
            item.Policy = request.Policy; item.Status = "scheduled"; item.Detail = null;
            item.PreparationId = null; item.LastPreparationAt = null;
            SetTargets(item, plan.Targets.Select(target => new ScheduleTarget { DisplayId = target.DisplayId, DisplayName = target.DisplayName }).ToArray());
            if (!id.HasValue) db.SceneSchedules.Add(item);
            await db.SaveChangesAsync(ct);
            return View(item);
        }
        finally { gate.Mutex.Release(); }
    }

    public async Task<SceneScheduleResponse> Cancel(Guid eventId, Guid id, int version, CancellationToken ct)
    {
        await gate.Mutex.WaitAsync(ct);
        try
        {
            var item = await Find(eventId, id, ct);
            CheckEditable(item, version, clock.GetUtcNow());
            Finish(item, Targets(item), "cancelled", "Cancelada por el operador.");
            item.Version++; await db.SaveChangesAsync(ct);
            return View(item);
        }
        finally { gate.Mutex.Release(); }
    }

    public async Task Delete(Guid eventId, Guid id, int version, string status, CancellationToken ct)
    {
        await gate.Mutex.WaitAsync(ct);
        try
        {
            var item = await Find(eventId, id, ct);
            if (item.Version != version || (item.Status != status && !(Pending.Contains(item.Status) && Pending.Contains(status))))
                throw new SceneValidationException("La programación cambió. Cerrá la confirmación y revisá la entrada antes de eliminarla.");
            if ((!Pending.Contains(item.Status) && !History.Contains(item.Status)) ||
                (Pending.Contains(item.Status) && await db.SceneSessions.AnyAsync(x => x.Id == id && x.Kind == "activate", ct)))
                throw new SceneValidationException("La entrada se está ejecutando. Esperá el resultado antes de eliminarla.");
            await PreserveSupersededTargets(eventId, [item], ct);
            db.SceneSchedules.Remove(item);
            // Playback and temporary return sessions have independent lifetimes.
            await db.SaveChangesAsync(ct);
        }
        finally { gate.Mutex.Release(); }
    }

    public async Task<ClearSceneScheduleHistoryResponse> ClearHistory(Guid eventId, ClearSceneScheduleHistoryRequest request, CancellationToken ct)
    {
        if (request.Entries is not { Length: > 0 } || request.Entries.Any(x => x is null) ||
            request.Entries.Select(x => x.Id).Distinct().Count() != request.Entries.Length)
            throw new SceneValidationException("Elegí las entradas del historial que querés eliminar.");
        await gate.Mutex.WaitAsync(ct);
        try
        {
            var expected = request.Entries.ToDictionary(x => x.Id, x => x.Version);
            var ids = expected.Keys.ToArray();
            var items = await db.SceneSchedules.Where(x => x.EventId == eventId && ids.Contains(x.Id)).ToArrayAsync(ct);
            if (items.Length != ids.Length || items.Any(x => x.Version != expected[x.Id] || !History.Contains(x.Status)))
                throw new SceneValidationException("El historial cambió. Cerrá la confirmación y revisalo antes de limpiarlo.");
            await PreserveSupersededTargets(eventId, items, ct);
            db.SceneSchedules.RemoveRange(items);
            await db.SaveChangesAsync(ct);
            return new(items.Length);
        }
        finally { gate.Mutex.Release(); }
    }

    private async Task PreserveSupersededTargets(Guid eventId, SceneSchedule[] removed, CancellationToken ct)
    {
        // Deleting a newer history row must not allow an older, still-pending occurrence
        // to catch up and replace its content during the scheduler's one-minute grace period.
        var now = clock.GetUtcNow();
        var newer = removed.Where(x => History.Contains(x.Status) && x.Status != "cancelled" && x.StartsAt <= now).ToArray();
        if (newer.Length == 0) return;
        var latest = newer.Max(x => x.StartsAt);
        var older = await db.SceneSchedules.Where(x => x.EventId == eventId && Running.Contains(x.Status) && x.StartsAt < latest).ToArrayAsync(ct);
        foreach (var item in older)
        {
            var superseded = newer.Where(x => x.StartsAt > item.StartsAt).SelectMany(Targets).Select(x => x.DisplayId).ToHashSet();
            var targets = Targets(item);
            foreach (var target in targets.Where(x => x.Status == "pending" && superseded.Contains(x.DisplayId)))
            { target.Status = "superseded"; target.Detail = "Ya corresponde una entrada posterior de la agenda."; }
            SetTargets(item, targets);
        }
    }

    private async Task<SceneSchedule> Find(Guid eventId, Guid id, CancellationToken ct) =>
        await db.SceneSchedules.SingleOrDefaultAsync(x => x.Id == id && x.EventId == eventId, ct)
        ?? throw new SceneValidationException("La programación no pertenece al evento.");
    private static void CheckEditable(SceneSchedule item, int? version, DateTimeOffset now)
    {
        if (version != item.Version) throw new SceneValidationException("La programación cambió. Actualizá y reintentá.");
        if (!Pending.Contains(item.Status) || item.StartsAt <= now)
            throw new SceneValidationException("Esta entrada ya comenzó o terminó; creá una nueva programación.");
    }

    public async Task Tick(CancellationToken ct)
    {
        using var activity = maintenance.TryEnter();
        if (activity is null) return;
        await gate.Mutex.WaitAsync(ct);
        try
        {
            var horizon = clock.GetUtcNow().AddMinutes(2);
            var ids = await db.SceneSchedules.AsNoTracking().Where(x => Running.Contains(x.Status) && x.StartsAt <= horizon)
                .OrderBy(x => x.StartsAt).Select(x => x.Id).ToArrayAsync(ct);
            foreach (var id in ids)
            {
                db.ChangeTracker.Clear();
                try
                {
                    var item = await db.SceneSchedules.SingleAsync(x => x.Id == id, ct);
                    await Advance(item, ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch (Exception error) { logger.LogWarning(error, "Could not process scene schedule {ScheduleId}; retrying", id); }
            }
        }
        finally { gate.Mutex.Release(); }
    }

    private async Task Advance(SceneSchedule item, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var targets = Targets(item);
        // Check the committed activation FIRST: a crash between activation commit and scheduler update
        // must never turn a successful execution into a missed entry or issue a second activation.
        if (await db.SceneSessions.AnyAsync(x => x.Id == item.Id && x.Kind == "activate", ct))
        {
            if (item.Status != "activating") await scenes.RedeliverScheduledActivation(item.Id, ct);
            var session = await scenes.Session(item.Id, ct);
            foreach (var target in targets.Where(x => x.Status != "applied"))
            {
                var result = session.Targets.FirstOrDefault(x => x.DisplayId == target.DisplayId);
                if (result is null) continue;
                target.Status = result.Status; target.Detail = result.Detail; target.ReportedAt = result.ReportedAt;
            }
            item.Status = targets.Any(x => x.Status == "pending") ? "activating" : targets.All(x => x.Status == "applied") ? "completed" : "partial";
            if (item.Status != "activating") item.CompletedAt = now;
            SetTargets(item, targets); await Persist(item, ct); return;
        }
        if (now > item.StartsAt.AddMinutes(1))
        {
            Finish(item, targets, item.PreparationId.HasValue ? "failed" : "missed",
                item.PreparationId.HasValue ? "No se pudo activar dentro del minuto de tolerancia. Revisá la preparación de cada pantalla." : "Se omitió porque pasó más de un minuto desde la hora prevista.");
            await Persist(item, ct); return;
        }
        try
        {
            var plan = await scenes.DescribeSchedule(item.EventId, item.SceneId, item.SceneVersion, item.StartsAt, ct);
            if (plan.Fingerprint != item.Fingerprint)
                throw new SceneValidationException("Cambió el contenido o los destinos de la escena. Editá la programación para confirmarlos.");

            // A more recent due entry takes precedence for its destinations after an interruption.
            var newer = await db.SceneSchedules.AsNoTracking().Where(x => x.EventId == item.EventId && x.StartsAt > item.StartsAt &&
                x.StartsAt <= now && x.Status != "cancelled").ToArrayAsync(ct);
            var superseded = newer.SelectMany(Targets).Select(x => x.DisplayId).ToHashSet();
            foreach (var target in targets.Where(x => superseded.Contains(x.DisplayId)))
            { target.Status = "superseded"; target.Detail = "Ya corresponde una entrada posterior de la agenda."; }
            var selected = targets.Where(x => x.Status != "superseded").Select(x => x.DisplayId).ToArray();
            if (selected.Length == 0)
            { Finish(item, targets, "missed", "Ya corresponde una entrada posterior de la agenda."); await Persist(item, ct); return; }

            SceneSessionResponse? preparation = null;
            if (item.PreparationId is { } preparationId && await db.SceneSessions.AnyAsync(x => x.Id == preparationId, ct))
                preparation = await scenes.Session(preparationId, ct);
            var activateAvailable = now >= item.StartsAt && item.Policy == "available" &&
                preparation?.Targets.Any(x => selected.Contains(x.DisplayId) && x.Status is "ready" or "network") == true;
            if (preparation is null || (preparation.Targets.Any(x => x.Status is not ("ready" or "network" or "pending")) &&
                (preparation.Targets.Any(x => x.Status == "superseded") || now - item.LastPreparationAt >= TimeSpan.FromSeconds(10)) && !activateAvailable))
            {
                item.PreparationId = Guid.NewGuid(); item.LastPreparationAt = now; item.Status = "preparing";
                await Persist(item, ct);
                preparation = await scenes.Prepare(item.EventId, item.SceneId, new(item.SceneVersion, selected), ct, item.PreparationId);
            }
            foreach (var target in targets)
            {
                var result = preparation.Targets.FirstOrDefault(x => x.DisplayId == target.DisplayId);
                if (result is null) continue;
                target.PreparationStatus = result.Status;
                if (target.Status != "superseded") target.Detail = result.Detail;
            }
            SetTargets(item, targets); await Persist(item, ct);
            if (now < item.StartsAt) return;
            var ready = preparation.Targets.Where(x => x.Status is "ready" or "network").Select(x => x.DisplayId).ToHashSet();
            if (item.Policy == "all" ? selected.Any(x => !ready.Contains(x)) : !selected.Any(ready.Contains)) return;
            // SQL persists the session and all desired states atomically before sending to players.
            // Its ID is the schedule ID, making this operation repeatable after a crash.
            try { await scenes.Activate(item.EventId, item.SceneId, new(item.SceneVersion, selected, preparation.Id, item.Policy), ct, item.Id, item.StartsAt); }
            catch (SceneValidationException)
            {
                var current = await scenes.DescribeSchedule(item.EventId, item.SceneId, item.SceneVersion, item.StartsAt, ct);
                if (current.Fingerprint != item.Fingerprint) throw;
                // Playback or connectivity can change after the readiness read above.
                item.PreparationId = null; item.Detail = "Verificando otra vez después de un cambio en las pantallas.";
                await Persist(item, ct); return;
            }
            item.Status = "activating"; await Persist(item, ct);
        }
        catch (SceneValidationException error)
        {
            Finish(item, targets, "failed", error.Message); await Persist(item, ct);
        }
    }

    private void Finish(SceneSchedule item, ScheduleTarget[] targets, string status, string detail)
    {
        item.Status = status; item.Detail = detail; item.CompletedAt = clock.GetUtcNow();
        foreach (var target in targets.Where(x => x.Status == "pending"))
        { target.Status = status == "failed" ? "error" : status; target.Detail = detail; }
        SetTargets(item, targets);
    }

    private async Task Persist(SceneSchedule item, CancellationToken ct)
    {
        db.ChangeTracker.DetectChanges();
        if (db.Entry(item).State != EntityState.Modified) return;
        // Worker progress does not change the editable definition. Keeping its version stable lets
        // an operator finish editing while readiness reports arrive; the gate and status check
        // still prevent editing or cancelling an activation that has begun.
        await db.SaveChangesAsync(ct);
    }
}

public sealed class SceneScheduleService(IServiceScopeFactory scopes, ILogger<SceneScheduleService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<SceneScheduleRegistry>().Tick(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogWarning(error, "Could not run scene schedules; retrying"); }
        }
    }
}
