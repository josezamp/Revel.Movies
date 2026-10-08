# Announcements and countdowns

## Infrastructure and UX review

The application already has event-scoped displays and groups, a generic SignalR command channel, acknowledgements, server clock sampling, SQL-backed desired playback state and reconnect recovery. The previous admin workflow could only display uploaded images/videos and playlists, so even a short public message required preparing a media file.

Announcements reuse that infrastructure as an independent layer over playback. They do not become playlist items or replace the media playback state. A fullscreen announcement covers the content; a lower banner leaves it visible. In either case, playback continues underneath, including playlist advancement. Clearing the announcement reveals the content at its current position.

The editor at **Admin → Crear anuncio** provides:

- Messages or countdowns, with a shared player/preview renderer.
- A duration (0.1–10,080 minutes in the UI) or an explicit local date/time within the next seven days.
- A persistent completion message when the countdown reaches zero.
- Fullscreen/banner layouts, dark/light backgrounds and a portrait preview.
- Display or group targeting, empty-group handling, offline/blackout notices and inline request feedback.
- The currently assigned announcement per selected display, refreshed by the admin's existing polling.

The duration preview shows the configured starting value. Actual countdowns start when the server accepts the command. Date/time input uses the operator's browser time zone (shown next to the field) and is sent as UTC. Screen orientation follows each display's existing rotation setting.

## Command contract

Use the existing endpoints:

- `POST /api/displays/{displayId}/commands`
- `POST /api/display-groups/{groupId}/commands`

Show a message:

```json
{
  "type": "announcement.show",
  "payload": {
    "kind": "message",
    "text": "Bienvenidos al evento",
    "layout": "banner",
    "theme": "dark"
  }
}
```

Show a countdown:

```json
{
  "type": "announcement.show",
  "payload": {
    "kind": "countdown",
    "text": "Comenzamos pronto",
    "layout": "fullscreen",
    "theme": "light",
    "durationSeconds": 300,
    "completedText": "¡Comenzamos!"
  }
}
```

For a fixed deadline, replace `durationSeconds` with an ISO-8601 `endsAt` containing `Z` or an explicit UTC offset. Provide exactly one of the two. The API accepts integer durations from 1 to 604,800 seconds. Both text fields require 1–240 characters after trimming. Layout, theme, dates and payload types are validated before dispatch. Text is rendered as React text, never HTML.

The server replaces the duration with one absolute `endsAt` for the entire dispatch. Every group member receives the same deadline. Players compute remaining seconds from their synchronized server clock, clamp the value at zero and show `completedText` indefinitely after completion. A disconnected but still-open player continues counting locally. A reloaded player recovers its announcement once it reconnects; a reload without any connection cannot recover it.

Clear an announcement:

```json
{ "type": "announcement.clear" }
```

Showing an announcement replaces the previous one on each target. Clearing affects only the announcement. Play, pause and stop affect media independently. Blackout hides the announcement and preserves it; starting media/playlist playback exits the existing blackout mode. Identify continues to appear above announcements.

## Persistence and delivery

`display_playback_states.announcement_json` stores the normalized payload separately from `payload_json`. The state is saved before SignalR dispatch, included in `GetDesiredPlaybackState`, and exposed as `announcement` in display responses. Clearing persists `null`, so a cleared announcement does not reappear after reconnecting. A newer live announcement command takes precedence over an older in-flight recovery response.

Group targets are resolved at dispatch time; adding a member later does not copy previous announcements to it. The existing `received`/`executed`/`error` acknowledgement flow is reused. HTTP 202 means accepted and persisted, not proof of visible delivery. The admin labels saved state accordingly; per-device acknowledgement details remain available in player diagnostics.

## Deployment and verification

Deploy the API and web player together. Migration `20261008120000_AddAnnouncements` adds one nullable column, preserving existing playback rows. With `Database:ApplyMigrationsOnStartup=true` it runs on API startup. If automatic migrations are disabled, apply it through the normal EF migration process before starting the new API. Older players do not render these commands and need a reload after the frontend update.

```powershell
dotnet test apps/api/RevelMovies.Api.Tests/RevelMovies.Api.Tests.csproj
npm --prefix apps/web test
npm --prefix apps/web run build
```

The frontend tests use Node's built-in test runner and TypeScript stripping (Node 22.6+). API tests use an isolated in-memory provider, covering validation, shared group deadlines, persisted recovery, clear/playback isolation and empty groups. SQL Server migration and live SignalR delivery should also be smoke-tested in a disposable database before deployment.

This implementation was verified with 40 passing API tests, three passing frontend tests and a production frontend build. A separate SQL Server test database also verified the migration and live browser flows: countdown delivery, reload without resetting the deadline, completion text, banner replacement, blackout, clear with media continuing, clear surviving reload, multiline fitting, mobile layout and display rotation. The uploaded test media was deleted through the API afterward. Automatic approval review blocked the environment cleanup command; the test database `Revel.Movies.Announcements.QA.20261008` remains separate from the application's normal database.

## Remaining improvements

- Admin authentication/authorization is absent from the existing control API. Add event-scoped operator access before exposing administration beyond a trusted network.
- Surface per-device acknowledgement and player version in the admin so an operator can distinguish saved state, delivery and unsupported players without opening diagnostics.
- The current SignalR deployment uses a single process, without a configured backplane. Multiple API instances would need shared message delivery and ordering.
- Saved announcement templates, automatic start schedules and automatic dismissal are future extensions; this version sends immediately and keeps the announcement until explicitly replaced or cleared.
- The current .NET restore reports pre-existing NU1903 advisories for the transitive `System.Security.Cryptography.Xml` 9.0.0 package. Dependency remediation remains separate from this feature.
