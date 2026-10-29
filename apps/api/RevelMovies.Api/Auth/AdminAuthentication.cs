using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;

namespace RevelMovies.Api.Auth;

public static class AdminAuthentication
{
    public const string Scheme = "Admin";
    public const string RequestHeader = "X-Revel-Admin";

    public static void AddAdminAuthentication(this IServiceCollection services)
    {
        services.AddSingleton<AdminCredentials>();
        services.AddAuthentication(Scheme).AddCookie(Scheme, options =>
        {
            options.Cookie.Name = "RevelMovies.Admin";
            options.Cookie.Path = "/api";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Strict;
            // Local event installations also run over HTTP. IIS HTTPS sets Secure automatically.
            options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            options.ExpireTimeSpan = TimeSpan.FromHours(8);
            options.SlidingExpiration = false;
            options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
            options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
            options.Events.OnValidatePrincipal = context =>
            {
                var credentials = context.HttpContext.RequestServices.GetRequiredService<AdminCredentials>();
                if (!credentials.IsConfigured || context.Principal?.FindFirstValue("session-version") != credentials.SessionVersion)
                    context.RejectPrincipal();
                return Task.CompletedTask;
            };
        });
        services.AddAuthorization(options => options.FallbackPolicy = new AuthorizationPolicyBuilder(Scheme)
            .RequireAuthenticatedUser().RequireRole(Scheme).Build());
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy("admin-login", context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions
                { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            options.OnRejected = async (context, token) =>
            {
                context.HttpContext.Response.Headers.RetryAfter = "60";
                await context.HttpContext.Response.WriteAsJsonAsync(new { error = "Demasiados intentos. Esperá un minuto y volvé a intentar." }, token);
            };
        });
    }

    public static void UseAdminAuthentication(this WebApplication app)
    {
        app.UseAuthentication();
        app.UseAuthorization();
        app.Use(async (context, next) =>
        {
            var endpoint = context.GetEndpoint();
            var adminRequest = endpoint is not null && (endpoint.Metadata.GetMetadata<IAllowAnonymous>() is null ||
                endpoint.Metadata.GetMetadata<AdminRequest>() is not null);
            if (adminRequest)
            {
                context.Response.Headers.CacheControl = "no-store";
                // A custom header cannot be sent by cross-site forms. CORS only allows the dev
                // frontend, and SameSite=Strict additionally prevents cross-site cookie use.
                if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) &&
                    !HttpMethods.IsOptions(context.Request.Method) && context.Request.Headers[RequestHeader] != "1")
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsJsonAsync(new { error = "La solicitud no proviene del panel. Actualizá la página e intentá de nuevo." });
                    return;
                }
            }
            await next(context);
        });
        app.UseRateLimiter();
    }

    public static void MapAdminAuthentication(this WebApplication app)
    {
        var group = app.MapGroup("/auth");
        group.MapGet("/session", (HttpContext context, AdminCredentials credentials) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var authenticated = context.User.Identity?.IsAuthenticated == true;
            return Results.Ok(new { configured = credentials.IsConfigured, authenticated, username = authenticated ? context.User.Identity!.Name : null });
        }).AllowAnonymous();

        group.MapPost("/login", async (LoginRequest request, HttpContext context, AdminCredentials credentials) =>
        {
            if (!credentials.IsConfigured)
                return Results.Json(new { error = "El acceso al panel todavía no está configurado. Contactá al administrador del servidor." }, statusCode: 503);
            if (!credentials.Validate(request.Username, request.Password))
                return Results.Json(new { error = "Usuario o contraseña incorrectos." }, statusCode: 401);

            var principal = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimTypes.Name, credentials.Username), new Claim(ClaimTypes.Role, Scheme),
                new Claim("session-version", credentials.SessionVersion)
            ], Scheme));
            await context.SignInAsync(Scheme, principal, new AuthenticationProperties { IsPersistent = false });
            return Results.Ok(new { configured = true, authenticated = true, username = credentials.Username });
        }).AllowAnonymous().WithMetadata(new AdminRequest()).RequireRateLimiting("admin-login");

        group.MapPost("/logout", async (HttpContext context) =>
        {
            await context.SignOutAsync(Scheme);
            return Results.NoContent();
        });
    }

    private sealed record AdminRequest;
    public sealed record LoginRequest(string? Username, string? Password);
}

public sealed class AdminCredentials
{
    private readonly PasswordHasher<AdminCredentials> hasher = new();
    private readonly string? passwordHash;
    public string Username { get; }
    public string SessionVersion { get; } = Guid.NewGuid().ToString("N");
    public bool IsConfigured => passwordHash is not null;

    public AdminCredentials(IConfiguration configuration, ILogger<AdminCredentials> logger)
    {
        Username = configuration["AdminAuth:Username"]?.Trim() ?? "admin";
        var password = configuration["AdminAuth:Password"];
        if (Username.Length is > 0 and <= 100 && password?.Length is >= 12 and <= 256 && !string.IsNullOrWhiteSpace(password))
            passwordHash = hasher.HashPassword(this, password);
        else
            logger.LogWarning("Admin access is locked. Configure AdminAuth:Username and AdminAuth:Password (12-256 characters).");
    }

    public bool Validate(string? username, string? password)
    {
        if (passwordHash is null || password is null || password.Length > 256 || username?.Length > 100) return false;
        var validPassword = hasher.VerifyHashedPassword(this, passwordHash, password) != PasswordVerificationResult.Failed;
        return validPassword & string.Equals(username, Username, StringComparison.Ordinal);
    }
}
