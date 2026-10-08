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
- `media.play`
- `media.pause`
- `media.stop`

`media.play` accepts a `payload.mediaId` from the event's Media Library. The server prepares the asset and sends its type and synchronized `startAt` to the player.

## Announcements

- `announcement.show`: show a message or synchronized countdown over the current content.
- `announcement.clear`: remove the announcement while media playback continues.

See [Announcements and countdowns](announcements.md) for payloads, validation, persistence and blackout behavior.

## Compatibility rule

Players must ignore command types they do not understand. The protocol version exists from the first release because Players may remain deployed without being upgraded for long periods.
