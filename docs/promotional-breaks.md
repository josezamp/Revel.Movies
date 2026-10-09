# Promotional breaks

In **Admin → Cortes promocionales**, choose a display or group, a playlist containing only promotion videos, and a frequency of 1–100 completed main videos. Click **Aplicar cortes**. One promotion plays per break, rotating through the selected playlist in order.

## Playback behavior

- Applying a rule does not restart or interrupt the current video. Counting begins with video endings after the player receives the rule. Images and promotions do not count.
- After a promotion, the next main playlist item plays. The counter and promotion rotation survive the main playlist wrapping. An eligible final video in a non-looping playlist gets its promotion before playback ends.
- Each display has one saved rule and its own counter. Applying another rule replaces it and resets the counter and rotation. An active promotion still finishes first.
- **Desactivar cortes** prevents future breaks and lets an active promotion finish. Pause/resume also works during a promotion. Explicit stop, new playback and unpairing cancel the current playback normally.
- Rules persist per display. Starting or restarting a playlist resets its progress; playing an individual media asset does not insert promotions. Announcements and blackout retain their independent behavior.
- Groups target their current members at dispatch time. Later membership changes do not copy or remove previously assigned rules. Overlapping groups do not stack rules: the latest applied configuration wins per display.
- The promotion playlist is resolved to an ordered snapshot when applied. Apply again after editing it. Its loop setting is ignored; promotion rotation always wraps.
- The player prepares promotion assets using the existing media cache. A decode/load error skips the promotion. Thirty seconds without playback progress also skips it; the watchdog is suspended while paused. The next break attempts the next promotion.
- This is per-player insertion at video boundaries, not a guarantee of simultaneous breaks across televisions.

## API

`PUT /api/events/{eventId}/promotional-breaks`

```json
{
  "targetType": "group",
  "targetId": "<display-group-id>",
  "enabled": true,
  "playlistId": "<promotion-playlist-id>",
  "everyVideos": 5
}
```

Use `targetType: "display"` for an individual screen. To disable, send the target and `enabled: false`; playlist and frequency are unnecessary. The API validates event ownership, nonempty groups, frequency and a nonempty video-only promotion playlist before saving or dispatching. It returns HTTP 202 with the command and number of targeted displays. Acceptance means saved and dispatched, not confirmed on-screen delivery. Generic command endpoints reject `promotions.*` so callers cannot bypass validation.

The saved `promotionPolicy` is included in display responses. Players receive `promotions.configure` via the existing SignalR channel and acknowledge it. Offline screens recover the saved rule when reconnecting.

## Recovery and compatibility

`display_playback_states.promotion_policy_json` stores the independent rule; `promotion_progress_json` stores its playback session, policy ID, completed-video counter, next promotion index, active promotion ID and sequence number. The normal playlist index remains on the completed main item during a promotion, so returning advances exactly once.

`playlist.play` includes a unique `playbackId`. `ReportPlaylistPlayback` writes the cursor and normal telemetry together. Stale sessions, policies and sequence numbers are ignored. The old `ReportPlayback` method remains available for existing clients and individual media playback.

Players checkpoint locally at transitions and every three seconds, including while disconnected. Recovery selects a newer local checkpoint only for the same playback session, otherwise uses SQL. Replacing or disabling the rule retains an active promotion while resetting the future counter. Restart creates a new session to prevent a local checkpoint from restoring stopped content. Position recovery can replay up to approximately three seconds; it does not assume videos continued during a reload. Reloading still requires the initial server connection. An open disconnected player continues using its received rule and available media.

Deploy API and frontend together, then reload players. Migration `20261009120000_AddPromotionalBreaks` adds two nullable columns without changing existing playback or announcement data. It runs at startup when `Database:ApplyMigrationsOnStartup` is enabled; otherwise apply it before starting the API. Older players ignore the new command and do not insert promotions.

## Verification

```powershell
dotnet test apps/api/RevelMovies.Api.Tests/RevelMovies.Api.Tests.csproj
npm --prefix apps/web test
npm --prefix apps/web run build
```

Tests cover rotation across loops, image exclusion, final breaks, disabling/replacing during a promotion, recovery selection, corrupt checkpoints, target isolation, validation, group membership snapshots, pause/resume, stopped-session rejection, stale telemetry, and SQL Server migration/model consistency.

The implementation was also checked against an isolated SQL Server database with generated MP4s and a real browser: group configuration, alternating promotions, continuing the correct main item, disable during a promotion, reload and pause/reload during a promotion, non-looping completion, skipping a damaged MP4, and the admin layout at desktop and 390 px widths. Television hardware and simultaneous breaks across multiple physical TVs were not tested.

Validation completed with 84 API tests, 29 frontend tests, and a production frontend build. The existing transitive `System.Security.Cryptography.Xml` 9.0.0 dependency continues to emit NU1903 warnings.

The test servers were stopped. Automatic approval review rejected the cleanup command as "blocked by policy", so the isolated database `Revel.Movies.Promotions.QA.20261009_448c` and generated fixtures in `C:\Users\josez\AppData\Local\Temp\RevelMovies-Promotions-QA-448c` remain available. The normal application database was not used for this verification.
