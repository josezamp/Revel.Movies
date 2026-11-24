import { test, expect, type Page, type APIRequestContext } from './adminFixture'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Keep successful audio playback independent of Chromium's engagement history.
// The blocked-autoplay test below injects the denial explicitly.
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }, serviceWorkers: 'block' })

let clip: Buffer
test.beforeAll(async ({}, testInfo) => {
  const path = testInfo.outputPath('player-audio.mp4')
  execFileSync(process.env.REVEL_TEST_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '60',
    '-c:v', 'libx264', '-threads', '1', '-g', '10', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', path],
  { windowsHide: true, timeout: 30_000 })
  clip = readFileSync(path)
})

async function setup(page: Page, request: APIRequestContext, count = 1) {
  const created = await request.post('/api/events', { data: { name: `Audio ${Date.now()}`, timeZone: 'UTC' } })
  expect(created.ok()).toBeTruthy()
  const { id: eventId } = await created.json()
  await page.goto('/player')
  await expect(page.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await page.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const paired = await request.post('/api/displays/pair', { data: { eventId, code, name: 'TV Audio' } })
  expect(paired.ok()).toBeTruthy()
  const { id: displayId } = await paired.json()
  await expect(page.locator('.pairing-screen')).toHaveCount(0)
  const mediaIds: string[] = []
  for (let index = 0; index < count; index++) {
    const uploaded = await request.post(`/api/events/${eventId}/media`, { multipart: {
      file: { name: `audio-${index}.mp4`, mimeType: 'video/mp4', buffer: clip },
    } })
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy()
    mediaIds.push((await uploaded.json()).id)
  }
  return { eventId, displayId, mediaIds }
}

async function send(request: APIRequestContext, displayId: string, type: string, payload?: unknown) {
  const response = await request.post(`/api/displays/${displayId}/commands`, { data: { type, payload } })
  expect(response.status(), await response.text()).toBe(202)
}

async function settings(request: APIRequestContext, displayId: string, audioEnabled: boolean) {
  const response = await request.put(`/api/displays/${displayId}/settings`, { data: { audioEnabled } })
  expect(response.ok(), await response.text()).toBeTruthy()
  expect((await response.json()).audioEnabled).toBe(audioEnabled)
}

async function expectPlaying(page: Page, muted: boolean) {
  const video = page.locator('video.player-media')
  await expect(video).toHaveJSProperty('muted', muted)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
    !element.paused && element.currentTime > 0.3)).toBeTruthy()
}

async function finishCurrent(page: Page) {
  await page.locator('video.player-media').evaluate((video: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
    const ended = () => { window.clearTimeout(timeout); resolve() }
    const timeout = window.setTimeout(() => {
      video.removeEventListener('ended', ended)
      reject(new Error('The active audio/video did not end after seeking'))
    }, 5000)
    video.addEventListener('ended', ended, { once: true })
    video.currentTime = Math.max(0, video.duration - 2)
  }))
}

test('audio is enabled by default and remote mute changes keep the playing video and position', async ({ page, request }) => {
  const { eventId, displayId, mediaIds } = await setup(page, request)
  const displays = await (await request.get(`/api/displays?eventId=${eventId}`)).json()
  expect(displays.find((item: { id: string }) => item.id === displayId).audioEnabled).toBe(true)
  await send(request, displayId, 'media.play', { mediaId: mediaIds[0] })
  await expectPlaying(page, false)
  const video = page.locator('video.player-media')
  const checkpoint = await video.evaluate((element: HTMLVideoElement) => {
    element.dataset.originalVideo = 'yes'
    element.dataset.reloads = '0'
    element.addEventListener('loadstart', () => { element.dataset.reloads = String(Number(element.dataset.reloads) + 1) })
    return element.currentTime
  })

  await settings(request, displayId, false)
  await expectPlaying(page, true)
  await settings(request, displayId, true)
  await expectPlaying(page, false)
  await expect(video).toHaveAttribute('data-original-video', 'yes')
  await expect(video).toHaveAttribute('data-reloads', '0')
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThanOrEqual(checkpoint)
  await expect(page.getByRole('button', { name: 'Activar audio', exact: true })).toHaveCount(0)
})

