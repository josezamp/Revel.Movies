using System.Text.Json;
using RevelMovies.Api.Runtime;
using RevelMovies.Application.Commands;
using RevelMovies.Domain.DisplayGroups;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Playlists;

namespace RevelMovies.Api.Endpoints;

public static class OrchestrationEndpoints
{
    public static IEndpointRouteBuilder MapOrchestrationEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/events/{eventId:guid}/display-groups", async (
            Guid eventId,
            DisplayGroupRegistry registry,
            CancellationToken cancellationToken) =>
        {
            var groups = await registry.GetForEventAsync(eventId, cancellationToken);
            return Results.Ok(groups.Select(DisplayGroupResponse.From));
        });

        app.MapPost("/events/{eventId:guid}/display-groups", async (
            Guid eventId,
            CreateDisplayGroupRequest request,
            DisplayGroupRegistry registry,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest(new { error = "Display group name is required." });

            if (request.Name.Trim().Length > 200)
                return Results.BadRequest(new { error = "Display group name cannot exceed 200 characters." });

            var group = await registry.CreateAsync(eventId, request.Name, cancellationToken);
            return group is null
                ? Results.NotFound(new { error = "Event was not found." })
                : Results.Created($"/api/display-groups/{group.Id}", new DisplayGroupResponse(group.Id, group.EventId, group.Name, [], group.CreatedAt));
        });

        app.MapPut("/display-groups/{groupId:guid}/members", async (
            Guid groupId,
            ReplaceDisplayGroupMembersRequest request,
            DisplayGroupRegistry registry,
            CancellationToken cancellationToken) =>
        {
            var result = await registry.ReplaceMembersAsync(groupId, request.DisplayIds ?? [], cancellationToken);
            return result.Success ? Results.NoContent() : Results.BadRequest(new { error = result.Error });
        });

        app.MapDelete("/display-groups/{groupId:guid}", async (
            Guid groupId,
            DisplayGroupRegistry registry,
            CancellationToken cancellationToken) =>
        {
            var deleted = await registry.DeleteAsync(groupId, cancellationToken);
            return deleted ? Results.NoContent() : Results.NotFound();
        });

        app.MapPost("/display-groups/{groupId:guid}/commands", async (
            Guid groupId,
            SendCommandRequest request,
            DisplayGroupRegistry groupRegistry,
            MediaRegistry mediaRegistry,
            PlayerCommandDispatcher dispatcher,
            CancellationToken cancellationToken) =>
        {
            var group = await groupRegistry.GetAsync(groupId, cancellationToken);
            if (group is null)
                return Results.NotFound();

            var displayIds = await groupRegistry.GetDisplayIdsAsync(groupId, cancellationToken);
            if (displayIds.Count == 0)
                return Results.BadRequest(new { error = "Display group has no members." });

            if (string.Equals(request.Type, "media.play", StringComparison.OrdinalIgnoreCase))
            {
                if (!TryGetMediaId(request.Payload, out var mediaId))
                    return Results.BadRequest(new { error = "media.play requires a valid mediaId." });

                var media = await mediaRegistry.GetAsync(mediaId, cancellationToken);
                if (media is null || media.EventId != group.EventId)
                    return Results.NotFound(new { error = "Media was not found for this event." });

                var dispatch = await dispatcher.SendMediaPlayAsync(displayIds, media, cancellationToken);
                return Results.Accepted(value: dispatch);
            }

            var command = dispatcher.Create(request.Type, request.Payload);
            await dispatcher.SendAsync(displayIds, command, cancellationToken);
            return Results.Accepted(value: new { command, targets = displayIds.Count });
        });

        app.MapGet("/events/{eventId:guid}/playlists", async (
            Guid eventId,
            PlaylistRegistry registry,
            CancellationToken cancellationToken) =>
        {
            var playlists = await registry.GetForEventAsync(eventId, cancellationToken);
            return Results.Ok(playlists.Select(PlaylistResponse.From));
        });

        app.MapPost("/events/{eventId:guid}/playlists", async (
            Guid eventId,
            CreatePlaylistRequest request,
            PlaylistRegistry registry,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest(new { error = "Playlist name is required." });

            if (request.Name.Trim().Length > 200)
                return Results.BadRequest(new { error = "Playlist name cannot exceed 200 characters." });

            var playlist = await registry.CreateAsync(eventId, request.Name, request.IsLoop, cancellationToken);
            return playlist is null
                ? Results.NotFound(new { error = "Event was not found." })
                : Results.Created($"/api/playlists/{playlist.Id}", PlaylistResponse.From(new PlaylistView(playlist, [])));
        });

        app.MapPut("/playlists/{playlistId:guid}", async (
            Guid playlistId,
            UpdatePlaylistRequest request,
            PlaylistRegistry registry,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest(new { error = "Playlist name is required." });

            if (request.Name.Trim().Length > 200)
                return Results.BadRequest(new { error = "Playlist name cannot exceed 200 characters." });

            var playlist = await registry.UpdateAsync(playlistId, request.Name, request.IsLoop, cancellationToken);
            return playlist is null ? Results.NotFound() : Results.Ok(playlist);
        });

        app.MapPut("/playlists/{playlistId:guid}/items", async (
            Guid playlistId,
            ReplacePlaylistItemsRequest request,
            PlaylistRegistry registry,
            CancellationToken cancellationToken) =>
        {
            var definitions = (request.Items ?? [])
                .Select(x => new PlaylistItemDefinition(x.MediaAssetId, x.DurationSeconds))
                .ToArray();

            var result = await registry.ReplaceItemsAsync(playlistId, definitions, cancellationToken);
            return result.Success ? Results.NoContent() : Results.BadRequest(new { error = result.Error });
        });

        app.MapDelete("/playlists/{playlistId:guid}", async (
            Guid playlistId,
            PlaylistRegistry registry,
            CancellationToken cancellationToken) =>
        {
            var deleted = await registry.DeleteAsync(playlistId, cancellationToken);
            return deleted ? Results.NoContent() : Results.NotFound();
        });

        app.MapPost("/playlists/{playlistId:guid}/play", async (
            Guid playlistId,
            PlayPlaylistRequest request,
            PlaylistRegistry playlistRegistry,
            DisplayRegistry displayRegistry,
            DisplayGroupRegistry groupRegistry,
            PlayerCommandDispatcher dispatcher,
            CancellationToken cancellationToken) =>
        {
            var playlist = await playlistRegistry.GetViewAsync(playlistId, cancellationToken);
            if (playlist is null)
                return Results.NotFound(new { error = "Playlist was not found." });

            if (playlist.Items.Count == 0)
                return Results.BadRequest(new { error = "Playlist has no items." });

            IReadOnlyList<Guid> targetDisplayIds;
            if (string.Equals(request.TargetType, "display", StringComparison.OrdinalIgnoreCase))
            {
                var display = await displayRegistry.GetDisplayAsync(request.TargetId, cancellationToken);
                if (display is null || display.EventId != playlist.Playlist.EventId)
                    return Results.NotFound(new { error = "Target display was not found for this event." });

                targetDisplayIds = [display.Id];
            }
            else if (string.Equals(request.TargetType, "group", StringComparison.OrdinalIgnoreCase))
            {
                var group = await groupRegistry.GetAsync(request.TargetId, cancellationToken);
                if (group is null || group.EventId != playlist.Playlist.EventId)
                    return Results.NotFound(new { error = "Target display group was not found for this event." });

                targetDisplayIds = await groupRegistry.GetDisplayIdsAsync(group.Id, cancellationToken);
                if (targetDisplayIds.Count == 0)
                    return Results.BadRequest(new { error = "Target display group has no members." });
            }
            else
            {
                return Results.BadRequest(new { error = "TargetType must be 'display' or 'group'." });
            }

            var items = playlist.Items.Select(item => new PlaylistDispatchItem(
                item.Media.Id,
                item.Media.Type.ToString(),
                item.Media.FileSize,
                item.Item.DurationSeconds ?? (item.Media.Type == MediaType.Image ? 10d : null)))
                .ToArray();

            var dispatch = await dispatcher.SendPlaylistPlayAsync(
                targetDisplayIds,
                playlist.Playlist.Id,
                playlist.Playlist.IsLoop,
                items,
                cancellationToken);

            return Results.Accepted(value: dispatch);
        });

        return app;
    }

    private static bool TryGetMediaId(JsonElement? payload, out Guid mediaId)
    {
        mediaId = Guid.Empty;
        return payload is { } value &&
               value.ValueKind == JsonValueKind.Object &&
               value.TryGetProperty("mediaId", out var mediaIdProperty) &&
               mediaIdProperty.ValueKind == JsonValueKind.String &&
               Guid.TryParse(mediaIdProperty.GetString(), out mediaId);
    }
}

