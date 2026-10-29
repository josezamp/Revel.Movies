const MEDIA_CACHE = 'revel-movies-media-v1'
const MAX_CACHE_ASSET_BYTES = 256 * 1024 * 1024
const MEDIA_PATH = /^\/api\/media\/[0-9a-f-]+\/content$/i
const pendingPreparations = new Map()

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('message', event => {
  const data = event.data
  if (!data || data.type !== 'prepare-media' || !Array.isArray(data.urls)) return

  event.waitUntil((async () => {
    let prepared = 0
    let failed = 0

    for (const url of data.urls) {
      try {
        await prepareMedia(url)
        prepared++
      } catch (error) {
        console.warn('Failed to prepare media:', url, error)
        failed++
      }
    }

    event.ports?.[0]?.postMessage({ prepared, failed })
  })())
})

function prepareMedia(url) {
  const request = new Request(url, { credentials: 'same-origin' })
  const existing = pendingPreparations.get(request.url)
  if (existing) return existing

  const preparation = (async () => {
    const cache = await caches.open(MEDIA_CACHE)
    if (await currentCachedMedia(cache, request)) return
    const response = await fetch(request)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const declaredLength = response.headers.get('Content-Length')
    const length = declaredLength === null ? NaN : Number(declaredLength)
    if (!Number.isFinite(length) || length < 0 || length > MAX_CACHE_ASSET_BYTES) {
      await response.body?.cancel()
      throw new Error('Tamaño desconocido o superior al límite de caché; requiere reproducción por red')
    }
    // Cache consumes the response directly; an unread clone can retain a large video in memory.
    await cache.put(request, response)
  })().finally(() => pendingPreparations.delete(request.url))

  pendingPreparations.set(request.url, preparation)
  return preparation
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !MEDIA_PATH.test(url.pathname)) return

  event.respondWith(handleMediaRequest(request))
})

async function handleMediaRequest(request) {
  const cache = await caches.open(MEDIA_CACHE)
  const cacheKey = new Request(request.url, { credentials: 'same-origin' })
  const cached = await currentCachedMedia(cache, cacheKey)

  if (!cached) return fetch(request)

  const range = request.headers.get('range')
  if (!range) return cached

  return buildRangeResponse(cached, range)
}

async function currentCachedMedia(cache, request) {
  const cached = await cache.match(request)
  if (!cached) return undefined
  // Media IDs survive replacements. Revalidate their checksum without downloading the video.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(new Request(request.url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store', signal: controller.signal }))
    if (response.ok && response.headers.get('ETag') && response.headers.get('ETag') === cached.headers.get('ETag')) return cached
    if (!response.ok && response.status !== 404) return cached
    await cache.delete(request)
    return undefined
  } catch {
    return cached // Offline playback keeps the last successfully prepared file.
  } finally { clearTimeout(timeout) }
}

async function buildRangeResponse(response, rangeHeader) {
  const blob = await response.blob()
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return response

  let start = match[1] ? Number(match[1]) : 0
  let end = match[2] ? Number(match[2]) : blob.size - 1

  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2])
    start = Math.max(0, blob.size - suffixLength)
    end = blob.size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= blob.size || end < start) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${blob.size}` },
    })
  }

  end = Math.min(end, blob.size - 1)
  const chunk = blob.slice(start, end + 1, response.headers.get('Content-Type') || blob.type)
  const headers = new Headers(response.headers)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Range', `bytes ${start}-${end}/${blob.size}`)
  headers.set('Content-Length', String(chunk.size))

  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers,
  })
}
