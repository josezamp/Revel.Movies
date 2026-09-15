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

`media.play` currently accepts a `payload.url` as a temporary bootstrap mechanism. Media IDs and the Media Library will replace direct URLs in the next slice.

## Compatibility rule

Players must ignore command types they do not understand. The protocol version exists from the first release because Players may remain deployed without being upgraded for long periods.
