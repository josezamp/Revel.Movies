const MEDIA_CACHE = 'revel-movies-media-v1'
const MEDIA_PATH = /^\/api\/media\/[0-9a-f-]+\/content$/i

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('message', event => {
  const data = event.data
  if (!data || data.type !== 'prepare-media' || !Array.isArray(data.urls)) return

  event.waitUntil((async () => {
    const cache = await caches.open(MEDIA_CACHE)
    let prepared = 0
    let failed = 0

    for (const url of data.urls) {
      try {
        const request = new Request(url, { credentials: 'same-origin' })
        const existing = await cache.match(request)
        if (!existing) {
          const response = await fetch(request)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await cache.put(request, response.clone())
        }
        prepared++
      } catch (error) {
        console.warn('Failed to prepare media:', url, error)
        failed++
      }
    }

    event.ports?.[0]?.postMessage({ prepared, failed })
  })())
})

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
  const cached = await cache.match(cacheKey)

  if (!cached) return fetch(request)

  const range = request.headers.get('range')
  if (!range) return cached

  return buildRangeResponse(cached, range)
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
