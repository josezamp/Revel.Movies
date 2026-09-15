# Architecture

Revel Movies is a browser-first multi-screen media orchestration platform.

## Main components

- **Admin**: browser UI used to create Events, pair displays, upload media and control playback.
- **API**: ASP.NET Core REST API and SignalR hub.
- **Player**: minimal browser UI running on each display device.
- **SQL Server**: persistent application data and media metadata.
- **Media storage**: filesystem first through `IMediaStorage`; object storage providers can be added later.

Media binaries are never stored in SQL Server.

## Pairing and control flow

1. Player opens `/player` and requests a short-lived pairing session.
2. Player shows a six-digit code.
3. Admin discovers the pending pairing and assigns a display name and Event.
4. API persists the Display and pairing result in SQL Server.
5. Player receives its device token and stores it in `localStorage`.
6. Player connects to `/hubs/player` using the device token.
7. API marks the Display online and joins it to `display:{id}`.
8. Admin sends versioned commands through the REST API.
9. API publishes the command to the SignalR display group.

## Media flow

1. Admin uploads a video or image to an Event.
2. API validates file size, extension, MIME type and a basic file signature.
3. `IMediaStorage` stores the binary under an opaque storage key and calculates SHA-256 while writing.
4. `MediaAsset` metadata is stored in SQL Server.
5. Admin sends `media.play` with a `mediaId` to a Display.
6. API verifies that the MediaAsset belongs to the same Event as the target Display.
7. SignalR sends a canonical command containing `mediaId` and `mediaType`.
8. Player resolves the content through `/api/media/{mediaId}/content`.
9. The content endpoint enables HTTP range processing so browser video playback can seek efficiently.

The Player never receives an arbitrary external URL from the Admin. Media playback is resolved through Revel Movies-owned media IDs.
