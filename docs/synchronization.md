# Playback synchronization and resilience

Revel Movies uses a server-authoritative start time to coordinate playback across Players without assuming their operating-system clocks are identical.

## Clock estimation

After SignalR connects, a Player takes three clock samples and keeps the sample with the lowest round-trip time (RTT). The offset is estimated as:

```text
clockOffset = serverTime - midpoint(localRequestStart, localResponseEnd)
```

The selected offset and RTT are reported to the API and persisted on the Display. A new sample is taken every minute.

## Synchronized start

For media and playlists, the API sends two commands:

```text
prepare -> immediately
play    -> startAt = server UTC + Playback:SyncLeadTimeMs
```

The default lead time is 2000 ms and can be changed with:

```text
Playback__SyncLeadTimeMs=3000
```

Each Player converts the server `startAt` to its local clock using its measured offset and schedules playback locally.

This is intended to produce closely coordinated starts on a normal LAN. It is not frame-lock/genlock and does not guarantee frame-perfect synchronization between different TV/browser hardware.

## Media preparation and cache

The Player registers a Service Worker when the browser supports it and the page is running in a secure context (HTTPS or localhost).

`media.prepare` and `playlist.prepare` ask the Player to cache eligible media before playback. Assets up to 256 MB are cached by the current browser implementation. Cached MP4 responses support HTTP Range reads through the Service Worker.

When Service Workers are unavailable (for example, an older Smart TV or plain HTTP on a LAN IP), playback falls back to the normal network URL. Cache support is never required for playback.

The API also emits long-lived immutable cache headers for `/api/media/{id}/content`, since a MediaAsset ID points to immutable binary content.

## Command acknowledgements

Players report command lifecycle acknowledgements over SignalR:

- `received`: command reached the Player.
- `ready`: payload is valid/scheduled, or preparation completed.
- `executed`: the requested action was applied.
- `error`: the Player rejected or failed the action.

Recent acknowledgements are available on `/player/diagnostics`.

## Diagnostics

Open:

```text
/player/diagnostics
```

The page shows:

- Display identity/status
- clock offset
- RTT
- last clock synchronization time
- last heartbeat/presence time
- cached media count
- Service Worker/cache availability
- recent command acknowledgements

## Suggested two-display test

1. Pair two Players to the same Event.
2. Put both Players in one Display Group.
3. Keep `/player/diagnostics` open in separate tabs/devices if practical.
4. Play the same short MP4 to the group repeatedly.
5. Compare the visible starts and each Display's RTT/offset.
6. Try `Playback:SyncLeadTimeMs` at 2000, 3000 and 5000 ms if preparation/network latency is high.
7. Test a playlist with video -> image -> video.
8. Disable HTTPS/use a browser without Service Worker and confirm playback still works through network fallback.

The next synchronization refinement, if needed after real-TV testing, should be drift correction during long videos and/or late-start catch-up by seeking to the expected playback position.
