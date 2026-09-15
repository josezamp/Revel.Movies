using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.DisplayGroups;
using RevelMovies.Infrastructure.Persistence;

namespace RevelMovies.Api.Runtime;

public sealed class DisplayGroupRegistry(RevelMoviesDbContext db)
{
    public async Task<IReadOnlyList<DisplayGroupView>> GetForEventAsync(Guid eventId, CancellationToken cancellationToken = default)
    {
        var groups = await db.DisplayGroups
            .AsNoTracking()
            .Where(x => x.EventId == eventId)
            .OrderBy(x => x.Name)
            .ToListAsync(cancellationToken);

        if (groups.Count == 0)
            return [];

        var ids = groups.Select(x => x.Id).ToArray();
        var members = await db.DisplayGroupMembers
            .AsNoTracking()
            .Where(x => ids.Contains(x.DisplayGroupId))
            .OrderBy(x => x.DisplayGroupId)
            .ThenBy(x => x.DisplayId)
            .ToListAsync(cancellationToken);

        return groups
            .Select(group => new DisplayGroupView(
                group,
                members.Where(x => x.DisplayGroupId == group.Id).Select(x => x.DisplayId).ToArray()))
            .ToArray();
    }

    public Task<DisplayGroup?> GetAsync(Guid groupId, CancellationToken cancellationToken = default) =>
        db.DisplayGroups.AsNoTracking().FirstOrDefaultAsync(x => x.Id == groupId, cancellationToken);

    public async Task<DisplayGroup?> CreateAsync(Guid eventId, string name, CancellationToken cancellationToken = default)
    {
        if (!await db.Events.AnyAsync(x => x.Id == eventId, cancellationToken))
            return null;

        var now = DateTimeOffset.UtcNow;
        var group = new DisplayGroup
        {
            EventId = eventId,
            Name = name.Trim(),
            UpdatedAt = now
        };

        db.DisplayGroups.Add(group);
        await db.SaveChangesAsync(cancellationToken);
        return group;
    }

    public async Task<GroupMembersUpdateResult> ReplaceMembersAsync(
        Guid groupId,
        IReadOnlyCollection<Guid> displayIds,
        CancellationToken cancellationToken = default)
    {
        var group = await db.DisplayGroups.FirstOrDefaultAsync(x => x.Id == groupId, cancellationToken);
        if (group is null)
            return new GroupMembersUpdateResult(false, "Display group was not found.");

        var requestedIds = displayIds.Where(x => x != Guid.Empty).Distinct().ToArray();
        var validCount = await db.Displays.CountAsync(x =>
            requestedIds.Contains(x.Id) && x.EventId == group.EventId, cancellationToken);

        if (validCount != requestedIds.Length)
            return new GroupMembersUpdateResult(false, "Every display must belong to the same event as the group.");

        await db.DisplayGroupMembers
            .Where(x => x.DisplayGroupId == groupId)
            .ExecuteDeleteAsync(cancellationToken);

        db.DisplayGroupMembers.AddRange(requestedIds.Select(displayId => new DisplayGroupMember
        {
            DisplayGroupId = groupId,
            DisplayId = displayId
        }));

        group.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return new GroupMembersUpdateResult(true, null);
    }

    public async Task<IReadOnlyList<Guid>> GetDisplayIdsAsync(Guid groupId, CancellationToken cancellationToken = default) =>
        await db.DisplayGroupMembers
            .AsNoTracking()
            .Where(x => x.DisplayGroupId == groupId)
            .Select(x => x.DisplayId)
            .ToListAsync(cancellationToken);

    public async Task<bool> DeleteAsync(Guid groupId, CancellationToken cancellationToken = default)
    {
        var deleted = await db.DisplayGroups.Where(x => x.Id == groupId).ExecuteDeleteAsync(cancellationToken);
        return deleted > 0;
    }
}

public sealed record DisplayGroupView(DisplayGroup Group, IReadOnlyList<Guid> DisplayIds);
public sealed record GroupMembersUpdateResult(bool Success, string? Error);
