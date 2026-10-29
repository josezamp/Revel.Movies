using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Endpoints;

public static class EventMapEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> Kinds = ["rectangle", "ellipse", "wall", "label", "display"];
    private static readonly HashSet<string> Colors = ["slate", "blue", "amber", "rose", "green"];

    public static IEndpointRouteBuilder MapEventMapEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/events/{eventId:guid}/map", async (Guid eventId, RevelMoviesDbContext db, CancellationToken ct) =>
        {
            var item = await db.Events.AsNoTracking().Where(x => x.Id == eventId)
                .Select(x => new { x.MapVersion, x.MapJson }).SingleOrDefaultAsync(ct);
            return item is null ? Results.NotFound() : Results.Ok(new EventMapResponse(eventId, item.MapVersion,
                JsonSerializer.Deserialize<MapNode[]>(item.MapJson, Json) ?? []));
        });

        app.MapPut("/events/{eventId:guid}/map", async (Guid eventId, SaveEventMapRequest request, RevelMoviesDbContext db, CancellationToken ct) =>
        {
            var item = await db.Events.SingleOrDefaultAsync(x => x.Id == eventId, ct);
            if (item is null) return Results.NotFound();
            if (request.Version != item.MapVersion) return Conflict();
            if (request.Nodes is null || request.Nodes.Length > 300 || request.Nodes.Any(node => node is null || !Valid(node)) ||
                request.Nodes.Select(node => node!.Id).Distinct().Count() != request.Nodes.Length)
                return Results.BadRequest(new { error = "Croquis inválido. Usá hasta 300 elementos dentro del lienzo de 1200 × 800." });

            var nodes = request.Nodes.Select(node => node!).ToArray();
            var displayIds = nodes.Where(node => node.Kind == "display").Select(node => node.DisplayId!.Value).ToArray();
            if (displayIds.Distinct().Count() != displayIds.Length ||
                await db.Displays.CountAsync(x => x.EventId == eventId && displayIds.Contains(x.Id), ct) != displayIds.Length)
                return Results.BadRequest(new { error = "Cada pantalla debe pertenecer a este evento y aparecer una sola vez. Quitá del croquis las pantallas desvinculadas." });

            item.MapJson = JsonSerializer.Serialize(nodes, Json);
            item.MapVersion++;
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException) { return Conflict(); }
            return Results.Ok(new EventMapResponse(eventId, item.MapVersion, nodes));
        }).WithMetadata(new RequestSizeLimitAttribute(256 * 1024));
        return app;
    }

    private static IResult Conflict() => Results.Conflict(new { code = "map_version_conflict", error = "El croquis cambió en otra sesión. Tu borrador se conserva. Cargá la versión guardada antes de continuar." });

    private static bool Valid(MapNode node) => node.Id != Guid.Empty && node.Kind is not null && Kinds.Contains(node.Kind) &&
        node.Color is not null && Colors.Contains(node.Color) && node.Label is not null && node.Label.Length <= 100 &&
        (node.Kind == "display" ? node.DisplayId.HasValue && node.DisplayId != Guid.Empty : node.DisplayId is null) &&
        double.IsFinite(node.X) && double.IsFinite(node.Y) && double.IsFinite(node.Width) && double.IsFinite(node.Height) &&
        node.X >= 0 && node.Y >= 0 && node.Width >= 8 && node.Height >= 8 &&
        node.X + node.Width <= 1200 && node.Y + node.Height <= 800;
}

public sealed record MapNode(Guid Id, string Kind, double X, double Y, double Width, double Height, string Label, string Color, Guid? DisplayId);
public sealed record SaveEventMapRequest(int Version, MapNode?[]? Nodes);
public sealed record EventMapResponse(Guid EventId, int Version, MapNode[] Nodes);
