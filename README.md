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

- Events persisted in SQL Server
- Display pairing with persistent device identity
- Online/offline presence through SignalR and heartbeat
- Video and image upload per Event
- Media metadata persisted in SQL Server while binary files remain in media storage
- MP4, JPG/JPEG, PNG, WEBP and GIF validation
- Remote playback by `mediaId`
- Play, pause, stop, blackout, identify and player reload commands
- Byte-range media responses for browser video seeking/playback

## Repository structure

```text
apps/
  api/
  web/
docker/
docs/
docker-compose.yml
```

The next milestones build on this base with display groups, playlists, diagnostics, cache and synchronized playback.
