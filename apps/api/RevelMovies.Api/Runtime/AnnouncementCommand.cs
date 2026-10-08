using System.Text.Json;

namespace RevelMovies.Api.Runtime;

// Normalize once on the server so every screen receives the same UTC deadline.
public static class AnnouncementCommand
{
    public static bool IsShow(string? type) => string.Equals(type, "announcement.show", StringComparison.OrdinalIgnoreCase);
    public static bool IsClear(string? type) => string.Equals(type, "announcement.clear", StringComparison.OrdinalIgnoreCase);

    public static string? Validate(JsonElement? payload, DateTimeOffset now, out JsonElement normalized)
    {
        normalized = default;
        if (payload is not { ValueKind: JsonValueKind.Object } value)
            return "El anuncio requiere un contenido válido.";

        var kind = ReadString(value, "kind");
        var text = ReadString(value, "text")?.Trim();
        var layout = ReadString(value, "layout");
        var theme = ReadString(value, "theme");
        if (kind is not ("message" or "countdown"))
            return "Elegí mensaje o cuenta regresiva.";
        if (string.IsNullOrWhiteSpace(text) || text.Length > 240)
            return "El mensaje debe tener entre 1 y 240 caracteres.";
        if (layout is not ("fullscreen" or "banner"))
            return "Elegí pantalla completa o franja inferior.";
        if (theme is not ("dark" or "light"))
            return "Elegí un fondo oscuro o claro.";

        DateTimeOffset? endsAt = null;
        string? completedText = null;
        if (kind == "countdown")
        {
            completedText = ReadString(value, "completedText")?.Trim();
            if (string.IsNullOrWhiteSpace(completedText) || completedText.Length > 240)
                return "El mensaje al finalizar debe tener entre 1 y 240 caracteres.";

            var hasDuration = value.TryGetProperty("durationSeconds", out var duration);
            var hasDeadline = value.TryGetProperty("endsAt", out var deadline);
            if (hasDuration == hasDeadline)
                return "Indicá una duración o una fecha de finalización, pero no ambas.";
            if (hasDuration)
            {
                if (duration.ValueKind != JsonValueKind.Number || !duration.TryGetInt32(out var seconds) || seconds < 1 || seconds > 604800)
                    return "La duración debe ser de 1 segundo a 7 días.";
                endsAt = now.AddSeconds(seconds);
            }
            else
            {
                var raw = deadline.ValueKind == JsonValueKind.String ? deadline.GetString() : null;
                // Require an explicit offset: a browser-local date must never be interpreted in the server time zone.
                if (raw is null || (!raw.EndsWith('Z') && !(raw.Length >= 6 && raw[^3] == ':' && (raw[^6] == '+' || raw[^6] == '-'))) ||
                    !deadline.TryGetDateTimeOffset(out var parsed) || parsed <= now || parsed > now.AddDays(7))
                    return "La fecha debe incluir zona horaria y estar dentro de los próximos 7 días.";
                endsAt = parsed.ToUniversalTime();
            }
        }

        normalized = JsonSerializer.SerializeToElement(new { kind, text, layout, theme, endsAt, completedText });
        return null;
    }

    private static string? ReadString(JsonElement value, string name) =>
        value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String ? property.GetString() : null;
}
