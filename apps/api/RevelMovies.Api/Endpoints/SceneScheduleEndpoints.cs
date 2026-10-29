using Microsoft.EntityFrameworkCore;
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
        return app;
    }
}
