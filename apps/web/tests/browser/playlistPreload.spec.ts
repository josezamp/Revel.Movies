import { test, expect, type Page, type APIRequestContext } from './adminFixture'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// The native queue must work on LAN TVs where service workers are unavailable.
test.use({ serviceWorkers: 'block' })

let clip: Buffer
test.beforeAll(async ({}, testInfo) => {
  const path = testInfo.outputPath('playlist-preload.mp4')
  execFileSync(process.env.REVEL_TEST_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=10', '-t', '90', '-c:v', 'libx264',
    '-threads', '1', '-g', '10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path],
  { windowsHide: true, timeout: 30_000 })
  clip = readFileSync(path)
})

async function send(request: APIRequestContext, displayId: string, type: string, payload?: unknown) {
  const response = await request.post(`/api/displays/${displayId}/commands`, { data: { type, payload } })
  expect(response.status(), await response.text()).toBe(202)
}

async function setup(page: Page, request: APIRequestContext, count: number) {
  const event = await request.post('/api/events', { data: { name: `Preload ${Date.now()}`, timeZone: 'UTC' } })
  expect(event.ok()).toBeTruthy()
  const { id: eventId } = await event.json()
  await page.goto('/player')
  await expect(page.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await page.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const paired = await request.post('/api/displays/pair', { data: { eventId, code, name: 'Preload TV' } })
  expect(paired.ok()).toBeTruthy()
  const { id: displayId } = await paired.json()
  await expect(page.locator('.pairing-screen')).toHaveCount(0)
  const mediaIds: string[] = []
  for (let index = 0; index < count; index++) {
    const uploaded = await request.post(`/api/events/${eventId}/media`, { multipart: {
      file: { name: `preload-${index}.mp4`, mimeType: 'video/mp4', buffer: clip },
    } })
    expect(uploaded.ok()).toBeTruthy()
    mediaIds.push((await uploaded.json()).id)
  }
  return { eventId, displayId, mediaIds }
}

async function playPlaylist(request: APIRequestContext, eventId: string, displayId: string, ids: string[], loop = false) {
  const saved = await request.post(`/api/events/${eventId}/playlists`, { data: {
    name: 'Preloaded videos', isLoop: loop, items: ids.map(mediaAssetId => ({ mediaAssetId })),
  } })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  const { id } = await saved.json()
  const played = await request.post(`/api/playlists/${id}/play`, { data: { targetType: 'display', targetId: displayId } })
  expect(played.ok(), await played.text()).toBeTruthy()
}

async function finishCurrent(page: Page) {
  await page.locator('video.player-media').evaluate((video: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
    const ended = () => {
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(() => {
      video.removeEventListener('ended', ended)
      reject(new Error('The active video did not end after seeking to its final frame'))
    }, 5000)
    video.addEventListener('ended', ended, { once: true })
    // Leave decoded future frames after the seek; the exact final frame can stay
    // at HAVE_CURRENT_DATA until the player's limited-preload deadline expires.
    video.currentTime = Math.max(0, video.duration - 2)
  }))
}

async function expectPlaying(page: Page, mediaId: string) {
  await expect(page.locator('video.player-media')).toHaveAttribute('src', new RegExp(mediaId))
  await expect.poll(() => page.locator('video.player-media').evaluate((video: HTMLVideoElement) =>
    !video.paused && video.currentTime > 0.2)).toBeTruthy()
}

test('preloads only the next two videos without a service worker and promotes the buffered element', async ({ page, request }) => {
  const mediaRequests: string[] = []
  page.on('request', request => {
    // playlist.prepare also issues one-byte fetch probes; these are not video buffering.
    if (request.resourceType() === 'media') mediaRequests.push(request.url())
  })
  const { eventId, displayId, mediaIds } = await setup(page, request, 4)
  await playPlaylist(request, eventId, displayId, mediaIds)
  await expectPlaying(page, mediaIds[0])
  await expect(page.locator('video')).toHaveCount(3)
  for (const id of mediaIds.slice(1, 3)) {
    const queued = page.locator(`video.player-preload[src*="${id}"]`)
    await expect(queued).toBeHidden()
    await expect.poll(() => queued.evaluate((video: HTMLVideoElement) =>
      video.paused && video.buffered.length > 0 && video.buffered.end(0) > 1)).toBeTruthy()
    expect(mediaRequests.some(url => url.includes(id))).toBeTruthy()
  }
  expect(mediaRequests.some(url => url.includes(mediaIds[3]))).toBeFalsy()
  await page.locator(`video[src*="${mediaIds[1]}"]`).evaluate(video => video.setAttribute('data-warmed', 'second'))
  await page.locator('video.player-media').evaluate(video => { Object.assign(window, { previousVideo: video }) })

  await finishCurrent(page)
  await expectPlaying(page, mediaIds[1])
  await expect(page.locator('video.player-media')).toHaveAttribute('data-warmed', 'second')
  await expect(page.locator('video')).toHaveCount(3)
  await expect.poll(() => page.locator(`video.player-preload[src*="${mediaIds[3]}"]`).evaluate((video: HTMLVideoElement) =>
    video.buffered.length > 0)).toBeTruthy()
  expect(await page.evaluate(() => {
    const video = (window as unknown as { previousVideo: HTMLVideoElement }).previousVideo
    return { attached: video.isConnected, paused: video.paused, source: video.getAttribute('src') }
  })).toEqual({ attached: false, paused: true, source: null })

  await send(request, displayId, 'playlist.pause')
  await expect.poll(() => page.locator('video.player-media').evaluate((video: HTMLVideoElement) => video.paused)).toBeTruthy()
  expect(await page.locator('video.player-preload').evaluateAll(videos =>
    videos.every(video => (video as HTMLVideoElement).paused))).toBeTruthy()
  await page.locator('video').evaluateAll(videos => { Object.assign(window, { stoppedVideos: videos }) })
  await send(request, displayId, 'playlist.stop')
  await expect(page.locator('video')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { stoppedVideos: HTMLVideoElement[] }).stoppedVideos
    .every(video => !video.isConnected && video.paused && !video.getAttribute('src')))).toBeTruthy()
})

