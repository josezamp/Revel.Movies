using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using RevelMovies.Api.Auth;
using RevelMovies.Api.Hubs;

namespace RevelMovies.Api.Tests;

// Existing behavior tests exercise the real login flow before using admin endpoints.
public abstract class AuthenticatedApiFactory : WebApplicationFactory<PlayerHub>
{
    public const string Username = "test-admin";
    public const string Password = "Test-only-password-2026!";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AdminAuth:Username"] = Username,
            ["AdminAuth:Password"] = Password
        }));
    }

    public new HttpClient CreateClient()
    {
        var client = base.CreateClient();
        client.DefaultRequestHeaders.Add(AdminAuthentication.RequestHeader, "1");
        using var response = client.PostAsJsonAsync("/api/auth/login", new { username = Username, password = Password }).GetAwaiter().GetResult();
        response.EnsureSuccessStatusCode();
        return client;
    }
}
