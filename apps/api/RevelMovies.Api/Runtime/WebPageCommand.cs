using System.Text.Json;

namespace RevelMovies.Api.Runtime;

public static class WebPageCommand
{
    public static bool IsShow(string? type) => string.Equals(type, "webpage.show", StringComparison.OrdinalIgnoreCase);
    public static bool IsClear(string? type) => string.Equals(type, "webpage.clear", StringComparison.OrdinalIgnoreCase);

    public static string? Validate(JsonElement? payload, out JsonElement normalized)
    {
        normalized = default;
        if (payload is not { ValueKind: JsonValueKind.Object } value ||
            !value.TryGetProperty("url", out var property) || property.ValueKind != JsonValueKind.String)
            return "Indicá la URL de la página.";

        var raw = property.GetString()!.Trim();
        if (raw.Length is 0 or > 2048 || raw.Any(char.IsControl) || raw.Contains('\\') ||
            !Uri.TryCreate(raw, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
            string.IsNullOrWhiteSpace(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo))
            return "Usá una URL absoluta HTTP o HTTPS, sin credenciales y de hasta 2048 caracteres.";

        // Only store the address. Revel never fetches or proxies the remote page.
        normalized = JsonSerializer.SerializeToElement(new { url = uri.AbsoluteUri });
        return null;
    }
}
