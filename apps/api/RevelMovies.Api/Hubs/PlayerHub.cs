using Microsoft.AspNetCore.SignalR;
using RevelMovies.Api.Runtime;

namespace RevelMovies.Api.Hubs;

public sealed class PlayerHub(
    DisplayRegistry registry,
    CommandAcknowledgementRegistry acknowledgementRegistry) : Hub
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
        if (TryGetDisplayId(out var displayId))
            await registry.HeartbeatAsync(displayId, Context.ConnectionAborted);
    }

    public long GetServerTime() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public async Task ReportClockSample(double clockOffsetMs, double roundTripMs)
    {
        if (TryGetDisplayId(out var displayId))
            await registry.UpdateClockSampleAsync(displayId, clockOffsetMs, roundTripMs, Context.ConnectionAborted);
    }

    public async Task Acknowledge(
        Guid commandId,
        string commandType,
        string status,
        string? detail,
        long? clientUnixTimeMs)
    {
        if (!TryGetDisplayId(out var displayId) || commandId == Guid.Empty || string.IsNullOrWhiteSpace(status))
            return;

        DateTimeOffset? clientTimestamp = null;
        if (clientUnixTimeMs.HasValue)
        {
            try
            {
                clientTimestamp = DateTimeOffset.FromUnixTimeMilliseconds(clientUnixTimeMs.Value);
            }
            catch (ArgumentOutOfRangeException)
            {
                clientTimestamp = null;
            }
        }

        await acknowledgementRegistry.RecordAsync(
            displayId,
            commandId,
            commandType ?? string.Empty,
            status,
            detail,
            clientTimestamp,
            Context.ConnectionAborted);
    }

    private bool TryGetDisplayId(out Guid displayId)
    {
        if (Context.Items.TryGetValue(DisplayIdItemKey, out var value) && value is Guid id)
        {
            displayId = id;
            return true;
        }

        displayId = Guid.Empty;
        return false;
    }

    public static string GroupName(Guid displayId) => $"display:{displayId:N}";
}
