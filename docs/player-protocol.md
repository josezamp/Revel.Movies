# Player protocol

The SignalR hub exposes a generic `command` event rather than one hub method per command.

```json
{
  "protocolVersion": 1,
  "commandId": "287ce04a-0000-0000-0000-000000000000",
  "type": "display.blackout",
  "issuedAt": "2026-09-15T15:30:00Z",
  "payload": null
}
```

## Bootstrap commands

- `player.reload`
- `system.refresh`
- `display.blackout`
- `display.identify`
- `display.unpaired`
- `media.play`
- `media.pause`
- `media.stop`

`media.play` accepts a `payload.mediaId` from the event's Media Library. The server prepares the asset and sends its type and synchronized `startAt` to the player.

Deleting a paired display through `DELETE /api/displays/{displayId}` removes its group memberships, pairing sessions, playback state and acknowledgements. Its device token is no longer valid. Events, media, playlists and groups remain available.

After deletion, `display.unpaired` tells connected players to stop playback, clear their saved identity and announcements, and request a new pairing code. This command is not acknowledged because the display no longer exists. Offline players detect the revoked identity when they reconnect; existing hub connections are also checked on heartbeat and telemetry calls.

## Announcements

- `announcement.show`: show a message or synchronized countdown over the current content.
- `announcement.clear`: remove the announcement while media playback continues.

See [Announcements and countdowns](announcements.md) for payloads, validation, persistence and blackout behavior.

## Promotional breaks

- `promotions.configure`: apply a per-display rule for inserting promotion videos between completed playlist videos.
- `ReportPlaylistPlayback`: report playlist position and promotion progress together for recovery.

Configure through the event promotional-breaks endpoint, not the generic commands endpoint. See [Promotional breaks](promotional-breaks.md) for targeting, frequency, recovery and deployment.

## Compatibility rule

Players must ignore command types they do not understand. The protocol version exists from the first release because Players may remain deployed without being upgraded for long periods.
