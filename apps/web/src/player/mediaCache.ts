import { mediaContentUrl } from '../api/client'
import { summarizePreparation, type AssetPreparation, type PreparationStatus } from './preparationStatus'

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
  status: PreparationStatus
  network: number
  failed: number
  detail: string
  assets: AssetPreparation[]
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

export async function prepareMediaAssets(candidates: CacheCandidate[], networkRequired = false): Promise<MediaPrepareResult> {
  const unique = Array.from(new Map(candidates.map(item => [item.mediaId, item])).values())
  const worker = await readyWorker()
  const assets: AssetPreparation[] = new Array(unique.length)
  let cursor = 0
  // Keep background preparation from monopolizing bandwidth on TV browsers.
  await Promise.all(Array.from({ length: Math.min(2, unique.length) }, async () => {
    while (cursor < unique.length) {
      const index = cursor++
      const candidate = unique[index]
      const url = mediaContentUrl(candidate.mediaId)
      if (worker && (candidate.fileSize === null || candidate.fileSize <= maxCacheAssetBytes)) {
        const result = await postPrepareMessage(worker, [url])
        if (result.prepared === 1) {
          assets[index] = { mediaId: candidate.mediaId, availability: 'cached' }
          continue
        }
      }
      const reachable = await verifyNetworkAsset(url)
      assets[index] = { mediaId: candidate.mediaId, availability: reachable ? 'network' : 'unavailable',
        reason: reachable ? 'Requiere conexión de red' : 'No se pudo verificar el recurso' }
    }
  }))
  const summary = summarizePreparation(assets, networkRequired)
  return { ...summary, assets, supported: !!worker, requested: unique.length, skipped: unique.length - summary.prepared }
}

async function readyWorker(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null
  let timer: number | undefined
  try {
    return await Promise.race([
      navigator.serviceWorker.ready.then(registration => registration.active),
      new Promise<null>(resolve => { timer = window.setTimeout(() => resolve(null), 8000) }),
    ])
  } catch { return null }
  finally { if (timer !== undefined) window.clearTimeout(timer) }
}

async function verifyNetworkAsset(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15_000)
  try {
    // A one-byte range verifies reachability without downloading another complete video.
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store', signal: controller.signal })
    const reachable = response.ok
    await response.body?.cancel()
    return reachable
  } catch { return false }
  finally { window.clearTimeout(timer) }
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
    const finish = (result: { prepared: number; failed: number }) => {
      window.clearTimeout(timeout)
      channel.port1.close()
      resolve(result)
    }
    const timeout = window.setTimeout(() => finish({ prepared: 0, failed: urls.length }), 120_000)

    channel.port1.onmessage = event => {
      const data = event.data as { prepared?: number; failed?: number } | undefined
      finish({ prepared: data?.prepared ?? 0, failed: data?.failed ?? urls.length })
    }

    try { worker.postMessage({ type: 'prepare-media', urls }, [channel.port2]) }
    catch { finish({ prepared: 0, failed: urls.length }) }
  })
}