public sealed record CreateDisplayGroupRequest(string Name);
public sealed record ReplaceDisplayGroupMembersRequest(IReadOnlyList<Guid>? DisplayIds);
public sealed record CreatePlaylistRequest(string Name, bool IsLoop);
public sealed record UpdatePlaylistRequest(string Name, bool IsLoop);
public sealed record ReplacePlaylistItemsRequest(IReadOnlyList<PlaylistItemRequest>? Items);
public sealed record PlaylistItemRequest(Guid MediaAssetId, double? DurationSeconds);
public sealed record PlayPlaylistRequest(string TargetType, Guid TargetId);

public sealed record DisplayGroupResponse(
    Guid Id,
    Guid EventId,
    string Name,
    IReadOnlyList<Guid> DisplayIds,
    DateTimeOffset CreatedAt)
{
    public static DisplayGroupResponse From(DisplayGroupView view) => new(
        view.Group.Id,
        view.Group.EventId,
        view.Group.Name,
        view.DisplayIds,
        view.Group.CreatedAt);
}

public sealed record PlaylistItemResponse(
    Guid Id,
    Guid MediaAssetId,
    string MediaName,
    MediaType MediaType,
    int Position,
    double? DurationSeconds);

public sealed record PlaylistResponse(
    Guid Id,
    Guid EventId,
    string Name,
    bool IsLoop,
    IReadOnlyList<PlaylistItemResponse> Items,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt)
{
    public static PlaylistResponse From(PlaylistView view) => new(
        view.Playlist.Id,
        view.Playlist.EventId,
        view.Playlist.Name,
        view.Playlist.IsLoop,
        view.Items.Select(x => new PlaylistItemResponse(
            x.Item.Id,
            x.Media.Id,
            x.Media.Name,
            x.Media.Type,
            x.Item.Position,
            x.Item.DurationSeconds)).ToArray(),
        view.Playlist.CreatedAt,
        view.Playlist.UpdatedAt);
}