test('changing audio while paused does not resume or seek the video', async ({ page, request }) => {
  const { displayId, mediaIds } = await setup(page, request)
  await send(request, displayId, 'media.play', { mediaId: mediaIds[0] })
  await expectPlaying(page, false)
  await send(request, displayId, 'media.pause')
  const video = page.locator('video.player-media')
  await expect(video).toHaveJSProperty('paused', true)
  const position = await video.evaluate((element: HTMLVideoElement) => element.currentTime)

  for (const enabled of [false, true]) {
    await settings(request, displayId, enabled)
    await expect(video).toHaveJSProperty('muted', !enabled)
    await expect(video).toHaveJSProperty('paused', true)
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(position, 2)
  }
  await send(request, displayId, 'playback.resume')
  await expectPlaying(page, false)
})

test('the screen audio switch saves the setting and applies it to the connected player', async ({ page, context, request }, testInfo) => {
  const { eventId, displayId, mediaIds } = await setup(page, request)
  await send(request, displayId, 'media.play', { mediaId: mediaIds[0], loop: true })
  await expectPlaying(page, false)
  const admin = await context.newPage()
  await admin.setViewportSize({ width: 360, height: 800 })
  await admin.goto(`/admin?event=${eventId}`)
  await admin.locator('.display-details > summary').click()
  const audio = admin.getByRole('switch', { name: 'Audio de TV Audio', exact: true })
  await expect(audio).toBeChecked()
  await audio.click()
  await expect(audio).not.toBeChecked()
  await expect(audio).toBeEnabled()
  await expectPlaying(page, true)
  await audio.scrollIntoViewIfNeeded()
  expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await admin.screenshot({ path: testInfo.outputPath('screen-audio-mobile.png') })

  await admin.reload()
  await admin.locator('.display-details > summary').click()
  await expect(audio).not.toBeChecked()
  await audio.click()
  await expect(audio).toBeChecked()
  await expectPlaying(page, false)
  await admin.close()
})

test('the saved audio setting survives reloads and changes made while the player is disconnected', async ({ page, request }) => {
  const { displayId, mediaIds } = await setup(page, request)
  await settings(request, displayId, false)
  await send(request, displayId, 'media.play', { mediaId: mediaIds[0], loop: true })
  await expectPlaying(page, true)
  await page.reload()
  await expectPlaying(page, true)
  await expect(page.getByRole('button', { name: 'Activar audio', exact: true })).toHaveCount(0)

  await page.goto('about:blank')
  await settings(request, displayId, true)
  await page.goto('/player')
  await expectPlaying(page, false)
})

test('a delayed identity response cannot undo a newer remote mute command during recovery', async ({ page, request }) => {
  const { displayId, mediaIds } = await setup(page, request)
  await send(request, displayId, 'media.play', { mediaId: mediaIds[0], loop: true })
  await expectPlaying(page, false)
  const token = await page.evaluate(() => localStorage.getItem('revel-movies.device-token')!)
  const diagnostics = async () => {
    const response = await request.get('/api/player/diagnostics', { headers: { 'X-Device-Token': token } })
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json() as Promise<{ acknowledgements: { commandId: string; commandType: string; status: string }[] }>
  }
  const previousIds = new Set((await diagnostics()).acknowledgements.map(item => item.commandId))
  let connected = false
  let captured = false
  let release!: () => void
  const released = new Promise<void>(resolve => { release = resolve })
  page.on('websocket', socket => {
    if (socket.url().includes('/api/hubs/player')) connected = true
  })
  await page.route('**/api/player/identity', async route => {
    // StrictMode can duplicate the initial identity read. Hold the refresh that
    // follows connection.start(), when SignalR can already deliver new settings.
    if (!connected || captured) { await route.continue(); return }
    const snapshot = await route.fetch()
    expect((await snapshot.json()).audioEnabled).toBe(true)
    captured = true
    await released
    await route.fulfill({ response: snapshot })
  })

  try {
    await page.reload()
    await expect.poll(() => captured).toBe(true)
    await settings(request, displayId, false)
    await expect.poll(async () => (await diagnostics()).acknowledgements.some(item =>
      !previousIds.has(item.commandId) && item.commandType === 'display.settings' && item.status === 'executed')).toBe(true)
    release()
    await expectPlaying(page, true)
    await expect(page.getByRole('button', { name: 'Activar audio', exact: true })).toHaveCount(0)
  } finally {
    release()
  }
})

