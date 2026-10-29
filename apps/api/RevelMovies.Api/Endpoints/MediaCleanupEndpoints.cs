using RevelMovies.Api.Runtime;

namespace RevelMovies.Api.Endpoints;

public static class MediaCleanupEndpoints
{
    public static void MapMediaCleanupEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/events/{eventId:guid}/media-cleanup");
        group.MapGet("", async (Guid eventId, MediaCleanupService cleanup, CancellationToken token) =>
        {
            try
            {
                var preview = await cleanup.PreviewAsync(eventId, token);
                return preview is null ? Results.NotFound() : Results.Ok(preview);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { return Results.Conflict(new { error = "No se pudieron revisar los archivos. Revisá permisos y enlaces del almacenamiento y reintentá." }); }
        });
        group.MapPost("", async (Guid eventId, MediaCleanupRequest request, MediaMaintenanceGate gate,
            MediaCleanupService cleanup, CancellationToken token) =>
        {
            if (request.Confirmation != "ELIMINAR" || string.IsNullOrWhiteSpace(request.SnapshotToken))
                return Results.BadRequest(new { error = "Revisá el resumen y escribí ELIMINAR para confirmar." });
            using var exclusive = gate.TryEnter(cleanup: true);
            if (exclusive is null)
                return Results.Conflict(new { error = "Hay operaciones o conversiones en curso. Esperá a que terminen y reintentá la limpieza." });
            try
            {
                var result = await cleanup.CleanAsync(eventId, request.SnapshotToken, token);
                return result is null ? Results.NotFound() : Results.Ok(result);
            }
            catch (MediaCleanupConflict ex) { return Results.Conflict(new { error = ex.Message }); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { return Results.Conflict(new { error = "No se pudieron revisar los archivos. Revisá permisos y enlaces del almacenamiento y reintentá." }); }
        });
    }
}

public sealed record MediaCleanupRequest(string Confirmation, string SnapshotToken);
