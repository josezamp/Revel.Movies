import { test, expect, type Page, type APIRequestContext } from './adminFixture'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

let clip: Buffer
test.beforeAll(async ({}, testInfo) => {
  const path = testInfo.outputPath('recovery.mp4')
  execFileSync(process.env.REVEL_TEST_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10', '-t', '90', '-c:v', 'libx264',
    '-threads', '1', '-g', '10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path],
  { windowsHide: true, timeout: 30_000 })
  clip = readFileSync(path)
})

async function send(request: APIRequestContext, displayId: string, type: string, payload?: unknown) {
  const response = await request.post(`/api/displays/${displayId}/commands`, { data: { type, payload } })
  expect(response.status(), await response.text()).toBe(202)
  return response.json()
}

async function setup(page: Page, request: APIRequestContext, playlist = false, beforeProgress?: () => Promise<void>) {
  // Advance only the watchdog clock; keep real SignalR/server clocks and decoding running.
  await page.addInitScript(() => {
    const nativeNow = performance.now.bind(performance)
    let elapsed = 0
    Object.defineProperty(performance, 'now', { value: () => nativeNow() + elapsed })
    Object.assign(window, {
      advanceWatchdog: () => { elapsed += 31_000 },
      advanceBufferWait: () => { elapsed += 15_001 },
    })
  })
  const eventResponse = await request.post('/api/events', { data: { name: `Recovery ${Date.now()}`, timeZone: 'UTC' } })
  expect(eventResponse.ok()).toBeTruthy()
  const { id: eventId } = await eventResponse.json()
  await page.goto('/player')
  await expect(page.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await page.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const paired = await request.post('/api/displays/pair', { data: { eventId, code, name: 'Recovery TV' } })
  expect(paired.ok()).toBeTruthy()
  const { id: displayId } = await paired.json()
  await expect(page.locator('.pairing-screen')).toHaveCount(0)
  const uploaded = await request.post(`/api/events/${eventId}/media`, { multipart: {
    file: { name: 'recovery.mp4', mimeType: 'video/mp4', buffer: clip },
  } })
  expect(uploaded.ok()).toBeTruthy()
  const { id: mediaId } = await uploaded.json()
  if (playlist) {
    const saved = await request.post(`/api/events/${eventId}/playlists`, { data: {
      name: 'Normal videos', isLoop: true, items: [{ mediaAssetId: mediaId }],
    } })
    expect(saved.ok()).toBeTruthy()
    const { id } = await saved.json()
    expect((await request.post(`/api/playlists/${id}/play`, { data: { targetType: 'display', targetId: displayId } })).ok()).toBeTruthy()
  } else await send(request, displayId, 'media.play', { mediaId })
  await beforeProgress?.()
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(2)
  return { eventId, displayId, mediaId }
}

async function advanceWatchdog(page: Page) {
  await page.evaluate(() => (window as unknown as { advanceWatchdog: () => void }).advanceWatchdog())
}

async function freeze(page: Page, holdReload = false) {
  return page.locator('video').evaluate((video: HTMLVideoElement, hold) => {
    video.pause() // Simulate a decoder that ceases to advance, without an operator command.
    const position = video.currentTime
    const source = video.src
    const nativeLoad = video.load.bind(video)
    const nativePlay = video.play.bind(video)
    video.dataset.resumes = '0'
    video.dataset.reloads = '0'
    video.play = () => {
      video.dataset.resumes = String(Number(video.dataset.resumes) + 1)
      return Promise.resolve() // Simulate an unsuccessful first recovery attempt.
    }
    video.load = () => {
      video.dataset.reloads = String(Number(video.dataset.reloads) + 1)
      video.play = nativePlay
      video.addEventListener('seeked', () => { video.dataset.restored = String(video.currentTime) }, { once: true })
      if (hold) video.removeAttribute('src') // Keep metadata pending while a control arrives.
      nativeLoad()
    }
    Object.assign(window, {
      frozenVideo: video,
      releaseVideo: () => { video.src = source; nativeLoad() },
    })
    return position
  }, holdReload)
}

async function reachReload(page: Page) {
  await advanceWatchdog(page)
  await expect(page.locator('video')).toHaveAttribute('data-resumes', '1')
  await advanceWatchdog(page)
  await expect(page.locator('video')).toHaveAttribute('data-reloads', '1')
}

for (const playlist of [false, true]) {
  test(`limited TV preload starts the ${playlist ? 'playlist' : 'single video'} at the buffer deadline without a reload`, async ({ page, request }) => {
    await page.addInitScript(() => {
      const prototype = HTMLMediaElement.prototype
      const readyState = Object.getOwnPropertyDescriptor(prototype, 'readyState')!.get!
      const nativePlay = prototype.play
      const started = new WeakSet<HTMLMediaElement>()
      // A TV decoder can stay at HAVE_CURRENT_DATA while paused, even though
      // enough bytes have arrived. It needs play() to decode future frames.
      Object.defineProperty(prototype, 'readyState', { configurable: true, get() {
        const actual = readyState.call(this)
        return started.has(this) ? actual : Math.min(actual, 2)
      } })
      prototype.play = function () {
        started.add(this)
        this.dataset.playAttempts = String(Number(this.dataset.playAttempts ?? 0) + 1)
        return nativePlay.call(this)
      }
    })
    const { displayId } = await setup(page, request, playlist, async () => {
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBe(2)
      await expect(page.locator('.player-video-canvas')).toHaveCount(0)
      await page.evaluate(() => (window as unknown as { advanceBufferWait: () => void }).advanceBufferWait())
    })
    await expect(page.locator('video')).toHaveAttribute('data-play-attempts', '1')
    const checkpoint = await page.locator('video').evaluate((video: HTMLVideoElement) => {
      video.dispatchEvent(new Event('waiting'))
      return video.currentTime
    })
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement, position) => !v.paused && v.currentTime > position + 0.5, checkpoint)).toBeTruthy()
    await send(request, displayId, playlist ? 'playlist.pause' : 'media.pause')
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBeTruthy()
    await page.locator('video').evaluate(video => video.dispatchEvent(new Event('waiting')))
    await advanceWatchdog(page)
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBeTruthy()
    await expect(page.locator('video')).toHaveAttribute('data-play-attempts', '1')
  })
}