test('only the active playlist video has audio and transitions keep the display mute setting', async ({ page, request }) => {
  const { eventId, displayId, mediaIds } = await setup(page, request, 3)
  const saved = await request.post(`/api/events/${eventId}/playlists`, { data: {
    name: 'Audio queue', isLoop: true, items: mediaIds.map(mediaAssetId => ({ mediaAssetId })),
  } })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  const { id } = await saved.json()
  const started = await request.post(`/api/playlists/${id}/play`, { data: { targetType: 'display', targetId: displayId } })
  expect(started.ok(), await started.text()).toBeTruthy()
  await expectPlaying(page, false)
  await expect(page.locator('video.player-preload')).toHaveCount(2)
  expect(await page.locator('video.player-preload').evaluateAll(videos =>
    videos.every(element => (element as HTMLVideoElement).paused && (element as HTMLVideoElement).muted))).toBe(true)

  await finishCurrent(page)
  await expect(page.locator('video.player-media')).toHaveAttribute('src', new RegExp(mediaIds[1]))
  await expectPlaying(page, false)
  await settings(request, displayId, false)
  await expectPlaying(page, true)
  await finishCurrent(page)
  await expect(page.locator('video.player-media')).toHaveAttribute('src', new RegExp(mediaIds[2]))
  await expectPlaying(page, true)
  expect(await page.locator('video').evaluateAll(videos => videos.every(element => (element as HTMLVideoElement).muted))).toBe(true)

  await settings(request, displayId, true)
  await expectPlaying(page, false)
  expect(await page.locator('video.player-preload').evaluateAll(videos =>
    videos.every(element => (element as HTMLVideoElement).paused && (element as HTMLVideoElement).muted))).toBe(true)
})

test('blocked audible autoplay keeps the picture playing and a local click activates audio', async ({ page, request }, testInfo) => {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play
    let localInteraction = false
    document.addEventListener('click', event => {
      if (event.isTrusted) localInteraction = true
    }, true)
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted && !localInteraction) {
        this.dataset.audioDenials = String(Number(this.dataset.audioDenials ?? 0) + 1)
        return Promise.reject(new DOMException('Local interaction required', 'NotAllowedError'))
      }
      return nativePlay.call(this)
    }
  })
  const { displayId, mediaIds } = await setup(page, request)
  await send(request, displayId, 'media.play', { mediaId: mediaIds[0] })
  await expectPlaying(page, true)
  const video = page.locator('video.player-media')
  await expect(video).toHaveAttribute('data-audio-denials', /[1-9]/)
  const activate = page.getByRole('button', { name: 'Activar audio', exact: true })
  await expect(activate).toBeVisible()
  const checkpoint = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
  await page.screenshot({ path: testInfo.outputPath('activate-audio.png') })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(checkpoint + 0.3)

  await activate.click()
  await expectPlaying(page, false)
  await expect(activate).toHaveCount(0)
  await settings(request, displayId, false)
  await expectPlaying(page, true)
  await expect(activate).toHaveCount(0)
})
