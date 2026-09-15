# Architecture

Revel Movies is a browser-first multi-screen media orchestration platform.

## Main components

- **Admin**: browser UI used to pair and control displays.
- **API**: ASP.NET Core REST API and SignalR hub.
- **Player**: minimal browser UI running on each display device.
- **SQL Server**: persistent application data.
- **Media storage**: filesystem first, abstract object storage later.

## First vertical slice

1. Player opens `/player` and requests a short-lived pairing session.
2. Player shows a six-digit code.
3. Admin discovers the pending pairing and assigns a display name and event.
4. API persists the display and pairing result in SQL Server.
5. Player receives its device token and stores it in `localStorage`.
6. Player connects to `/hubs/player` using the device token.
7. API marks the display online and joins it to `display:{id}`.
8. Admin sends versioned commands through the REST API.
9. API publishes the command to the SignalR display group.

Display identity, events, pairing sessions, and presence metadata are persisted through EF Core. The media binaries themselves are not stored in SQL Server; media storage remains a separate concern.