test('looping and repeated items reuse queued videos, and replacing the playlist releases them', async ({ page, request }) => {
  const { eventId, displayId, mediaIds } = await setup(page, request, 2)
  await playPlaylist(request, eventId, displayId, [mediaIds[0], mediaIds[1], mediaIds[0]], true)
  await expectPlaying(page, mediaIds[0])
  await expect(page.locator('video')).toHaveCount(2)
  await page.locator('video.player-media').evaluate(video => video.setAttribute('data-warmed', 'first'))
  await expect.poll(() => page.locator('video.player-preload').evaluate((video: HTMLVideoElement) =>
    video.buffered.length > 0)).toBeTruthy()

  await finishCurrent(page)
  await expectPlaying(page, mediaIds[1])
  await expect(page.locator('video.player-preload')).toHaveAttribute('data-warmed', 'first')
  await expect.poll(() => page.locator('video.player-preload').evaluate((video: HTMLVideoElement) =>
    video.paused && video.currentTime === 0)).toBeTruthy()
  await finishCurrent(page)
  await expectPlaying(page, mediaIds[0])
  await expect(page.locator('video.player-media')).toHaveAttribute('data-warmed', 'first')
  await finishCurrent(page) // Last first-video item wraps to the same first video.
  await expectPlaying(page, mediaIds[0])
  await expect(page.locator('video')).toHaveCount(2)
  await expect.poll(() => page.locator('video.player-media').evaluate((video: HTMLVideoElement) => video.currentTime < 5)).toBeTruthy()

  await page.locator('video').evaluateAll(videos => { Object.assign(window, { replacedVideos: videos }) })
  await send(request, displayId, 'media.play', { mediaId: mediaIds[1] })
  await expectPlaying(page, mediaIds[1])
  await expect(page.locator('video')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { replacedVideos: HTMLVideoElement[] }).replacedVideos
    .every(video => !video.isConnected && video.paused && !video.getAttribute('src')))).toBeTruthy()
})

test('a failed preload leaves the current video playing and retries when that queued video becomes active', async ({ page, request }) => {
  const { eventId, displayId, mediaIds } = await setup(page, request, 2)
  let rejectPreload = true
  let nativeRequests = 0
  await page.route(`**/api/media/${mediaIds[1]}/content`, async route => {
    // Let the server's explicit preparation reachability probe behave normally.
    if (route.request().resourceType() !== 'media') { await route.continue(); return }
    nativeRequests++
    if (rejectPreload) await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary video failure' })
    else await route.continue()
  })
  await playPlaylist(request, eventId, displayId, mediaIds)
  await expectPlaying(page, mediaIds[0])
  const queued = page.locator('video.player-preload')
  await expect.poll(() => queued.evaluate((video: HTMLVideoElement) => video.error !== null)).toBeTruthy()
  await queued.evaluate(video => video.setAttribute('data-preload-failed', 'yes'))
  const failedRequests = nativeRequests
  expect(failedRequests).toBeGreaterThan(0)

  const checkpoint = await page.locator('video.player-media').evaluate((video: HTMLVideoElement) => video.currentTime)
  await expect.poll(() => page.locator('video.player-media').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(checkpoint + 0.3)
  await expect.poll(async () => {
    const display = (await (await request.get(`/api/displays?eventId=${eventId}`)).json())[0]
    return { state: display.actualPlaybackState, mediaId: display.actualMediaAssetId }
  }).toEqual({ state: 'Playing', mediaId: mediaIds[0] })

  rejectPreload = false
  await finishCurrent(page)
  await expectPlaying(page, mediaIds[1])
  await expect(page.locator('video.player-media')).toHaveAttribute('data-preload-failed', 'yes')
  expect(nativeRequests).toBeGreaterThan(failedRequests)
  await expect(page.locator('video.player-preload')).toHaveCount(0)

  await finishCurrent(page)
  await expect(page.locator('video.player-media')).toBeHidden()
  await expect.poll(async () => (await (await request.get(`/api/displays?eventId=${eventId}`)).json())[0].actualPlaybackState)
    .toBe('Ended')
  expect(await page.locator('video.player-media').evaluate((video: HTMLVideoElement) => video.paused)).toBeTruthy()
})
