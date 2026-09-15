# Orchestration

## Display Groups

A Display Group belongs to one Event and contains zero or more Displays from that same Event.

Groups are logical command targets. In v0.1 the API expands a group into its Display IDs and sends the same versioned command through each Display's existing SignalR group.

This keeps Player connections simple and makes group membership changes immediately effective without reconnecting a Player.

A Display may belong to multiple groups.

## Playlists

A Playlist belongs to one Event and contains ordered MediaAssets from that Event.

Each item stores:

- MediaAsset ID
- position
- optional duration override

For images, the Player uses 10 seconds when no duration is supplied. Video items advance when the browser fires the `ended` event.

`playlist.play` contains the resolved sequence so the Player can execute it without making one API call per item:

```json
{
  "playlistId": "...",
  "loop": true,
  "items": [
    {
      "mediaId": "...",
      "mediaType": "Video",
      "durationSeconds": null
    },
    {
      "mediaId": "...",
      "mediaType": "Image",
      "durationSeconds": 10
    }
  ]
}
```

Supported playlist controls in this stage:

- `playlist.play`
- `playlist.pause`
- `playlist.stop`

## Synchronization boundary

Display Groups do not imply frame-accurate synchronization.

When a command targets a group, the API sends it to all current members as quickly as possible, but browser scheduling, network latency and media startup time can differ between Players.

Strict synchronized playback is a later stage and will use server timestamps (`startAt`), client/server clock-offset estimation, media preparation/cache readiness and synchronization correction.
