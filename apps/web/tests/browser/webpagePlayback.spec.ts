import { test, expect, type Page, type APIRequestContext } from './adminFixture'
import { createServer, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

let site: Server
let siteUrl: string
let clip: Buffer

test.beforeAll(async ({}, testInfo) => {
  const path = testInfo.outputPath('webpage-background.mp4')
  execFileSync(process.env.REVEL_TEST_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10', '-t', '90', '-c:v', 'libx264',
    '-threads', '1', '-g', '10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path],
  { windowsHide: true, timeout: 30_000 })
  clip = readFileSync(path)
  site = createServer((_, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<html><body><h1>Contenido del enlace</h1></body></html>')
  })
  await new Promise<void>(resolve => site.listen(0, 'localhost', resolve))
  const address = site.address()
  if (!address || typeof address === 'string') throw new Error('Test site did not bind a TCP port.')
  siteUrl = `http://localhost:${address.port}`
})

test.afterAll(async () => {
  if (site) await new Promise<void>((resolve, reject) => site.close(error => error ? reject(error) : resolve()))
})

async function send(request: APIRequestContext, displayId: string, type: string, payload?: unknown) {
  const response = await request.post(`/api/displays/${displayId}/commands`, { data: { type, payload } })
  expect(response.status(), await response.text()).toBe(202)
}

async function setup(page: Page, request: APIRequestContext, playlist: boolean) {
  await page.addInitScript(() => {
    const nativeNow = performance.now.bind(performance)
    let elapsed = 0
    Object.defineProperty(performance, 'now', { value: () => nativeNow() + elapsed })
    Object.assign(window, { advanceWatchdog: () => { elapsed += 31_000 } })
  })
  const event = await request.post('/api/events', { data: { name: `Exclusive webpage ${Date.now()}`, timeZone: 'UTC' } })
  expect(event.ok()).toBeTruthy()
  const { id: eventId } = await event.json()
  await page.goto('/player')
  await expect(page.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await page.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const paired = await request.post('/api/displays/pair', { data: { eventId, code, name: 'Exclusive TV' } })
  expect(paired.ok()).toBeTruthy()
  const { id: displayId } = await paired.json()
  await expect(page.locator('.pairing-screen')).toHaveCount(0)
  const mediaIds: string[] = []
  for (let index = 0; index < (playlist ? 2 : 1); index++) {
    const uploaded = await request.post(`/api/events/${eventId}/media`, { multipart: {
      file: { name: `background-${index}.mp4`, mimeType: 'video/mp4', buffer: clip },
    } })
    expect(uploaded.ok()).toBeTruthy()
    mediaIds.push((await uploaded.json()).id)
  }
  let playlistId: string | undefined
  if (playlist) {
    const saved = await request.post(`/api/events/${eventId}/playlists`, { data: {
      name: 'Background queue', isLoop: true, items: mediaIds.map(mediaAssetId => ({ mediaAssetId })),
    } })
    expect(saved.ok()).toBeTruthy()
    playlistId = (await saved.json()).id
  }
  const play = async () => {
    if (playlistId) {
      const response = await request.post(`/api/playlists/${playlistId}/play`, { data: { targetType: 'display', targetId: displayId } })
      expect(response.ok(), await response.text()).toBeTruthy()
    } else await send(request, displayId, 'media.play', { mediaId: mediaIds[0] })
    await expect.poll(() => page.locator('video.player-media').evaluate((video: HTMLVideoElement) =>
      !video.paused && video.currentTime > 0.3)).toBeTruthy()
  }
  await play()
  return { eventId, displayId, mediaId: mediaIds[0], play }
}

for (const replaceWebPage of [true, false]) {
  test(`a temporary ${replaceWebPage ? 'webpage' : 'media'} scene replaces the other source and restores it exclusively`, async ({ page, request }) => {
    const { eventId, displayId, mediaId } = await setup(page, request, false)
    if (!replaceWebPage) {
      await send(request, displayId, 'webpage.show', { url: siteUrl })
      await expect(page.locator('iframe')).toBeVisible()
      await expect(page.locator('video')).toHaveCount(0)
    }
    const saved = await request.post(`/api/events/${eventId}/scenes`, { data: {
      name: 'Exclusive temporary source', temporaryDurationSeconds: 60,
      assignments: [{ displayIds: [displayId], groupIds: [],
        media: replaceWebPage ? { action: 'keep' } : { action: 'replace', type: 'media', mediaId },
        webPage: replaceWebPage ? { action: 'replace', payload: { url: siteUrl } } : { action: 'keep' },
        announcement: { action: 'keep' }, blackout: 'off', promotions: 'keep' }],
    } })
    expect(saved.ok(), await saved.text()).toBeTruthy()
    const scene = await saved.json()
    const prepared = await request.post(`/api/events/${eventId}/scenes/${scene.id}/prepare`, { data: { version: scene.version } })
    expect(prepared.ok(), await prepared.text()).toBeTruthy()
    const preparation = await prepared.json()
    await expect.poll(async () => (await (await request.get(`/api/scene-sessions/${preparation.id}`)).json()).status)
      .toBe(replaceWebPage ? 'network' : 'ready')
    const activated = await request.post(`/api/events/${eventId}/scenes/${scene.id}/activate`, {
      data: { version: scene.version, preparationId: preparation.id, policy: 'all' },
    })
    expect(activated.ok(), await activated.text()).toBeTruthy()
    const activation = await activated.json()
    if (replaceWebPage) {
      await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Contenido del enlace' })).toBeVisible()
      await expect(page.locator('video')).toHaveCount(0)
    } else {
      await expect.poll(() => page.locator('video.player-media').evaluate((video: HTMLVideoElement) =>
        !video.paused && video.currentTime > 0.3)).toBeTruthy()
      await expect(page.locator('iframe')).toHaveCount(0)
    }
    const restored = await request.post(`/api/scene-sessions/${activation.id}/restore`)
    expect(restored.ok(), await restored.text()).toBeTruthy()
    if (replaceWebPage) {
      await expect.poll(() => page.locator('video.player-media').evaluate((video: HTMLVideoElement) =>
        !video.paused && video.currentTime > 0.3)).toBeTruthy()
      await expect(page.locator('iframe')).toHaveCount(0)
    } else {
      await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Contenido del enlace' })).toBeVisible()
      await expect(page.locator('video')).toHaveCount(0)
    }
  })
}

for (const playlist of [false, true]) {
  test(`showing a link stops the ${playlist ? 'playlist and its preloaded queue' : 'playing video'} and recovery never restarts it`, async ({ page, request }) => {
    const { eventId, displayId, play } = await setup(page, request, playlist)
    await expect(page.locator('video')).toHaveCount(playlist ? 2 : 1)
    await page.locator('video').evaluateAll(elements => {
      const videos = elements as HTMLVideoElement[]
      for (const video of videos) {
        const nativePlay = video.play.bind(video)
        video.dataset.laterPlayAttempts = '0'
        video.play = () => {
          video.dataset.laterPlayAttempts = String(Number(video.dataset.laterPlayAttempts) + 1)
          return nativePlay()
        }
      }
      Object.assign(window, { previousVideos: videos })
    })

    await send(request, displayId, 'webpage.show', { url: siteUrl })
    await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Contenido del enlace' })).toBeVisible()
    await expect(page.locator('video, img.player-media, .player-video-canvas')).toHaveCount(0)
    const detached = await page.evaluate(() => {
      const state = window as unknown as { previousVideos: HTMLVideoElement[]; advanceWatchdog: () => void }
      for (const video of state.previousVideos) {
        for (const name of ['waiting', 'stalled', 'loadedmetadata', 'canplay']) video.dispatchEvent(new Event(name))
      }
      state.advanceWatchdog()
      return state.previousVideos.map(video => ({ paused: video.paused, connected: video.isConnected, source: video.getAttribute('src') }))
    })
    expect(detached).toEqual(Array.from({ length: playlist ? 2 : 1 }, () => ({ paused: true, connected: false, source: null })))
    // Let an uncanceled watchdog run after its simulated 30-second stall deadline.
    await page.waitForTimeout(1200)
    await expect.poll(async () => {
      const displays = await (await request.get(`/api/displays?eventId=${eventId}`)).json()
      return { media: displays[0].actualMediaAssetId, state: displays[0].actualPlaybackState }
    }).toEqual({ media: null, state: 'Idle' })
    expect(await page.evaluate(() => (window as unknown as { previousVideos: HTMLVideoElement[] }).previousVideos
      .map(video => ({ paused: video.paused, attempts: video.dataset.laterPlayAttempts })))).toEqual(
      Array.from({ length: playlist ? 2 : 1 }, () => ({ paused: true, attempts: '0' })),
    )
    await page.evaluate(() => (window as unknown as { previousVideos: HTMLVideoElement[] }).previousVideos
      .forEach(video => video.dispatchEvent(new Event('ended'))))
    await expect(page.locator('video, img.player-media')).toHaveCount(0)

    await page.reload()
    await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Contenido del enlace' })).toBeVisible()
    await expect(page.locator('video, img.player-media')).toHaveCount(0)
    await send(request, displayId, 'webpage.clear')
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect(page.locator('video, img.player-media')).toHaveCount(0)
    await send(request, displayId, 'webpage.show', { url: siteUrl })
    await expect(page.locator('iframe')).toBeVisible()
    await play()
    await expect(page.locator('iframe')).toHaveCount(0)
    await page.reload()
    await expect.poll(() => page.locator('video.player-media').evaluate((video: HTMLVideoElement) =>
      !video.paused && video.currentTime > 0.3)).toBeTruthy()
    await expect(page.locator('iframe')).toHaveCount(0)
  })
}
