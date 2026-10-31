using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Scenes;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed record SceneSchedulePackage(int SchemaVersion, Guid EventId, string TimeZone,
    ImportedScene[] Scenes, ImportedScheduleEntry[] Schedule);
public sealed record ImportedScene(string Key, string Name, SceneAssignment[] Assignments, int? TemporaryDurationSeconds = null);
public sealed record ImportedScheduleEntry(string SceneKey, string LocalStartsAt, string Policy);
public sealed record ImportSceneScheduleRequest(JsonElement Package, string PreviewToken);
public sealed record ImportTarget(Guid DisplayId, string DisplayName);
public sealed record ImportSchedulePreview(string SceneKey, string SceneName, string LocalStartsAt, string TimeZone,
    string Policy, ImportTarget[] Targets);
public sealed record SceneScheduleImportPreview(string PreviewToken, ImportedScene[] Scenes, ImportSchedulePreview[] Schedule,
    string[] Warnings, bool AlreadyImported = false);
public sealed record SceneScheduleImportResult(bool AlreadyImported, int SceneCount, int ScheduleCount);
public sealed record SceneScheduleImportContext(string Prompt);

public sealed class SceneScheduleImportService(RevelMoviesDbContext db, SceneRegistry scenes, SceneScheduleGate gate,
    MediaMaintenanceGate maintenance, TimeProvider clock)
{
    public const int MaxPackageBytes = 1024 * 1024;
    private static readonly JsonSerializerOptions StrictJson = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        NumberHandling = JsonNumberHandling.Strict,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        MaxDepth = 32
    };
    private static readonly string[] Running = ["scheduled", "preparing", "activating"];
    private sealed record PlannedEntry(ImportedScheduleEntry Input, DateTimeOffset StartsAt, string Fingerprint, ImportTarget[] Targets);
    private sealed record Plan(SceneScheduleImportPreview Preview, PlannedEntry[] Entries);

    public Task<SceneScheduleImportContext> Context(Guid eventId, CancellationToken ct) =>
        SceneScheduleImportPrompt.Create(db, eventId, clock.GetUtcNow(), ct);

    public async Task<SceneScheduleImportPreview> Preview(Guid eventId, JsonElement json, CancellationToken ct)
    {
        var package = Parse(eventId, json);
        var hash = Hash(JsonSerializer.SerializeToElement(package, SceneRegistry.Json));
        using var activity = EnterMaintenance();
        await gate.Mutex.WaitAsync(ct);
        try
        {
            var previous = await Receipt(eventId, hash, ct);
            if (previous is not null) return PreviousPreview(previous);
            return (await BuildPlan(package, hash, ct)).Preview;
        }
        finally { gate.Mutex.Release(); }
    }

    public async Task<SceneScheduleImportResult> Import(Guid eventId, ImportSceneScheduleRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.PreviewToken))
            throw new SceneValidationException("Revisá la vista previa antes de importar.");
        var package = Parse(eventId, request.Package);
        var hash = Hash(JsonSerializer.SerializeToElement(package, SceneRegistry.Json));
        using var activity = EnterMaintenance();
        await gate.Mutex.WaitAsync(ct);
        try
        {
            // Serializable validation keeps resource edits from slipping between revalidation and commit.
            await using var transaction = db.Database.IsRelational()
                ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
            var previous = await Receipt(eventId, hash, ct);
            if (previous is not null)
            {
                if (PreviousPreview(previous).PreviewToken != request.PreviewToken)
                    throw new SceneValidationException("Revisá la vista previa de este archivo antes de importar.");
                return new(true, previous.SceneCount, previous.ScheduleCount);
            }
            var plan = await BuildPlan(package, hash, ct);
            if (plan.Preview.PreviewToken != request.PreviewToken)
                throw new SceneValidationException("Cambió el archivo, el contenido o los destinos desde la vista previa. Revisá el JSON nuevamente.");

            var now = clock.GetUtcNow();
            if (plan.Entries.Any(entry => entry.StartsAt <= now))
                throw new SceneValidationException("Un horario ya pasó. Actualizá el JSON y revisalo nuevamente.");
            var definitions = package.Scenes.ToDictionary(item => item.Key, item => new Scene
            {
                EventId = eventId, Name = item.Name.Trim(),
                AssignmentsJson = JsonSerializer.Serialize(item.Assignments, SceneRegistry.Json),
                TemporaryDurationSeconds = item.TemporaryDurationSeconds, CreatedAt = now, UpdatedAt = now
            }, StringComparer.Ordinal);
            var entries = plan.Entries.Select(entry =>
            {
                var definition = definitions[entry.Input.SceneKey];
                return new SceneSchedule
                {
                    EventId = eventId, SceneId = definition.Id, SceneName = definition.Name, SceneVersion = definition.Version,
                    Fingerprint = entry.Fingerprint, StartsAt = entry.StartsAt, LocalStartsAt = entry.Input.LocalStartsAt,
                    TimeZone = package.TimeZone, Policy = entry.Input.Policy, CreatedAt = now,
                    TargetsJson = JsonSerializer.Serialize(entry.Targets.Select(target => new ScheduleTarget
                    { DisplayId = target.DisplayId, DisplayName = target.DisplayName }).ToArray(), SceneRegistry.Json)
                };
            }).ToArray();
            db.Scenes.AddRange(definitions.Values);
            db.SceneSchedules.AddRange(entries);
            db.SceneScheduleImports.Add(new SceneScheduleImport
            {
                EventId = eventId, PackageHash = hash, SceneCount = definitions.Count, ScheduleCount = entries.Length,
                PreviewJson = JsonSerializer.Serialize(plan.Preview, SceneRegistry.Json), CreatedAt = now
            });
            // One save (and one transaction) means a rejected package never leaves partial scenes or timers.
            await db.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
            return new(false, definitions.Count, entries.Length);
        }
        catch
        {
            db.ChangeTracker.Clear();
            throw;
        }
        finally { gate.Mutex.Release(); }
    }

    private IDisposable EnterMaintenance() => maintenance.TryEnter()
        ?? throw new SceneValidationException("Hay una limpieza de archivos en curso. Reintentá al finalizar.");
    private Task<SceneScheduleImport?> Receipt(Guid eventId, string hash, CancellationToken ct) =>
        db.SceneScheduleImports.AsNoTracking().SingleOrDefaultAsync(x => x.EventId == eventId && x.PackageHash == hash, ct);
    private static SceneScheduleImportPreview PreviousPreview(SceneScheduleImport receipt)
    {
        var preview = JsonSerializer.Deserialize<SceneScheduleImportPreview>(receipt.PreviewJson, SceneRegistry.Json)!;
        return preview with { AlreadyImported = true, Warnings = ["Este archivo ya se importó. Sus escenas u horarios pueden haberse editado o cancelado desde entonces; repetirlo no los recrea."] };
    }

    public static SceneSchedulePackage Parse(Guid eventId, JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object)
            throw new SceneValidationException("El JSON debe ser un objeto con escenas y programación.");
        if (Encoding.UTF8.GetByteCount(json.GetRawText()) > MaxPackageBytes)
            throw new SceneValidationException("El archivo JSON no puede superar 1 MiB.");
        RejectDuplicateProperties(json, "$", 0);
        SceneSchedulePackage package;
        try { package = json.Deserialize<SceneSchedulePackage>(StrictJson)!; }
        catch (JsonException error)
        {
            throw new SceneValidationException($"El JSON contiene un campo desconocido, ausente o inválido en {error.Path ?? "$"}. Usá el formato del contexto para ChatGPT.");
        }
        if (package.SchemaVersion != 1) throw new SceneValidationException("La versión del formato debe ser schemaVersion: 1.");
        if (package.EventId == Guid.Empty || package.EventId != eventId)
            throw new SceneValidationException("El JSON pertenece a otro evento. Copiá el contexto del evento seleccionado.");
        if (package.Scenes is not { Length: > 0 and <= 100 } || package.Scenes.Any(x => x is null))
            throw new SceneValidationException("El JSON debe incluir entre 1 y 100 escenas.");
        if (package.Schedule is not { Length: > 0 and <= 300 } || package.Schedule.Any(x => x is null))
            throw new SceneValidationException("El JSON debe incluir entre 1 y 300 cambios de escena.");
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var assignmentCount = 0;
        foreach (var scene in package.Scenes)
        {
            if (scene.Key is null || !Regex.IsMatch(scene.Key, "^[a-zA-Z0-9_-]{1,64}$") || !keys.Add(scene.Key))
                throw new SceneValidationException("Cada escena necesita una key única de hasta 64 letras, números, guiones o guiones bajos.");
            if (scene.Assignments is not { Length: > 0 and <= 100 } || scene.Assignments.Any(x => x is null))
                throw new SceneValidationException($"La escena «{scene.Key}» necesita entre 1 y 100 asignaciones válidas.");
            assignmentCount += scene.Assignments.Length;
            foreach (var assignment in scene.Assignments)
            {
                if (assignment.DisplayIds is null || assignment.GroupIds is null || assignment.Media is null || assignment.WebPage is null || assignment.Announcement is null)
                    throw new SceneValidationException($"La escena «{scene.Key}» debe declarar destinos y todas sus capas.");
                if (assignment.DisplayIds.Length + assignment.GroupIds.Length > 500)
                    throw new SceneValidationException("Cada asignación admite hasta 500 destinos o grupos.");
                if (assignment.Media.Type is not (null or "media" or "playlist") ||
                    (assignment.Media.Type == "media" && assignment.Media.PlaylistId.HasValue) ||
                    (assignment.Media.Type == "playlist" && assignment.Media.MediaId.HasValue))
                    throw new SceneValidationException("La capa media debe elegir un archivo o una playlist, sin referencias incompatibles.");
                if (assignment.Media.Action != "replace" && (assignment.Media.Type is not null || assignment.Media.MediaId.HasValue ||
                    assignment.Media.PlaylistId.HasValue || assignment.Media.Loop.HasValue || assignment.Media.State is not null ||
                    assignment.Media.ResumePositionSeconds.HasValue || assignment.Media.ResumePlaylistIndex.HasValue))
                    throw new SceneValidationException("Los datos de multimedia sólo se usan con action: replace.");
                if ((assignment.WebPage.Action != "replace" && assignment.WebPage.Payload is { ValueKind: not JsonValueKind.Null }) ||
                    (assignment.Announcement.Action != "replace" && assignment.Announcement.Payload is { ValueKind: not JsonValueKind.Null }))
                    throw new SceneValidationException("El payload de una capa sólo se usa con action: replace.");
                CheckPayload(assignment.WebPage.Payload, ["url"], "webPage");
                CheckPayload(assignment.Announcement.Payload, ["kind", "text", "layout", "theme", "endsAt", "durationSeconds", "completedText"], "announcement");
            }
        }
        if (assignmentCount > 500) throw new SceneValidationException("Una importación admite hasta 500 asignaciones en total.");
        foreach (var entry in package.Schedule)
        {
            if (entry.SceneKey is null || !keys.Contains(entry.SceneKey))
                throw new SceneValidationException("Un horario referencia una sceneKey que no existe en scenes.");
            if (entry.Policy is not ("all" or "available"))
                throw new SceneValidationException("Cada horario debe indicar policy: all o available.");
        }
        if (keys.Except(package.Schedule.Select(x => x.SceneKey)).Any())
            throw new SceneValidationException("Todas las escenas importadas deben tener al menos un horario.");
        // Layer actions must be explicit: omitting an action must never silently retain a live layer.
        foreach (var scene in json.GetProperty("scenes").EnumerateArray())
            foreach (var assignment in scene.GetProperty("assignments").EnumerateArray())
                foreach (var layer in new[] { "media", "webPage", "announcement" })
                    if (!assignment.GetProperty(layer).TryGetProperty("action", out _))
                        throw new SceneValidationException($"Cada capa {layer} debe indicar action: keep, replace o remove.");
        return package;
    }

    private async Task<Plan> BuildPlan(SceneSchedulePackage package, string packageHash, CancellationToken ct)
    {
        var definitions = package.Scenes.ToDictionary(x => x.Key, StringComparer.Ordinal);
        var entries = new List<PlannedEntry>();
        var previews = new List<ImportSchedulePreview>();
        var resolvedScenes = new Dictionary<string, (string Fingerprint, SceneTargetResponse[] Targets)>(StringComparer.Ordinal);
        var occupied = new HashSet<(DateTimeOffset, Guid)>();
        var existing = await db.SceneSchedules.AsNoTracking()
            .Where(x => x.EventId == package.EventId && Running.Contains(x.Status)).ToArrayAsync(ct);
        var existingTargets = existing.SelectMany(x => JsonSerializer.Deserialize<ScheduleTarget[]>(x.TargetsJson, SceneRegistry.Json)!
            .Select(target => (x.StartsAt, target.DisplayId))).ToHashSet();
        foreach (var entry in package.Schedule)
        {
            var start = SceneScheduleRegistry.ParseStart(entry.LocalStartsAt, package.TimeZone);
            if (start <= clock.GetUtcNow()) throw new SceneValidationException($"El horario {entry.LocalStartsAt} debe estar en el futuro.");
            var scene = definitions[entry.SceneKey];
            (string Fingerprint, SceneTargetResponse[] Targets) resolved;
            try
            {
                if (!resolvedScenes.TryGetValue(scene.Key, out resolved))
                {
                    resolved = await scenes.DescribeDraftSchedule(package.EventId, new(scene.Name, scene.Assignments, scene.TemporaryDurationSeconds), start, ct);
                    resolvedScenes.Add(scene.Key, resolved);
                }
                // Resources are the same for every occurrence, but a fixed countdown deadline
                // must still be valid at each of its scheduled activation times.
                foreach (var assignment in scene.Assignments.Where(x => x.Announcement.Action == "replace"))
                    if (AnnouncementCommand.Validate(assignment.Announcement.Payload, start, out _) is { } error)
                        throw new SceneValidationException(error);
            }
            catch (SceneValidationException error) { throw new SceneValidationException($"Escena «{scene.Name}»: {error.Message}"); }
            var targets = resolved.Targets.Select(x => new ImportTarget(x.DisplayId, x.DisplayName)).ToArray();
            foreach (var target in targets)
            {
                if (!occupied.Add((start, target.DisplayId)))
                    throw new SceneValidationException($"El JSON programa dos escenas a la misma hora ({entry.LocalStartsAt}) en «{target.DisplayName}».");
                if (existingTargets.Contains((start, target.DisplayId)))
                    throw new SceneValidationException($"Ya hay una escena programada a las {entry.LocalStartsAt} en «{target.DisplayName}». No se reemplazó la programación existente.");
            }
            entries.Add(new(entry, start, resolved.Fingerprint, targets));
            previews.Add(new(entry.SceneKey, scene.Name.Trim(), entry.LocalStartsAt, package.TimeZone, entry.Policy, targets));
        }
        var assignments = package.Scenes.SelectMany(x => x.Assignments).ToArray();
        var mediaIds = assignments.Where(x => x.Media.Action == "replace" && x.Media.MediaId.HasValue).Select(x => x.Media.MediaId!.Value).ToArray();
        var playlistIds = assignments.Where(x => x.Media.Action == "replace" && x.Media.PlaylistId.HasValue).Select(x => x.Media.PlaylistId!.Value).ToArray();
        var groupIds = assignments.SelectMany(x => x.GroupIds).ToArray();
        var resourceNames = new
        {
            media = await db.MediaAssets.AsNoTracking().Where(x => mediaIds.Contains(x.Id)).OrderBy(x => x.Id).Select(x => new { x.Id, x.Name }).ToArrayAsync(ct),
            playlists = await db.Playlists.AsNoTracking().Where(x => playlistIds.Contains(x.Id)).OrderBy(x => x.Id).Select(x => new { x.Id, x.Name }).ToArrayAsync(ct),
            groups = await db.DisplayGroups.AsNoTracking().Where(x => groupIds.Contains(x.Id)).OrderBy(x => x.Id).Select(x => new { x.Id, x.Name }).ToArrayAsync(ct)
        };
        var token = Hash(JsonSerializer.SerializeToElement(new { packageHash, entries, resourceNames }, SceneRegistry.Json));
        var warnings = new List<string>
        {
            "Se agregarán escenas nuevas y horarios. La programación existente se conserva.",
            "El último cambio de cada pantalla continúa hasta otra escena o acción manual. Para terminar una franja, incluí explícitamente el cambio siguiente. Las escenas temporales vuelven al estado anterior."
        };
        if (assignments.Any(x => x.WebPage.Action == "replace")) warnings.Add("Las páginas web requieren red y deben permitir mostrarse dentro de Revel.");
        if (package.Scenes.Any(x => x.TemporaryDurationSeconds.HasValue)) warnings.Add("Las duraciones temporales se cuentan desde la activación; no representan una hora fija de finalización.");
        if (entries.Any(x => x.StartsAt < clock.GetUtcNow().AddMinutes(2))) warnings.Add("Hay cambios a menos de dos minutos: las pantallas podrían no terminar de preparar los recursos.");
        var orderedPreviews = previews.Zip(entries).OrderBy(x => x.Second.StartsAt).Select(x => x.First).ToArray();
        return new(new(token, package.Scenes.Select(x => x with { Name = x.Name.Trim() }).ToArray(), orderedPreviews, warnings.ToArray()), entries.ToArray());
    }

    private static void CheckPayload(JsonElement? payload, string[] allowed, string name)
    {
        if (payload is null || payload.Value.ValueKind == JsonValueKind.Null) return;
        if (payload.Value.ValueKind != JsonValueKind.Object || payload.Value.EnumerateObject().Any(x => !allowed.Contains(x.Name, StringComparer.Ordinal)))
            throw new SceneValidationException($"La capa {name} contiene un payload inválido o campos desconocidos.");
    }

    private static void RejectDuplicateProperties(JsonElement value, string path, int depth)
    {
        if (depth > 32) throw new SceneValidationException("El JSON tiene demasiados niveles de anidación.");
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw new SceneValidationException($"El JSON repite el campo {path}.{property.Name}.");
                RejectDuplicateProperties(property.Value, $"{path}.{property.Name}", depth + 1);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) RejectDuplicateProperties(item, path + "[]", depth + 1);
    }

    private static string Hash(JsonElement value)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream)) WriteCanonical(writer, value);
        return Convert.ToHexString(SHA256.HashData(stream.ToArray()));
    }

    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var property in value.EnumerateObject().OrderBy(x => x.Name, StringComparer.Ordinal))
            { writer.WritePropertyName(property.Name); WriteCanonical(writer, property.Value); }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            writer.WriteStartArray();
            foreach (var item in value.EnumerateArray()) WriteCanonical(writer, item);
            writer.WriteEndArray();
        }
        else value.WriteTo(writer);
    }
}
