using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using RevelMovies.Domain.Events;
using RevelMovies.Infrastructure.Persistence;
using RevelEvent = RevelMovies.Domain.Events.Event;

namespace RevelMovies.Api.Runtime;

public sealed class EventRegistry(RevelMoviesDbContext db)
{
    public async Task<IReadOnlyList<RevelEvent>> GetEventsAsync(CancellationToken cancellationToken = default) =>
        await db.Events
            .AsNoTracking()
            .OrderByDescending(x => x.Status == EventStatus.Active)
            .ThenByDescending(x => x.CreatedAt)
            .ToListAsync(cancellationToken);

    public Task<RevelEvent?> GetEventAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.Events.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

    public async Task<RevelEvent> CreateAsync(
        string name,
        string? timeZone,
        DateTimeOffset? startsAt,
        DateTimeOffset? endsAt,
        CancellationToken cancellationToken = default)
    {
        var baseSlug = Slugify(name);
        var slug = baseSlug;
        var suffix = 2;

        while (await db.Events.AnyAsync(x => x.Slug == slug, cancellationToken))
            slug = $"{baseSlug}-{suffix++}";

        var item = new RevelEvent
        {
            Name = name.Trim(),
            Slug = slug,
            TimeZone = string.IsNullOrWhiteSpace(timeZone) ? "UTC" : timeZone.Trim(),
            StartsAt = startsAt,
            EndsAt = endsAt,
            Status = EventStatus.Active
        };

        db.Events.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        return item;
    }

    private static string Slugify(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);

        foreach (var character in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
                builder.Append(character);
        }

        var ascii = builder.ToString().Normalize(NormalizationForm.FormC).ToLowerInvariant();
        var slug = Regex.Replace(ascii, "[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? $"event-{Guid.NewGuid():N}" : slug;
    }
}
