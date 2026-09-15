using Microsoft.AspNetCore.SignalR;
using RevelMovies.Api.Runtime;

namespace RevelMovies.Api.Hubs;

public sealed class PlayerHub(DisplayRegistry registry) : Hub
{
    private const string DisplayIdItemKey = "display-id";

    public override async Task OnConnectedAsync()
    {
        var token = Context.GetHttpContext()?.Request.Query["deviceToken"].ToString();
        var display = registry.Authenticate(token);

        if (display is null)
        {
            Context.Abort();
            return;
        }

        Context.Items[DisplayIdItemKey] = display.Id;
        registry.SetOnline(display.Id);

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(display.Id));
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items.TryGetValue(DisplayIdItemKey, out var value) && value is Guid displayId)
            registry.SetOffline(displayId);

        await base.OnDisconnectedAsync(exception);
    }

    public Task Heartbeat()
    {
        if (Context.Items.TryGetValue(DisplayIdItemKey, out var value) && value is Guid displayId)
            registry.Heartbeat(displayId);

        return Task.CompletedTask;
    }

    public static string GroupName(Guid displayId) => $"display:{displayId:N}";
}
