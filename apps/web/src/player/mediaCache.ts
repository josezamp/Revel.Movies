import { mediaContentUrl } from '../api/client'

const maxCacheAssetBytes = 256 * 1024 * 1024

export type CacheCandidate = {
  mediaId: string
  fileSize: number | null
}

export type MediaPrepareResult = {
  supported: boolean
  requested: number
  prepared: number
  skipped: number
}

export async function registerMediaCache(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return false

  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    return true
  } catch (error) {
    console.warn('Media cache service worker unavailable:', error)
    return false
  }
}

export async function prepareMediaAssets(candidates: CacheCandidate[]): Promise<MediaPrepareResult> {
  const unique = Array.from(new Map(candidates.map(item => [item.mediaId, item])).values())
  const eligible = unique.filter(item => item.fileSize === null || item.fileSize <= maxCacheAssetBytes)
  const skipped = unique.length - eligible.length

  if (eligible.length === 0)
    return { supported: 'serviceWorker' in navigator && window.isSecureContext, requested: unique.length, prepared: 0, skipped }

  if (!('serviceWorker' in navigator) || !window.isSecureContext)
    return { supported: false, requested: unique.length, prepared: 0, skipped: unique.length }

  try {
    const registration = await navigator.serviceWorker.ready
    const worker = registration.active
    if (!worker)
      return { supported: false, requested: unique.length, prepared: 0, skipped: unique.length }

    const urls = eligible.map(item => mediaContentUrl(item.mediaId))
    const result = await postPrepareMessage(worker, urls)
    return {
      supported: true,
      requested: unique.length,
      prepared: result.prepared,
      skipped: skipped + result.failed,
    }
  } catch (error) {
    console.warn('Media preparation failed:', error)
    return { supported: false, requested: unique.length, prepared: 0, skipped: unique.length }
  }
}

export async function getCachedMediaCount(): Promise<number> {
  if (!('caches' in window)) return 0

  try {
    const cache = await caches.open('revel-movies-media-v1')
    return (await cache.keys()).length
  } catch {
    return 0
  }
}

function postPrepareMessage(worker: ServiceWorker, urls: string[]): Promise<{ prepared: number; failed: number }> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timeout = window.setTimeout(() => resolve({ prepared: 0, failed: urls.length }), 120_000)

    channel.port1.onmessage = event => {
      window.clearTimeout(timeout)
      const data = event.data as { prepared?: number; failed?: number } | undefined
      resolve({ prepared: data?.prepared ?? 0, failed: data?.failed ?? urls.length })
    }

    worker.postMessage({ type: 'prepare-media', urls }, [channel.port2])
  })
}
