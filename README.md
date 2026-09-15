# Revel Movies

A browser-first multi-screen media orchestration platform for events and digital signage.

Revel Movies turns browser-capable devices into remotely controlled media players. It is designed for Smart TVs, PCs, Raspberry Pi devices, Android boxes, notebooks, and similar hardware.

## Initial stack

- .NET 10 / ASP.NET Core
- SignalR
- Entity Framework Core
- SQL Server
- React + TypeScript + Vite
- TanStack Query
- IIS for the primary Windows Server deployment
- Docker / Docker Compose as an optional local or portable deployment path

## Repository structure

```text
apps/
  api/
  web/
docker/
docs/
docker-compose.yml
```

The first milestone is a vertical slice where a Player can be paired from the Admin, shown as online, receive a media playback command through SignalR, and be blacked out remotely.
