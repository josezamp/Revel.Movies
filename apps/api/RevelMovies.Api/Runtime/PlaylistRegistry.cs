using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Media;
using RevelMovies.Domain.Playlists;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class PlaylistRegistry(RevelMoviesDbContext db)
{
    public async Task<IReadOnlyList<PlaylistView>> GetForEventAsync(Guid eventId, CancellationToken cancellationToken = default)
    {
        var playlists = await db.Playlists
            .AsNoTracking()
            .Where(x => x.EventId == eventId)
            .OrderBy(x => x.Name)
            .ToListAsync(cancellationToken);

        if (playlists.Count == 0)
            return [];

        var playlistIds = playlists.Select(x => x.Id).ToArray();
        var items = await (
            from item in db.PlaylistItems.AsNoTracking()
            join media in db.MediaAssets.AsNoTracking() on item.MediaAssetId equals media.Id
            where playlistIds.Contains(item.PlaylistId)
            orderby item.PlaylistId, item.Position
            select new PlaylistItemView(item, media)
        ).ToListAsync(cancellationToken);

        return playlists
            .Select(playlist => new PlaylistView(
                playlist,
                items.Where(x => x.Item.PlaylistId == playlist.Id).ToArray()))
            .ToArray();
    }

    public Task<Playlist?> GetAsync(Guid playlistId, CancellationToken cancellationToken = default) =>
        db.Playlists.AsNoTracking().FirstOrDefaultAsync(x => x.Id == playlistId, cancellationToken);

    public async Task<PlaylistView?> GetViewAsync(Guid playlistId, CancellationToken cancellationToken = default)
    {
        var playlist = await db.Playlists.AsNoTracking().FirstOrDefaultAsync(x => x.Id == playlistId, cancellationToken);
        if (playlist is null)
            return null;

        var items = await (
            from item in db.PlaylistItems.AsNoTracking()
            join media in db.MediaAssets.AsNoTracking() on item.MediaAssetId equals media.Id
            where item.PlaylistId == playlistId
            orderby item.Position
            select new PlaylistItemView(item, media)
        ).ToListAsync(cancellationToken);

        return new PlaylistView(playlist, items);
    }

    public async Task<Playlist?> CreateAsync(Guid eventId, string name, bool isLoop, CancellationToken cancellationToken = default)
    {
        if (!await db.Events.AnyAsync(x => x.Id == eventId, cancellationToken))
            return null;

        var playlist = new Playlist
        {
            EventId = eventId,
            Name = name.Trim(),
            IsLoop = isLoop,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        db.Playlists.Add(playlist);
        await db.SaveChangesAsync(cancellationToken);
        return playlist;
    }

    public async Task<Playlist?> UpdateAsync(Guid playlistId, string name, bool isLoop, CancellationToken cancellationToken = default)
    {
        var playlist = await db.Playlists.FirstOrDefaultAsync(x => x.Id == playlistId, cancellationToken);
        if (playlist is null)
            return null;

        playlist.Name = name.Trim();
        playlist.IsLoop = isLoop;
        playlist.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return playlist;
    }

    public async Task<PlaylistItemsUpdateResult> ReplaceItemsAsync(
        Guid playlistId,
        IReadOnlyList<PlaylistItemDefinition> definitions,
        CancellationToken cancellationToken = default)
    {
        var playlist = await db.Playlists.FirstOrDefaultAsync(x => x.Id == playlistId, cancellationToken);
        if (playlist is null)
            return new PlaylistItemsUpdateResult(false, "Playlist was not found.");

        if (definitions.Any(x => x.MediaAssetId == Guid.Empty || x.DurationSeconds is <= 0))
            return new PlaylistItemsUpdateResult(false, "Playlist items contain invalid media or duration values.");

        var mediaIds = definitions.Select(x => x.MediaAssetId).Distinct().ToArray();
        var media = await db.MediaAssets
            .AsNoTracking()
            .Where(x => mediaIds.Contains(x.Id) && x.EventId == playlist.EventId)
            .ToListAsync(cancellationToken);

        if (media.Count != mediaIds.Length)
            return new PlaylistItemsUpdateResult(false, "Every media item must belong to the same event as the playlist.");

        await db.PlaylistItems
            .Where(x => x.PlaylistId == playlistId)
            .ExecuteDeleteAsync(cancellationToken);

        db.PlaylistItems.AddRange(definitions.Select((definition, index) => new PlaylistItem
        {
            PlaylistId = playlistId,
            MediaAssetId = definition.MediaAssetId,
            Position = index,
            DurationSeconds = definition.DurationSeconds
        }));

        playlist.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return new PlaylistItemsUpdateResult(true, null);
    }

    public async Task<bool> DeleteAsync(Guid playlistId, CancellationToken cancellationToken = default)
    {
        var deleted = await db.Playlists.Where(x => x.Id == playlistId).ExecuteDeleteAsync(cancellationToken);
        return deleted > 0;
    }
}

public sealed record PlaylistItemDefinition(Guid MediaAssetId, double? DurationSeconds);
public sealed record PlaylistItemView(PlaylistItem Item, MediaAsset Media);
public sealed record PlaylistView(Playlist Playlist, IReadOnlyList<PlaylistItemView> Items);
public sealed record PlaylistItemsUpdateResult(bool Success, string? Error);