test('a normal video recovers by reloading the same element at its checkpoint', async ({ page, request }) => {
  await setup(page, request)
  const checkpoint = await freeze(page)
  await reachReload(page)
  await expect(page.locator('video')).toHaveAttribute('data-restored', /\d/)
  const restored = Number(await page.locator('video').getAttribute('data-restored'))
  expect(Math.abs(restored - checkpoint)).toBeLessThan(0.2)
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement, position) => !v.paused && v.currentTime > position, checkpoint)).toBeTruthy()
})

for (const playlist of [false, true]) {
  test(`operator pause during reload keeps the ${playlist ? 'playlist' : 'single video'} checkpoint until manual resume`, async ({ page, request }) => {
    const { eventId, displayId } = await setup(page, request, playlist)
    const checkpoint = await freeze(page, true)
    await reachReload(page)
    await send(request, displayId, playlist ? 'playlist.pause' : 'media.pause')
    await expect.poll(async () => (await (await request.get(`/api/displays?eventId=${eventId}`)).json())[0].actualPlaybackState).toBe('Paused')
    await page.evaluate(() => (window as unknown as { releaseVideo: () => void }).releaseVideo())
    await expect(page.locator('video')).toHaveAttribute('data-restored', /\d/)
    await advanceWatchdog(page)
    const paused = await page.locator('video').evaluate((v: HTMLVideoElement) => ({ paused: v.paused, position: v.currentTime, reloads: v.dataset.reloads }))
    expect(paused.paused).toBeTruthy()
    expect(Math.abs(paused.position - checkpoint)).toBeLessThan(0.2)
    expect(paused.reloads).toBe('1')
    const resumed = await send(request, displayId, 'playback.resume')
    expect(Math.abs(resumed.payload.resumePositionSeconds - checkpoint)).toBeLessThan(0.3)
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement, position) => !v.paused && v.currentTime > position, checkpoint)).toBeTruthy()
  })
}

test('operator pause after exhausted recovery still confirms and preserves the checkpoint', async ({ page, request }) => {
  const { eventId, displayId } = await setup(page, request)
  const checkpoint = await freeze(page, true)
  await reachReload(page)
  await advanceWatchdog(page)
  await expect(page.locator('video')).toHaveAttribute('data-reloads', '2')
  await advanceWatchdog(page)
  const state = async () => (await (await request.get(`/api/displays?eventId=${eventId}`)).json())[0].actualPlaybackState
  await expect.poll(state).toBe('Error')
  await send(request, displayId, 'media.pause')
  await expect.poll(state).toBe('Paused')
  await page.evaluate(() => (window as unknown as { releaseVideo: () => void }).releaseVideo())
  await expect(page.locator('video')).toHaveAttribute('data-restored', /\d/)
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBeTruthy()
  const resumed = await send(request, displayId, 'playback.resume')
  expect(Math.abs(resumed.payload.resumePositionSeconds - checkpoint)).toBeLessThan(0.3)
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy()
})

for (const action of ['media.stop', 'media.play']) {
  test(`${action} during reload prevents late metadata from restarting the old video`, async ({ page, request }) => {
    const { displayId, mediaId } = await setup(page, request)
    await freeze(page, true)
    await reachReload(page)
    await send(request, displayId, action, action === 'media.play' ? { mediaId } : undefined)
    if (action === 'media.stop') await expect(page.locator('video')).toHaveCount(0)
    else await expect(page.locator('video')).not.toHaveAttribute('data-reloads')
    await page.evaluate(() => (window as unknown as { releaseVideo: () => void }).releaseVideo())
    await advanceWatchdog(page)
    await expect.poll(() => page.evaluate(() => {
      const v = (window as unknown as { frozenVideo: HTMLVideoElement }).frozenVideo
      return v.readyState
    })).toBeGreaterThanOrEqual(1)
    const old = await page.evaluate(() => {
      const v = (window as unknown as { frozenVideo: HTMLVideoElement }).frozenVideo
      return { paused: v.paused, reloads: v.dataset.reloads }
    })
    expect(old).toEqual({ paused: true, reloads: '1' })
    if (action === 'media.stop') await expect(page.locator('video')).toHaveCount(0)
    else await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy()
  })
}
