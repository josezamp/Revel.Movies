import { test, expect, type Page, type APIRequestContext } from './adminFixture'
import { readFileSync } from 'node:fs'

async function setup(page: Page, request: APIRequestContext) {
  const created = await request.post('/api/events', { data: { name: `Image fit ${Date.now()}`, timeZone: 'UTC' } })
  expect(created.ok()).toBeTruthy()
  const { id: eventId } = await created.json()
  await page.goto('/player')
  await expect(page.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await page.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const paired = await request.post('/api/displays/pair', { data: { eventId, code, name: 'TV Ajuste' } })
  expect(paired.ok()).toBeTruthy()
  const { id: displayId } = await paired.json()
  await expect(page.locator('.pairing-screen')).toHaveCount(0)
  return { eventId, displayId }
}

async function settings(request: APIRequestContext, displayId: string, data: { imageFit?: string; rotation?: number }) {
  const response = await request.put(`/api/displays/${displayId}/settings`, { data })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function send(request: APIRequestContext, displayId: string, type: string, payload?: unknown) {
  const response = await request.post(`/api/displays/${displayId}/commands`, { data: { type, payload } })
  expect(response.status(), await response.text()).toBe(202)
}

async function upload(request: APIRequestContext, eventId: string, name: string, mimeType: string, buffer: Buffer) {
  const response = await request.post(`/api/events/${eventId}/media`, { multipart: { file: { name, mimeType, buffer } } })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).id as string
}

async function landscapeImage(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 300
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ef4444'
    context.fillRect(0, 0, 100, 300)
    context.fillStyle = '#22c55e'
    context.fillRect(100, 0, 200, 300)
    context.fillStyle = '#3b82f6'
    context.fillRect(300, 0, 100, 300)
    context.fillStyle = '#facc15'
    context.beginPath()
    context.arc(200, 150, 30, 0, Math.PI * 2)
    context.fill()
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(data, 'base64')
}

// Inspect the browser's rendered pixels, including CSS fitting and rotation.
// The colored sides must disappear in cover mode, and the circle must stay round.
async function renderedImage(page: Page, path?: string) {
  const screenshot = await page.screenshot({ path, animations: 'disabled' })
  return page.evaluate(async encoded => {
    const image = new Image()
    image.src = `data:image/png;base64,${encoded}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    let minX = image.width, maxX = -1, minY = image.height, maxY = -1
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const index = (y * image.width + x) * 4
        if (pixels[index] > 240 && pixels[index + 1] > 190 && pixels[index + 1] < 220 && pixels[index + 2] < 40) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x)
          minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        }
      }
    }
    const corner = (20 * image.width + 20) * 4
    return { corner: Array.from(pixels.slice(corner, corner + 3)), circleWidth: maxX - minX + 1, circleHeight: maxY - minY + 1 }
  }, screenshot.toString('base64'))
}

test('a 4:3 image fills a vertical TV with centered cropping, stays round, and recovers its saved fit', async ({ page, context, request }, testInfo) => {
  test.setTimeout(60_000)
  const { eventId, displayId } = await setup(page, request)
  const mediaId = await upload(request, eventId, 'Formato 4-3.png', 'image/png', await landscapeImage(page))
  await send(request, displayId, 'media.play', { mediaId })
  const picture = page.locator('img.player-media')
  await expect(picture).toBeVisible()
  await expect(picture).toHaveJSProperty('naturalWidth', 400)
  await picture.evaluate(image => image.setAttribute('data-original-media', 'yes'))

  const admin = await context.newPage()
  await admin.setViewportSize({ width: 360, height: 800 })
  await admin.goto(`/admin?event=${eventId}`)
  await admin.locator('.display-details > summary').click()
  const orientation = admin.getByRole('combobox', { name: 'Orientación de TV Ajuste', exact: true })
  const fit = admin.getByRole('combobox', { name: 'Ajuste de imagen de TV Ajuste', exact: true })
  await expect(fit).toHaveValue('contain')
  await orientation.selectOption('90')
  await expect(page.locator('.player-viewport')).toHaveClass(/rotation-90/)
  await expect(picture).toHaveCSS('object-fit', 'contain')
  expect((await renderedImage(page, testInfo.outputPath('4-3-complete.png'))).corner).toEqual([0, 0, 0])

  await fit.selectOption('cover')
  await expect(picture).toHaveCSS('object-fit', 'cover')
  await expect(picture).toHaveCSS('object-position', '50% 50%')
  await expect(picture).toHaveAttribute('data-original-media', 'yes')
  const cropped = await renderedImage(page, testInfo.outputPath('4-3-cropped.png'))
  expect(cropped.corner).toEqual([34, 197, 94])
  expect(cropped.circleWidth).toBeGreaterThan(250)
  expect(Math.abs(cropped.circleWidth - cropped.circleHeight)).toBeLessThanOrEqual(2)
  await expect(admin.locator('.live-preview > img')).toHaveCSS('object-fit', 'cover')
  expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await fit.scrollIntoViewIfNeeded()
  await admin.screenshot({ path: testInfo.outputPath('image-fit-mobile.png'), fullPage: true })

  await orientation.selectOption('270')
  await expect(page.locator('.player-viewport')).toHaveClass(/rotation-270/)
  await expect(picture).toHaveCSS('object-fit', 'cover')
  await expect(picture).toHaveAttribute('data-original-media', 'yes')
  expect((await renderedImage(page)).corner).toEqual([34, 197, 94])
  await page.reload()
  await expect(picture).toBeVisible()
  await expect(picture).toHaveJSProperty('naturalWidth', 400)
  await expect(picture).toHaveCSS('object-fit', 'cover')
  await expect(page.locator('.player-viewport')).toHaveClass(/rotation-270/)

  await page.goto('about:blank')
  await fit.selectOption('contain')
  await expect(fit).toBeEnabled()
  await page.goto('/player')
  await expect(picture).toBeVisible()
  await expect(picture).toHaveJSProperty('naturalWidth', 400)
  await expect(picture).toHaveCSS('object-fit', 'contain')
  await expect(page.locator('.player-viewport')).toHaveClass(/rotation-270/)
  expect((await renderedImage(page)).corner).toEqual([0, 0, 0])
  await admin.close()
})

for (const canvasMode of [false, true]) {
  test.describe(canvasMode ? 'Tizen canvas video' : 'native video', () => {
    test.use(canvasMode
      ? { userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36', viewport: { width: 1280, height: 720 } }
      : { viewport: { width: 720, height: 1280 } })

    test('a 16:9 video changes fit without remounting or moving the paused playback position', async ({ page, request }, testInfo) => {
      const { eventId, displayId } = await setup(page, request)
      if (canvasMode) await settings(request, displayId, { rotation: 90 })
      const mediaId = await upload(request, eventId, 'Horizontal.mp4', 'video/mp4', readFileSync(new URL('../fixtures/picker-preview.mp4', import.meta.url)))
      await send(request, displayId, 'media.play', { mediaId, loop: true })
      const video = page.locator('video.player-media')
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
      await send(request, displayId, 'media.pause')
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBeTruthy()
      const position = await video.evaluate((element: HTMLVideoElement) => {
        element.dataset.originalMedia = 'yes'
        return element.currentTime
      })
      const surface = canvasMode ? page.locator('canvas.player-video-canvas') : video
      await expect(surface).toBeVisible()
      await expect(surface).toHaveCSS('object-fit', 'contain')
      await settings(request, displayId, { imageFit: 'cover' })
      await expect(surface).toHaveCSS('object-fit', 'cover')
      await expect(surface).toHaveCSS('object-position', '50% 50%')
      await expect(video).toHaveAttribute('data-original-media', 'yes')
      expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(position, 2)
      expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBeTruthy()
      const dimensions = await surface.evaluate(element => ({ width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight }))
      expect(dimensions).toEqual({ width: 720, height: 1280 })
      if (canvasMode) {
        await expect(video).toHaveClass(/player-video-canvas-source/)
        expect(await surface.evaluate((element: HTMLCanvasElement) => element.width / element.height)).toBeCloseTo(16 / 9, 2)
      } else {
        await expect(page.locator('canvas.player-video-canvas')).toHaveCount(0)
      }
      await page.screenshot({ path: testInfo.outputPath('video-cropped.png') })
      await settings(request, displayId, { imageFit: 'contain' })
      await expect(surface).toHaveCSS('object-fit', 'contain')
      await expect(video).toHaveAttribute('data-original-media', 'yes')
      expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(position, 2)
    })
  })
}
