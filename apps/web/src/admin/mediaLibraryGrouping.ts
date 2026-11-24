import type { MediaAsset, MediaOptimization } from '../api/client'

export function groupLibraryMedia(media: MediaAsset[], jobs: MediaOptimization[]) {
  const mediaById = new Map(media.map(item => [item.id, item]))
  const originalByCopy = new Map<string, MediaAsset>()
  const copyByOriginal = new Map<string, MediaAsset>()
  for (const job of jobs) {
    if (job.status !== 'Completed' || !job.resultMediaId || job.replaceOriginal || job.resultMediaId === job.mediaId) continue
    const original = mediaById.get(job.mediaId)
    const copy = mediaById.get(job.resultMediaId)
    // A replaced original and its old TV copy are separate content again.
    if (!original || !copy || original.checksum !== job.sourceChecksum) continue
    originalByCopy.set(copy.id, original)
    copyByOriginal.set(original.id, copy)
  }
  return { items: media.filter(item => !copyByOriginal.has(item.id)), mediaById, originalByCopy, copyByOriginal }
}

export function resolveLibrarySelection(ids: string[], library: ReturnType<typeof groupLibraryMedia>) {
  return [...new Set(ids.map(id => library.copyByOriginal.get(id)?.id ?? id))]
    .filter(id => library.mediaById.has(id))
}
