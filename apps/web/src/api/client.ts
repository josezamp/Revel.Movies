export type DisplayStatus = 'Unknown' | 'Online' | 'Offline' | 'Playing' | 'Paused' | 'Error' | number
export type EventStatus = 'Draft' | 'Active' | 'Completed' | 'Archived' | number
export type MediaType = 'Video' | 'Image' | number

export interface EventSummary {
  id: string
  name: string
  slug: string
  startsAt: string | null
  endsAt: string | null
  timeZone: string
  status: EventStatus
  createdAt: string
}

export interface Display {
  id: string
  eventId: string
  name: string
  status: DisplayStatus
  lastSeenAt: string | null
  clockOffsetMs: number | null
  roundTripMs: number | null
  lastClockSyncAt: string | null
  createdAt: string
}

export interface PendingPairing {
  code: string
  createdAt: string
  expiresAt: string
}

export interface MediaAsset {
  id: string
  eventId: string
  name: string
  type: MediaType
  mimeType: string
  fileName: string
  fileSize: number
  durationSeconds: number | null
  width: number | null
  height: number | null
  checksum: string
  createdAt: string
  contentUrl: string
}

export interface DisplayGroup {
  id: string
  eventId: string
  name: string
  displayIds: string[]
  createdAt: string
}

export interface PlaylistItem {
  id: string
  mediaAssetId: string
  mediaName: string
  mediaType: MediaType
  position: number
  durationSeconds: number | null
}

export interface Playlist {
  id: string
  eventId: string
  name: string
  isLoop: boolean
  items: PlaylistItem[]
  createdAt: string
  updatedAt: string
}

export interface CommandAcknowledgement {
  commandId: string
  commandType: string
  status: string
  detail: string | null
  clientTimestamp: string | null
  serverReceivedAt: string
}

export interface PlayerDiagnostics {
  serverTime: string
  display: Display
  acknowledgements: CommandAcknowledgement[]
}

export type PlaybackTargetType = 'display' | 'group'

export async function getEvents(): Promise<EventSummary[]> {
  return getJson('/api/events')
}

export async function createEvent(name: string): Promise<EventSummary> {
  return requestJson('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }),
  })
}

export async function getPendingPairings(): Promise<PendingPairing[]> {
  return getJson('/api/pairing/pending')
}

export async function pairDisplay(code: string, name: string, eventId: string): Promise<Display> {
  return requestJson('/api/displays/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name, eventId }),
  })
}

export async function getDisplays(eventId?: string): Promise<Display[]> {
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''
  return getJson(`/api/displays${query}`)
}

export async function getMedia(eventId: string): Promise<MediaAsset[]> {
  return getJson(`/api/events/${eventId}/media`)
}

export async function uploadMedia(eventId: string, file: File, name?: string): Promise<MediaAsset> {
  const form = new FormData()
  form.append('file', file)
  if (name?.trim()) form.append('name', name.trim())

  return requestJson(`/api/events/${eventId}/media`, {
    method: 'POST',
    body: form,
  })
}

export async function deleteMedia(mediaId: string): Promise<void> {
  await requestVoid(`/api/media/${mediaId}`, { method: 'DELETE' })
}

export function mediaContentUrl(mediaId: string): string {
  return `/api/media/${mediaId}/content`
}

export async function getDisplayGroups(eventId: string): Promise<DisplayGroup[]> {
  return getJson(`/api/events/${eventId}/display-groups`)
}

export async function createDisplayGroup(eventId: string, name: string): Promise<DisplayGroup> {
  return requestJson(`/api/events/${eventId}/display-groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function replaceDisplayGroupMembers(groupId: string, displayIds: string[]): Promise<void> {
  await requestVoid(`/api/display-groups/${groupId}/members`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayIds }),
  })
}

export async function deleteDisplayGroup(groupId: string): Promise<void> {
  await requestVoid(`/api/display-groups/${groupId}`, { method: 'DELETE' })
}

export async function sendGroupCommand(groupId: string, type: string, payload?: unknown) {
  return requestJson(`/api/display-groups/${groupId}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  })
}

export async function getPlaylists(eventId: string): Promise<Playlist[]> {
  return getJson(`/api/events/${eventId}/playlists`)
}

export async function createPlaylist(eventId: string, name: string, isLoop = false): Promise<Playlist> {
  return requestJson(`/api/events/${eventId}/playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, isLoop }),
  })
}

export async function updatePlaylist(playlistId: string, name: string, isLoop: boolean): Promise<void> {
  await requestJson(`/api/playlists/${playlistId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, isLoop }),
  })
}

export async function replacePlaylistItems(
  playlistId: string,
  items: Array<{ mediaAssetId: string; durationSeconds?: number | null }>,
): Promise<void> {
  await requestVoid(`/api/playlists/${playlistId}/items`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  await requestVoid(`/api/playlists/${playlistId}`, { method: 'DELETE' })
}

export async function playPlaylist(playlistId: string, targetType: PlaybackTargetType, targetId: string) {
  return requestJson(`/api/playlists/${playlistId}/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType, targetId }),
  })
}

export async function validateDeviceToken(deviceToken: string): Promise<boolean> {
  const response = await fetch('/api/player/identity', {
    headers: { 'X-Device-Token': deviceToken },
  })

  if (response.status === 401) return false
  if (!response.ok) throw await responseError(response)
  return true
}

export async function getPlayerDiagnostics(deviceToken: string): Promise<PlayerDiagnostics> {
  return requestJson('/api/player/diagnostics', {
    headers: { 'X-Device-Token': deviceToken },
  })
}

export async function sendCommand(displayId: string, type: string, payload?: unknown) {
  return requestJson(`/api/displays/${displayId}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  })
}

export async function createPairingSession(): Promise<{ sessionToken: string; code: string; expiresAt: string }> {
  return requestJson('/api/player/pairing-session', { method: 'POST' })
}

export async function getPairingResult(sessionToken: string): Promise<{ isPaired: boolean; displayId?: string; deviceToken?: string }> {
  return getJson(`/api/player/pairing-session/${sessionToken}`)
}

async function getJson<T>(url: string): Promise<T> {
  return requestJson(url)
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw await responseError(response)
  return response.json()
}

async function requestVoid(url: string, init?: RequestInit): Promise<void> {
  const response = await fetch(url, init)
  if (!response.ok) throw await responseError(response)
}

async function responseError(response: Response): Promise<Error> {
  let message = `${response.status} ${response.statusText}`

  try {
    const body = await response.json() as { error?: string }
    if (body.error) message = body.error
  } catch {
    // The response did not contain JSON. Keep the HTTP status message.
  }

  return new Error(message)
}
