using Microsoft.EntityFrameworkCore;
using RevelMovies.Api.Runtime;

namespace RevelMovies.Api.Endpoints;

public static class SceneEndpoints
{
    public static IEndpointRouteBuilder MapSceneEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/events/{eventId:guid}/scenes");
        group.AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (SceneValidationException exception) { return Results.Conflict(new { error = exception.Message }); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "Otra acción modificó el estado. Actualizá y reintentá." }); }
        });
        group.MapGet("", async (Guid eventId, SceneRegistry scenes, CancellationToken ct) => Results.Ok(await scenes.List(eventId, ct)));
        group.MapPost("", async (Guid eventId, SaveSceneRequest request, SceneRegistry scenes, CancellationToken ct) => Results.Ok(await scenes.Save(eventId, null, request, ct)));
        group.MapPut("/{sceneId:guid}", async (Guid eventId, Guid sceneId, SaveSceneRequest request, SceneRegistry scenes, CancellationToken ct) => Results.Ok(await scenes.Save(eventId, sceneId, request, ct)));
        group.MapDelete("/{sceneId:guid}", async (Guid eventId, Guid sceneId, SceneRegistry scenes, CancellationToken ct) => { await scenes.Delete(eventId, sceneId, ct); return Results.NoContent(); });
        group.MapPost("/{sceneId:guid}/duplicate", async (Guid eventId, Guid sceneId, SceneRegistry scenes, CancellationToken ct) => Results.Ok(await scenes.Duplicate(eventId, sceneId, ct)));
        group.MapPost("/snapshot", async (Guid eventId, SnapshotSceneRequest request, SceneRegistry scenes, CancellationToken ct) => Results.Ok(await scenes.Snapshot(eventId, request, ct)));
        group.MapPost("/{sceneId:guid}/prepare", async (Guid eventId, Guid sceneId, SceneOperationRequest request, SceneRegistry scenes, CancellationToken ct) => Results.Ok(await scenes.Prepare(eventId, sceneId, request, ct)));
        group.MapPost("/{sceneId:guid}/activate", async (Guid eventId, Guid sceneId, SceneOperationRequest request, SceneRegistry scenes, CancellationToken ct) => Results.Ok(await scenes.Activate(eventId, sceneId, request, ct)));
        app.MapGet("/events/{eventId:guid}/scene-sessions", async (Guid eventId, SceneRegistry scenes, CancellationToken ct) => Results.Ok(await scenes.Sessions(eventId, ct)));
        app.MapGet("/scene-sessions/{id:guid}", async (Guid id, SceneRegistry scenes, CancellationToken ct) =>
        {
            try { await scenes.Expire(ct); return Results.Ok(await scenes.Session(id, ct)); }
            catch (SceneValidationException exception) { return Results.NotFound(new { error = exception.Message }); }
        });
        app.MapPost("/scene-sessions/{id:guid}/restore", async (Guid id, SceneRegistry scenes, CancellationToken ct) =>
        {
            try { return Results.Ok(await scenes.Restore(id, ct)); }
            catch (SceneValidationException exception) { return Results.Conflict(new { error = exception.Message }); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "El destino cambió durante el retorno. Reintentá." }); }
        });
        return app;
    }
}
