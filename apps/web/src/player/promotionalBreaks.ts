export type PlaybackItem = {
  mediaId: string
  mediaType: 'Video' | 'Image'
  fileSize: number | null
  durationSeconds: number | null
}

export type PromotionPolicy = {
  id: string
  enabled: boolean
  playlistId: string | null
  playlistName: string
  everyVideos: number
  items: { mediaId: string; mediaType: 'Video'; fileSize: number | null }[]
}

export type PromotionProgress = {
  playbackId: string
  policyId: string | null
  completedVideos: number
  nextPromotionIndex: number
  activeMediaId: string | null
  sequence: number
}

export type PlaylistCheckpoint = {
  progress: PromotionProgress
  playlistIndex: number
  positionSeconds: number
  capturedAt: number
  ended: boolean
}

export const playlistCheckpointKey = 'revel-movies.playlist-checkpoint'

export function startPromotionProgress(playbackId: string, policy: PromotionPolicy | null): PromotionProgress {
  return { playbackId, policyId: policy?.id ?? null, completedVideos: 0, nextPromotionIndex: 0, activeMediaId: null, sequence: 0 }
}

export function configurePromotions(progress: PromotionProgress, policy: PromotionPolicy | null): PromotionProgress {
  if (progress.policyId === (policy?.id ?? null)) return progress
  // Keep the current promotion playing even when the operator replaces or disables its policy.
  return { ...progress, policyId: policy?.id ?? null, completedVideos: 0, nextPromotionIndex: 0, sequence: progress.sequence + 1 }
}

export function finishPlaylistItem(
  progress: PromotionProgress, policy: PromotionPolicy | null,
  playlist: { items: PlaybackItem[]; loop: boolean }, playlistIndex: number,
): { progress: PromotionProgress; playlistIndex: number; mediaId: string; mediaType: 'Video' | 'Image'; ended: boolean } {
  let next = { ...configurePromotions(progress, policy), sequence: progress.sequence + 1 }
  const current = playlist.items[playlistIndex]
  if (next.activeMediaId) {
    next.activeMediaId = null
  } else if (current.mediaType === 'Video' && policy?.enabled && policy.items.length) {
    next.completedVideos++
    if (next.completedVideos >= policy.everyVideos) {
      const item = policy.items[next.nextPromotionIndex % policy.items.length]
      next = { ...next, completedVideos: 0, nextPromotionIndex: (next.nextPromotionIndex + 1) % policy.items.length, activeMediaId: item.mediaId }
      return { progress: next, playlistIndex, mediaId: item.mediaId, mediaType: 'Video', ended: false }
    }
  }

  const ended = playlistIndex + 1 >= playlist.items.length && !playlist.loop
  const index = ended ? playlistIndex : (playlistIndex + 1) % playlist.items.length
  const item = playlist.items[index]
  return { progress: next, playlistIndex: index, mediaId: item.mediaId, mediaType: item.mediaType, ended }
}

export function parsePromotionPolicy(value: unknown): PromotionPolicy | null {
  if (!value || typeof value !== 'object') return null
  const p = value as PromotionPolicy
  if (typeof p.id !== 'string' || !p.id || typeof p.enabled !== 'boolean' ||
    !Number.isInteger(p.everyVideos) || p.everyVideos < 1 || p.everyVideos > 100 ||
    typeof p.playlistName !== 'string' || !Array.isArray(p.items) ||
    (p.enabled && (typeof p.playlistId !== 'string' || !p.items.length)) ||
    p.items.some(item => !item || typeof item.mediaId !== 'string' || !item.mediaId || item.mediaType !== 'Video')) return null
  return p
}

export function parsePromotionProgress(value: unknown): PromotionProgress | null {
  if (!value || typeof value !== 'object') return null
  const p = value as PromotionProgress
  if (typeof p.playbackId !== 'string' || !p.playbackId ||
    (p.policyId !== null && typeof p.policyId !== 'string') ||
    !Number.isInteger(p.completedVideos) || p.completedVideos < 0 || p.completedVideos > 99 ||
    !Number.isInteger(p.nextPromotionIndex) || p.nextPromotionIndex < 0 ||
    !Number.isSafeInteger(p.sequence) || p.sequence < 0 ||
    (p.activeMediaId !== null && (typeof p.activeMediaId !== 'string' || !p.activeMediaId))) return null
  return p
}

export function readPlaylistCheckpoint(storage: Pick<Storage, 'getItem'>): PlaylistCheckpoint | null {
  try {
    const value = JSON.parse(storage.getItem(playlistCheckpointKey) ?? 'null') as PlaylistCheckpoint | null
    if (!value || !parsePromotionProgress(value.progress) ||
      !Number.isInteger(value.playlistIndex) || value.playlistIndex < 0 ||
      !Number.isFinite(value.positionSeconds) || value.positionSeconds < 0 ||
      !Number.isFinite(value.capturedAt) || typeof value.ended !== 'boolean') return null
    return value
  } catch { return null }
}

export function preferLocalCheckpoint(local: PlaylistCheckpoint | null, playbackId: string,
  remote: PromotionProgress | null, updatedAt: number, itemCount: number): local is PlaylistCheckpoint {
  return !!local && local.progress.playbackId === playbackId && local.playlistIndex < itemCount &&
    (local.progress.sequence > (remote?.sequence ?? -1) ||
      (local.progress.sequence === remote?.sequence && local.capturedAt > updatedAt))
}
