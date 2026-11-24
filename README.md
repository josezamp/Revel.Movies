# Revel Movies

A browser-first multi-screen media orchestration platform for events and digital signage.

Revel Movies turns browser-capable devices into remotely controlled media players. It is designed for Smart TVs, PCs, Raspberry Pi devices, Android boxes, notebooks, and similar hardware.

## Stack

- .NET 10 / ASP.NET Core
- SignalR
- Entity Framework Core
- SQL Server
- React + TypeScript + Vite
- Local filesystem media storage through an abstraction designed for future object-storage providers
- IIS for the primary Windows Server deployment
- Docker / Docker Compose as an optional local or portable deployment path

## Current vertical slice

Revel Movies currently supports:

- Password-protected administration with a server-configured account and a 7-day session; see [administrator setup](docs/deployment.md#administrator-login)
- Events persisted in SQL Server
- Display pairing with persistent device identity
- Online/offline presence through SignalR and heartbeat
- Video and image upload per Event
- Saved website links in the event library, with an Enlace badge, URL search, and display/group projection
- Media metadata persisted in SQL Server while binary files remain in media storage
- MP4, JPG/JPEG, PNG, WEBP and GIF validation
- Automatic background optimization on upload, enabled by default in the UI: smaller MP4 videos up to 1080p/30 FPS with audio, replacing the uploaded file after validation; switch off to keep originals. Manual TV copies remain available; see [FFmpeg setup](docs/ffmpeg-tv.md)
- Remote playback by `mediaId`
- Play, pause, stop, blackout, identify and player reload commands
- Per-display audio settings, with persisted mute and local audio activation when the browser requires it
- Byte-range media responses for browser video seeking/playback
- Web pages by URL on paired displays or groups, with persisted reconnect recovery
- Live messages and synchronized countdown announcements for displays or groups, with preview and reconnect recovery
- Live display cards with correlated playback reports, layered content, stale-state indicators and offline-safe renaming
- Per-event floor plans in Live, with shapes, labels, draggable displays, versioned server saves and separate editing/operation modes
- Event scenes with persisted versions, per-screen preparation and activation, explicit layer policies and guarded temporary restoration
- Per-event scene schedules with explicit dates and time zones, automatic server-side preparation, and per-screen execution history; see [scheduling](docs/scheduling.md)
- ChatGPT-ready event context and JSON import of scenes and schedules, with preview, atomic saving and duplicate protection; see [schedule import (Spanish)](docs/schedule-import.md)
- Mobile operation navigation, explicit destinations, playlist publishing and multiple-file upload queues with local previews

See the [operator guide (Spanish)](docs/operator-guide.md) for the live / scenes / content / configuration workflow and the [scene protocol](docs/scenes.md) for persistence, preparation and recovery semantics.

See [Announcements and countdowns](docs/announcements.md) for usage, protocol, deployment and the infrastructure/UX review.

See [Projecting web pages](docs/web-pages.md) for the costume contest setup, independent service operation and deployment.

## Repository structure

```text
apps/
  api/
  web/
docker/
docs/
docker-compose.yml
```

Display groups, playlists, diagnostics, cache, synchronized starts and reusable scenes are integrated with the API and Player.
