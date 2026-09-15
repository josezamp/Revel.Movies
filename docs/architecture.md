# Architecture

Revel Movies is a browser-first multi-screen media orchestration platform.

## Main components

- **Admin**: browser UI used to pair and control displays.
- **API**: ASP.NET Core REST API and SignalR hub.
- **Player**: minimal browser UI running on each display device.
- **PostgreSQL**: persistent application data (introduced after the bootstrap in-memory slice).
- **Media storage**: filesystem first, abstract object storage later.

## First vertical slice

1. Player opens `/player` and requests a short-lived pairing session.
2. Player shows a six-digit code.
3. Admin discovers the pending pairing and assigns a display name.
4. Player receives its device token and stores it in `localStorage`.
5. Player connects to `/hubs/player` using the device token.
6. API marks the display online and joins it to `display:{id}`.
7. Admin sends versioned commands through the REST API.
8. API publishes the command to the SignalR display group.

The bootstrap intentionally uses an in-memory registry so the communication contract can be validated before persistence is introduced.
