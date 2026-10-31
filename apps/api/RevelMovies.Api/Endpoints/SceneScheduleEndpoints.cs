using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using RevelMovies.Api.Runtime;

namespace RevelMovies.Api.Endpoints;

public static class SceneScheduleEndpoints
{
    public static IEndpointRouteBuilder MapSceneScheduleEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/events/{eventId:guid}/schedule");
        group.AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (SceneValidationException error) { return Results.Conflict(new { error = error.Message }); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "La programación cambió. Actualizá y reintentá." }); }
        });
        group.MapGet("", async (Guid eventId, SceneScheduleRegistry schedules, CancellationToken ct) => Results.Ok(await schedules.List(eventId, ct)));
        group.MapPost("", async (Guid eventId, SaveSceneScheduleRequest request, SceneScheduleRegistry schedules, CancellationToken ct) =>
            Results.Ok(await schedules.Save(eventId, null, request, ct)));
        group.MapPut("/{id:guid}", async (Guid eventId, Guid id, SaveSceneScheduleRequest request, SceneScheduleRegistry schedules, CancellationToken ct) =>
            Results.Ok(await schedules.Save(eventId, id, request, ct)));
        group.MapPost("/{id:guid}/cancel", async (Guid eventId, Guid id, CancelSceneScheduleRequest request, SceneScheduleRegistry schedules, CancellationToken ct) =>
            Results.Ok(await schedules.Cancel(eventId, id, request.Version, ct)));
        group.MapGet("/import-context", async (Guid eventId, SceneScheduleImportService imports, CancellationToken ct) =>
            Results.Ok(await imports.Context(eventId, ct)));
        group.MapPost("/preview-import", async (Guid eventId, HttpRequest request, SceneScheduleImportService imports, CancellationToken ct) =>
        {
            try
            {
                using var json = await ReadImportJson(request, SceneScheduleImportService.MaxPackageBytes, ct);
                return Results.Ok(await imports.Preview(eventId, json.RootElement, ct));
            }
            catch (JsonException) { return Results.BadRequest(new { error = "El archivo no contiene JSON válido. Pegá el objeto JSON completo, sin Markdown." }); }
        });
        group.MapPost("/import", async (Guid eventId, HttpRequest request, SceneScheduleImportService imports, CancellationToken ct) =>
        {
            try
            {
                using var json = await ReadImportJson(request, SceneScheduleImportService.MaxPackageBytes + 4096, ct);
                var value = json.RootElement;
                if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != 2 ||
                    value.EnumerateObject().Any(x => x.Name is not ("package" or "previewToken")) ||
                    !value.TryGetProperty("package", out var package) || !value.TryGetProperty("previewToken", out var token) || token.ValueKind != JsonValueKind.String)
                    return Results.BadRequest(new { error = "La importación requiere package y previewToken de la vista previa." });
                return Results.Ok(await imports.Import(eventId, new(package, token.GetString()!), ct));
            }
            catch (JsonException) { return Results.BadRequest(new { error = "El archivo no contiene JSON válido." }); }
        });
        return app;
    }

    private static async Task<JsonDocument> ReadImportJson(HttpRequest request, int maximumBytes, CancellationToken ct)
    {
        if (request.ContentLength > maximumBytes) throw new SceneValidationException("El archivo JSON no puede superar 1 MiB.");
        using var buffer = new MemoryStream();
        var bytes = new byte[8192];
        while (true)
        {
            var count = await request.Body.ReadAsync(bytes.AsMemory(0, Math.Min(bytes.Length, maximumBytes + 1 - (int)buffer.Length)), ct);
            if (count == 0) break;
            buffer.Write(bytes, 0, count);
            if (buffer.Length > maximumBytes) throw new SceneValidationException("El archivo JSON no puede superar 1 MiB.");
        }
        return JsonDocument.Parse(buffer.ToArray(), new JsonDocumentOptions { MaxDepth = 32 });
    }
}
