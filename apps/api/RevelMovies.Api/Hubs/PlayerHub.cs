using Microsoft.AspNetCore.SignalR;
using RevelMovies.Api.Runtime;

namespace RevelMovies.Api.Hubs;

public sealed class PlayerHub(DisplayRegistry registry) : Hub
{
    private const string DisplayIdItemKey = "display-id";

    public override async Task OnConnectedAsync()
    {
        var token = Context.GetHttpContext()?.Request.Query["deviceToken"].ToString();
        var display = await registry.AuthenticateAsync(token, Context.ConnectionAborted);

        if (display is null)
        {
            Context.Abort();
            return;
        }

        Context.Items[DisplayIdItemKey] = display.Id;
        await registry.SetOnlineAsync(display.Id, Context.ConnectionAborted);

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(display.Id), Context.ConnectionAborted);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items.TryGetValue(DisplayIdItemKey, out var value) && value is Guid displayId)
            await registry.SetOfflineAsync(displayId);

        await base.OnDisconnectedAsync(exception);
    }

    public async Task Heartbeat()
    {
        if (Context.Items.TryGetValue(DisplayIdItemKey, out var value) && value is Guid displayId)
            await registry.HeartbeatAsync(displayId, Context.ConnectionAborted);
    }

    public static string GroupName(Guid displayId) => $"display:{displayId:N}";
}
