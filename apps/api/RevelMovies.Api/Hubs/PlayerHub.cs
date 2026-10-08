using Microsoft.AspNetCore.SignalR;
using RevelMovies.Api.Runtime;

namespace RevelMovies.Api.Hubs;

public sealed class PlayerHub(
    DisplayRegistry registry,
    CommandAcknowledgementRegistry acknowledgementRegistry,
    PlaybackStateRegistry playbackStateRegistry) : Hub
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
        if (await GetDisplayIdAsync() is { } displayId)
            await registry.HeartbeatAsync(displayId, Context.ConnectionAborted);
    }

    public long GetServerTime() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public async Task ReportClockSample(double clockOffsetMs, double roundTripMs)
    {
        if (await GetDisplayIdAsync() is { } displayId)
            await registry.UpdateClockSampleAsync(displayId, clockOffsetMs, roundTripMs, Context.ConnectionAborted);
    }

    public async Task<PlaybackRecoveryState?> GetDesiredPlaybackState()
    {
        if (await GetDisplayIdAsync() is not { } displayId)
            return null;

        return await playbackStateRegistry.GetRecoveryAsync(displayId, Context.ConnectionAborted);
    }

    public async Task<PlaybackReportResult?> ReportPlayback(
        string state,
        Guid? mediaAssetId,
        Guid? playlistId,
        int? playlistIndex,
        double positionSeconds,
        double? durationSeconds)
    {
        if (await GetDisplayIdAsync() is not { } displayId)
            return null;

        return await playbackStateRegistry.ReportAsync(
            displayId,
            new PlaybackTelemetryReport(state, mediaAssetId, playlistId, playlistIndex, positionSeconds, durationSeconds),
            Context.ConnectionAborted);
    }

    public async Task Acknowledge(
        Guid commandId,
        string commandType,
        string status,
        string? detail,
        long? clientUnixTimeMs)
    {
        if (await GetDisplayIdAsync() is not { } displayId || commandId == Guid.Empty || string.IsNullOrWhiteSpace(status))
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

    private async Task<Guid?> GetDisplayIdAsync()
    {
        if (Context.Items.TryGetValue(DisplayIdItemKey, out var value) && value is Guid id &&
            await registry.GetDisplayAsync(id, Context.ConnectionAborted) is not null)
            return id;

        // A connection may outlive its pairing. Do not accept further telemetry.
        Context.Abort();
        return null;
    }

    public static string GroupName(Guid displayId) => $"display:{displayId:N}";
}
