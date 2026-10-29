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

The API emits `public, no-cache` with a content checksum ETag for `/api/media/{id}/content`, so replaced or optimized content can be revalidated.

### Video buffering

The video element requests `preload="auto"`. Before starting or resuming after a stall, the Player waits for 15 seconds of contiguous buffered video at the current position (or the remaining duration for shorter clips). This also applies to network playback for files above the full-file cache limit and on devices without Service Workers.

Native browser buffers cannot be assigned a fixed size. After 15 seconds of waiting, the Player requests playback even if the browser has not finished loading playable data or seeking. This lets TVs that limit preloading while paused finish loading through their native playback pipeline. Subsequent waiting and seeking events keep reporting `Buffering` but no longer pause the video to rebuild the reserve. Operator pause, stop or media replacement cancel this buffer session; a new session can use the reserve again. These defaults are `playbackBufferSeconds` and `maxBufferWaitMs` in `apps/web/src/player/videoBuffer.ts`. Slow connections can still stall if their sustained throughput is below the video's bitrate.

While waiting, telemetry reports `Buffering`. The server keeps the desired playback clock but does not request drift correction in this state. Once playback resumes, the Player only applies corrections whose destination has the same buffer reserve. Late telemetry responses from a previous video or playback control are ignored. A slow device can start later or stay behind the group until a safe correction is possible.

Preparation commands share in-flight downloads per URL, and the play command does not start a second cache download. Cache writes consume the response directly to avoid retaining an unread copy of a large video in memory.

### Upcoming playlist videos

While a playlist runs, the Player keeps native video elements for up to two distinct upcoming videos, in addition to the current video. Lookahead follows playlist order, skips images, wraps looping playlists and includes promotional breaks. Repeated media IDs share an element. Recovery and changes to the playlist or promotion policy recalculate this window.

New background requests start after the current video begins playing (or the current image loads). Upcoming elements stay hidden, muted and paused, and retain their buffered data when they become active. This works with ordinary HTTP media URLs, including LAN Players without Service Workers and videos larger than the full-file cache limit. It complements the existing preparation cache; native preload remains a browser hint, so TV memory limits and network throughput can still delay transitions.

Stopping, replacing or finishing a playlist releases obsolete elements and their sources. A background load error does not interrupt the current video; the Player retries the source when it becomes active. Browser tests in `tests/browser/playlistPreload.spec.ts` verify native preloading and element reuse with Service Workers disabled.

### Automatic video recovery

Normal videos, both standalone and within playlists, are monitored for position progress. After 30 seconds without progress (including a stalled initial load), the Player attempts `play()` once without the buffer reserve gate. If another 30 seconds pass without progress, it reloads the same video element and seeks to its saved position after metadata loads. At most two reloads are attempted, each with a 30-second deadline. If recovery still fails, playback pauses and telemetry reports `Error`; console diagnostics include the media ID and failure. Autoplay-policy or unsupported-source errors from the recovery play attempt stop recovery immediately. Thirty seconds of sustained playback replenish the recovery budget.

Operator pause, stop and media replacement cancel recovery immediately, including pending buffer callbacks and native play requests. A pending seek remains the position checkpoint while `load()` temporarily resets `currentTime` to zero. If paused during reload, metadata may restore that position but cannot start playback. The API stores the actual paused position only from telemetry correlated with the current command, revision and assigned content, so manual resume and reconnect preserve the confirmed checkpoint. Existing promotion timeout/skip behavior is unchanged.

Recovery requires the page's JavaScript timers to remain responsive; it cannot restart a completely frozen browser or TV. Validate on the target Samsung model with network interruptions, rotation, pause during reload, playlist transitions and repeated stalls. Browser regression tests in `tests/browser/videoRecovery.spec.ts` use a real MP4 and SignalR with simulated decoder stalls; they require FFmpeg on PATH or `REVEL_TEST_FFMPEG` pointing to the executable.

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

Single-video playback uses drift correction with a 500 ms threshold, subject to the buffer checks above. Real-TV testing should include high-bitrate clips, network throttling, pause/resume during buffering, and switching videos while telemetry is in flight.
