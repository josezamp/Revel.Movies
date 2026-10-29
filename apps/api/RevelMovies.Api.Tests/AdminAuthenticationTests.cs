using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RevelMovies.Api.Auth;
using RevelMovies.Api.Hubs;
using Xunit;

namespace RevelMovies.Api.Tests;

public sealed class AdminAuthenticationTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Login_session_and_logout_work_with_kestrel_and_iis_path_base(bool iis)
    {
        await using var factory = new AuthFactory(iis);
        using var client = factory.CreateClient();
        var anonymous = await client.GetFromJsonAsync<JsonElement>("/api/auth/session");
        Assert.False(anonymous.GetProperty("authenticated").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/events")).StatusCode);
        client.DefaultRequestHeaders.Add(AdminAuthentication.RequestHeader, "1");
        using var invalid = await client.PostAsJsonAsync("/api/auth/login", new { username = "test-admin", password = "wrong" });
        Assert.Equal(HttpStatusCode.Unauthorized, invalid.StatusCode);
        Assert.False(invalid.Headers.Contains("Set-Cookie"));
        using var login = await Login(client);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var cookie = Assert.Single(login.Headers.GetValues("Set-Cookie"));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.True(login.Headers.CacheControl?.NoStore);
        var session = await client.GetFromJsonAsync<JsonElement>("/api/auth/session");
        Assert.True(session.GetProperty("authenticated").GetBoolean());
        Assert.Equal("test-admin", session.GetProperty("username").GetString());
        // Invalid input reaches the handler without requiring SQL Server.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/events", new { name = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/events")).StatusCode);
        Assert.False((await client.GetFromJsonAsync<JsonElement>("/api/auth/session")).GetProperty("authenticated").GetBoolean());
    }

    [Theory]
    [InlineData("GET", "/api/events")]
    [InlineData("GET", "/api/events/11111111-1111-1111-1111-111111111111/map")]
    [InlineData("PUT", "/api/events/11111111-1111-1111-1111-111111111111/map")]
    [InlineData("GET", "/api/displays")]
    [InlineData("GET", "/api/pairing/pending")]
    [InlineData("POST", "/api/displays/pair")]
    [InlineData("POST", "/api/displays/11111111-1111-1111-1111-111111111111/commands")]
    [InlineData("DELETE", "/api/displays/11111111-1111-1111-1111-111111111111")]
    [InlineData("POST", "/api/events/11111111-1111-1111-1111-111111111111/media")]
    [InlineData("GET", "/api/media/11111111-1111-1111-1111-111111111111")]
    [InlineData("DELETE", "/api/media/11111111-1111-1111-1111-111111111111")]
    [InlineData("POST", "/api/media/11111111-1111-1111-1111-111111111111/tv-optimization")]
    [InlineData("POST", "/api/events/11111111-1111-1111-1111-111111111111/media-cleanup")]
    [InlineData("POST", "/api/events/11111111-1111-1111-1111-111111111111/scenes")]
    [InlineData("GET", "/api/events/11111111-1111-1111-1111-111111111111/scene-sessions")]
    [InlineData("GET", "/api/events/11111111-1111-1111-1111-111111111111/schedule")]
    [InlineData("POST", "/api/events/11111111-1111-1111-1111-111111111111/schedule")]
    [InlineData("PUT", "/api/events/11111111-1111-1111-1111-111111111111/schedule/22222222-2222-2222-2222-222222222222")]
    [InlineData("POST", "/api/events/11111111-1111-1111-1111-111111111111/schedule/22222222-2222-2222-2222-222222222222/cancel")]
    [InlineData("POST", "/api/scene-sessions/11111111-1111-1111-1111-111111111111/restore")]
    [InlineData("POST", "/api/playlists/11111111-1111-1111-1111-111111111111/play")]
    [InlineData("POST", "/api/display-groups/11111111-1111-1111-1111-111111111111/commands")]
    [InlineData("PUT", "/api/events/11111111-1111-1111-1111-111111111111/promotional-breaks")]
    public async Task Admin_routes_reject_anonymous_requests(string method, string path)
    {
        await using var factory = new AuthFactory();
        using var client = factory.CreateClient();
        using var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Null(response.Headers.Location);
    }

    [Fact]
    public async Task Login_and_authenticated_writes_require_the_custom_csrf_header()
    {
        await using var factory = new AuthFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Forbidden, (await Login(client)).StatusCode);
        client.DefaultRequestHeaders.Add(AdminAuthentication.RequestHeader, "1");
        (await Login(client)).EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Remove(AdminAuthentication.RequestHeader);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/events", new { name = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/events/11111111-1111-1111-1111-111111111111/media", new MultipartFormDataContent())).StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("short")]
    public async Task Missing_or_weak_configuration_locks_the_admin_but_keeps_player_transport_available(string password)
    {
        await using var factory = new AuthFactory(password: password);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(AdminAuthentication.RequestHeader, "1");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Login(client)).StatusCode);
        Assert.False((await client.GetFromJsonAsync<JsonElement>("/api/auth/session")).GetProperty("configured").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/events")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/hubs/player/negotiate?negotiateVersion=1", null)).StatusCode);
    }

    [Fact]
    public async Task Login_attempts_are_limited()
    {
        await using var factory = new AuthFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(AdminAuthentication.RequestHeader, "1");
        for (var i = 0; i < 10; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/login", new { username = "no", password = "wrong" })).StatusCode);
        using var limited = await Login(client);
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.NotNull(limited.Headers.RetryAfter);
    }

    [Fact]
    public async Task Https_login_sets_a_secure_cookie()
    {
        await using var factory = new AuthFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        client.DefaultRequestHeaders.Add(AdminAuthentication.RequestHeader, "1");
        using var response = await Login(client);
        response.EnsureSuccessStatusCode();
        Assert.Contains("secure", Assert.Single(response.Headers.GetValues("Set-Cookie")), StringComparison.OrdinalIgnoreCase);
    }

    private static Task<HttpResponseMessage> Login(HttpClient client) => client.PostAsJsonAsync("/api/auth/login",
        new { username = AuthenticatedApiFactory.Username, password = AuthenticatedApiFactory.Password });

    [Fact]
    public async Task Session_expires_after_eight_hours_even_when_the_admin_is_active()
    {
        var clock = new TestClock();
        await using var factory = new AuthFactory(clock: clock);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(AdminAuthentication.RequestHeader, "1");
        (await Login(client)).EnsureSuccessStatusCode();
        clock.Now += TimeSpan.FromHours(7);
        Assert.True((await client.GetFromJsonAsync<JsonElement>("/api/auth/session")).GetProperty("authenticated").GetBoolean());
        clock.Now += TimeSpan.FromHours(2);
        Assert.False((await client.GetFromJsonAsync<JsonElement>("/api/auth/session")).GetProperty("authenticated").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/events", new { name = "" })).StatusCode);
    }

    [Fact]
    public async Task Restart_and_credential_changes_reject_old_session_cookies()
    {
        await using var first = new AuthFactory();
        using var client = first.CreateClient();
        client.DefaultRequestHeaders.Add(AdminAuthentication.RequestHeader, "1");
        using var login = await Login(client);
        var cookie = Assert.Single(login.Headers.GetValues("Set-Cookie")).Split(';')[0];
        await using var second = new AuthFactory(password: "Changed-test-password!");
        using var afterRestart = second.CreateClient();
        afterRestart.DefaultRequestHeaders.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await afterRestart.GetAsync("/api/events")).StatusCode);
    }

    private sealed class TestClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class AuthFactory(bool iis = false, string password = AuthenticatedApiFactory.Password, TimeProvider? clock = null) : WebApplicationFactory<PlayerHub>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:ApplyMigrationsOnStartup"] = "false",
                ["AdminAuth:Username"] = AuthenticatedApiFactory.Username,
                ["AdminAuth:Password"] = password,
                ["Logging:LogLevel:Default"] = "Warning"
            }));
            if (iis) builder.ConfigureServices(services => services.AddSingleton<IStartupFilter, IisPathBase>());
            if (clock is not null) builder.ConfigureServices(services => services.Configure<CookieAuthenticationOptions>(
                AdminAuthentication.Scheme, options => options.TimeProvider = clock));
        }
    }

    private sealed class IisPathBase : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (context, nextMiddleware) =>
            {
                if (context.Request.Path.StartsWithSegments("/api", out var remaining))
                { context.Request.PathBase = "/api"; context.Request.Path = remaining; }
                await nextMiddleware(context);
            });
            next(app);
        };
    }
}
