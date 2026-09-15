import { useEffect, useMemo, useState } from 'react'
import {
  createDisplayGroup,
  createPlaylist,
  deleteDisplayGroup,
  deletePlaylist,
  getDisplayGroups,
  getPlaylists,
  playPlaylist,
  replaceDisplayGroupMembers,
  replacePlaylistItems,
  sendCommand,
  sendGroupCommand,
  updatePlaylist,
  type Display,
  type DisplayGroup,
  type MediaAsset,
  type PlaybackTargetType,
  type Playlist,
} from '../api/client'

type Props = {
  eventId: string
  displays: Display[]
  media: MediaAsset[]
}

export function OrchestrationPanel({ eventId, displays, media }: Props) {
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [target, setTarget] = useState('')
  const [playlistMedia, setPlaylistMedia] = useState<Record<string, string>>({})
  const [groupMedia, setGroupMedia] = useState<Record<string, string>>({})

  async function refresh() {
    if (!eventId) {
      setGroups([])
      setPlaylists([])
      return
    }

    const [nextGroups, nextPlaylists] = await Promise.all([
      getDisplayGroups(eventId),
      getPlaylists(eventId),
    ])
    setGroups(nextGroups)
    setPlaylists(nextPlaylists)
  }

  useEffect(() => {
    void refresh()
  }, [eventId])

  const targetOptions = useMemo(() => [
    ...displays.map((display) => ({ value: `display:${display.id}`, label: `Display · ${display.name}` })),
    ...groups.map((group) => ({ value: `group:${group.id}`, label: `Group · ${group.name}` })),
  ], [displays, groups])

  useEffect(() => {
    setTarget((current) => targetOptions.some((option) => option.value === current)
      ? current
      : targetOptions[0]?.value ?? '')
  }, [targetOptions])

  async function createGroup() {
    const name = window.prompt('Group name', 'Living')
    if (!name || !eventId) return
    await createDisplayGroup(eventId, name)
    await refresh()
  }

  async function toggleGroupMember(group: DisplayGroup, displayId: string) {
    const displayIds = group.displayIds.includes(displayId)
      ? group.displayIds.filter((id) => id !== displayId)
      : [...group.displayIds, displayId]

    await replaceDisplayGroupMembers(group.id, displayIds)
    await refresh()
  }

  async function removeGroup(group: DisplayGroup) {
    if (!window.confirm(`Delete group ${group.name}?`)) return
    await deleteDisplayGroup(group.id)
    await refresh()
  }

  async function createNewPlaylist() {
    const name = window.prompt('Playlist name', 'Playlist principal')
    if (!name || !eventId) return
    await createPlaylist(eventId, name)
    await refresh()
  }

  async function setLoop(playlist: Playlist, isLoop: boolean) {
    await updatePlaylist(playlist.id, playlist.name, isLoop)
    await refresh()
  }

  async function addPlaylistMedia(playlist: Playlist) {
    const mediaId = playlistMedia[playlist.id] || media[0]?.id
    if (!mediaId) return

    const asset = media.find((item) => item.id === mediaId)
    const items = playlist.items.map((item) => ({
      mediaAssetId: item.mediaAssetId,
      durationSeconds: item.durationSeconds,
    }))
    items.push({
      mediaAssetId: mediaId,
      durationSeconds: asset?.type === 'Image' ? 10 : null,
    })

    await replacePlaylistItems(playlist.id, items)
    await refresh()
  }

  async function movePlaylistItem(playlist: Playlist, index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= playlist.items.length) return

    const items = [...playlist.items]
    ;[items[index], items[nextIndex]] = [items[nextIndex], items[index]]
    await saveItems(playlist, items)
  }

  async function removePlaylistItem(playlist: Playlist, index: number) {
    await saveItems(playlist, playlist.items.filter((_, itemIndex) => itemIndex !== index))
  }

  async function editImageDuration(playlist: Playlist, index: number) {
    const item = playlist.items[index]
    const raw = window.prompt('Image duration in seconds', String(item.durationSeconds ?? 10))
    if (!raw) return

    const duration = Number(raw)
    if (!Number.isFinite(duration) || duration <= 0) {
      window.alert('Duration must be greater than zero.')
      return
    }

    const items = playlist.items.map((candidate, itemIndex) =>
      itemIndex === index ? { ...candidate, durationSeconds: duration } : candidate)
    await saveItems(playlist, items)
  }

  async function saveItems(playlist: Playlist, items: Playlist['items']) {
    await replacePlaylistItems(playlist.id, items.map((item) => ({
      mediaAssetId: item.mediaAssetId,
      durationSeconds: item.durationSeconds,
    })))
    await refresh()
  }

  async function removePlaylist(playlist: Playlist) {
    if (!window.confirm(`Delete playlist ${playlist.name}?`)) return
    await deletePlaylist(playlist.id)
    await refresh()
  }

  async function play(playlist: Playlist) {
    const parsed = parseTarget(target)
    if (!parsed) {
      window.alert('Select a target display or group first.')
      return
    }

    await playPlaylist(playlist.id, parsed.type, parsed.id)
  }

  async function sendTargetCommand(type: string) {
    const parsed = parseTarget(target)
    if (!parsed) return

    if (parsed.type === 'display') await sendCommand(parsed.id, type)
    else await sendGroupCommand(parsed.id, type)
  }

  async function playMediaOnGroup(group: DisplayGroup) {
    const mediaId = groupMedia[group.id] || media[0]?.id
    if (!mediaId) return
    await sendGroupCommand(group.id, 'media.play', { mediaId })
  }

  return (
    <>
      <section>
        <div className="section-heading">
          <div>
            <h2>Display Groups</h2>
            <p className="muted">Control several screens as one target.</p>
          </div>
          <button disabled={!eventId} onClick={() => void createGroup()}>New group</button>
        </div>

        {groups.length === 0 && <p className="muted">No display groups for this event yet.</p>}
        <div className="card-grid orchestration-grid">
          {groups.map((group) => (
            <article className="card" key={group.id}>
              <div className="display-heading">
                <strong>{group.name}</strong>
                <span className="count-badge">{group.displayIds.length} screens</span>
              </div>

              <div className="member-list">
                {displays.map((display) => (
                  <label key={display.id}>
                    <input
                      type="checkbox"
                      checked={group.displayIds.includes(display.id)}
                      onChange={() => void toggleGroupMember(group, display.id)}
                    />
                    {display.name}
                  </label>
                ))}
                {displays.length === 0 && <small className="muted">No displays available.</small>}
              </div>

              <div className="inline-control">
                <select
                  value={groupMedia[group.id] ?? media[0]?.id ?? ''}
                  onChange={(event) => setGroupMedia((current) => ({ ...current, [group.id]: event.target.value }))}
                >
                  {media.length === 0 && <option value="">No media</option>}
                  {media.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button disabled={group.displayIds.length === 0 || media.length === 0} onClick={() => void playMediaOnGroup(group)}>▶ Play</button>
              </div>

              <div className="button-row">
                <button disabled={group.displayIds.length === 0} onClick={() => void sendGroupCommand(group.id, 'display.identify')}>Identify</button>
                <button disabled={group.displayIds.length === 0} onClick={() => void sendGroupCommand(group.id, 'display.blackout')}>Blackout</button>
                <button disabled={group.displayIds.length === 0} onClick={() => void sendGroupCommand(group.id, 'media.stop')}>Stop</button>
                <button className="danger-button" onClick={() => void removeGroup(group)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <h2>Playlists</h2>
            <p className="muted">Videos advance on end; images use their configured duration.</p>
          </div>
          <button disabled={!eventId} onClick={() => void createNewPlaylist()}>New playlist</button>
        </div>

        <div className="media-toolbar playlist-target-toolbar">
          <label>
            Playlist target
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              {targetOptions.length === 0 && <option value="">No targets</option>}
              {targetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button disabled={!target} onClick={() => void sendTargetCommand('playlist.pause')}>Pause playlist</button>
          <button disabled={!target} onClick={() => void sendTargetCommand('playlist.stop')}>Stop playlist</button>
        </div>

        {playlists.length === 0 && <p className="muted">No playlists for this event yet.</p>}
        <div className="playlist-list">
          {playlists.map((playlist) => (
            <article className="card playlist-card" key={playlist.id}>
              <div className="playlist-heading">
                <div>
                  <strong>{playlist.name}</strong>
                  <small>{playlist.items.length} items</small>
                </div>
                <label className="loop-toggle">
                  <input type="checkbox" checked={playlist.isLoop} onChange={(event) => void setLoop(playlist, event.target.checked)} />
                  Loop
                </label>
              </div>

              <div className="playlist-items">
                {playlist.items.map((item, index) => (
                  <div className="playlist-item" key={item.id}>
                    <span className="playlist-position">{index + 1}</span>
                    <div>
                      <strong>{item.mediaName}</strong>
                      <small>{String(item.mediaType)}{item.mediaType === 'Image' ? ` · ${item.durationSeconds ?? 10}s` : ''}</small>
                    </div>
                    <div className="playlist-item-actions">
                      {item.mediaType === 'Image' && <button onClick={() => void editImageDuration(playlist, index)}>Duration</button>}
                      <button disabled={index === 0} onClick={() => void movePlaylistItem(playlist, index, -1)}>↑</button>
                      <button disabled={index === playlist.items.length - 1} onClick={() => void movePlaylistItem(playlist, index, 1)}>↓</button>
                      <button onClick={() => void removePlaylistItem(playlist, index)}>Remove</button>
                    </div>
                  </div>
                ))}
                {playlist.items.length === 0 && <small className="muted">Add media to build this playlist.</small>}
              </div>

              <div className="inline-control">
                <select
                  value={playlistMedia[playlist.id] ?? media[0]?.id ?? ''}
                  onChange={(event) => setPlaylistMedia((current) => ({ ...current, [playlist.id]: event.target.value }))}
                >
                  {media.length === 0 && <option value="">No media</option>}
                  {media.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button disabled={media.length === 0} onClick={() => void addPlaylistMedia(playlist)}>Add media</button>
              </div>

              <div className="button-row">
                <button disabled={!target || playlist.items.length === 0} onClick={() => void play(playlist)}>▶ Play playlist</button>
                <button className="danger-button" onClick={() => void removePlaylist(playlist)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

function parseTarget(value: string): { type: PlaybackTargetType; id: string } | undefined {
  const [type, id] = value.split(':', 2)
  if ((type !== 'display' && type !== 'group') || !id) return undefined
  return { type, id }
}
