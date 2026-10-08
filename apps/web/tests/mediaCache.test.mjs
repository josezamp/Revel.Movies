import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
const mediaUrl = 'https://player.test/api/media/1234-abcd/content'

function worker(fetch) {
  const listeners = new Map()
  const cached = new Map()
  const cache = {
    async match(request) { return cached.get(request.url)?.clone() },
    async put(request, response) {
      // Consume the same body as Cache Storage, rather than keeping an unread clone.
      cached.set(request.url, new Response(await response.arrayBuffer(), { headers: response.headers }))
    },
  }
  vm.runInNewContext(source, {
    self: { addEventListener: (type, callback) => listeners.set(type, callback), location: { origin: 'https://player.test' } },
    caches: { open: async () => cache }, fetch, Request, Response, Headers, URL, console: { warn() {} },
  })
  return {
    async prepare() {
      let completion
      let result
      listeners.get('message')({
        data: { type: 'prepare-media', urls: [mediaUrl] },
        ports: [{ postMessage: data => { result = data } }],
        waitUntil: promise => { completion = promise },
      })
      await completion
      return { prepared: result.prepared, failed: result.failed }
    },
    async read(range) {
      let result
      listeners.get('fetch')({
        request: new Request(mediaUrl, { headers: range ? { Range: range } : {} }),
        respondWith: promise => { result = promise },
      })
      return result
    },
  }
}

test('overlapping preparations share one download and subsequent requests use cache', async () => {
  let release
  let downloading
  let downloads = 0
  const fetched = new Promise(resolve => { downloading = resolve })
  const response = new Response('0123456789', { headers: { 'Content-Type': 'video/mp4' } })
  // The old implementation retained this unread clone while caching a large video.
  response.clone = () => { throw new Error('Do not tee the download') }
  const sw = worker(() => {
    downloads++
    downloading()
    return new Promise(resolve => { release = () => resolve(response) })
  })
  const first = sw.prepare()
  await fetched
  const second = sw.prepare()
  release()
  assert.deepEqual(await first, { prepared: 1, failed: 0 })
  assert.deepEqual(await second, { prepared: 1, failed: 0 })
  assert.deepEqual(await sw.prepare(), { prepared: 1, failed: 0 })
  assert.equal(downloads, 1)
  const range = await sw.read('bytes=2-5')
  assert.equal(range.status, 206)
  assert.equal(range.headers.get('Content-Range'), 'bytes 2-5/10')
  assert.equal(await range.text(), '2345')
  assert.equal(await (await sw.read('bytes=-3')).text(), '789')
  assert.equal((await sw.read('bytes=10-')).status, 416)
  assert.equal(await (await sw.read()).text(), '0123456789')
})

test('failed preparations release the shared download so retry can succeed', async () => {
  let downloads = 0
  const sw = worker(async () => {
    downloads++
    return downloads === 1 ? new Response(null, { status: 503 }) : new Response('video')
  })
  assert.deepEqual(await sw.prepare(), { prepared: 0, failed: 1 })
  assert.deepEqual(await sw.prepare(), { prepared: 1, failed: 0 })
  assert.equal(downloads, 2)
})
