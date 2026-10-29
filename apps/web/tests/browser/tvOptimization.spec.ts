import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

async function openLibrary(page: Page, id: string) {
  await page.goto('/admin')
  await page.getByLabel('Evento activo').selectOption(id)
  await page.getByRole('button', { name: 'Contenido', exact: true }).click()
}

async function createEvent(request: APIRequestContext) {
  const created = await request.post('/api/events', { data: { name: `TV ${Date.now()}`, timeZone: 'UTC' } })
  expect(created.ok()).toBeTruthy()
  return (await created.json()).id as string
}

test('real FFmpeg conversion survives navigation and preserves the original, previews and playlist choice', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000)
  const eventId = await createEvent(request)
  const capabilities = await (await request.get(`/api/events/${eventId}/media-optimizations`)).json()
  test.skip(!capabilities.available, 'Set TvOptimization__Enabled=true and install FFmpeg/FFprobe for this integration test.')
  const input = testInfo.outputPath('original.mp4')
  execFileSync(process.env.REVEL_TEST_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    'testsrc2=size=1280x720:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264',
    '-preset', 'ultrafast', '-crf', '8', '-threads', '2', '-c:a', 'aac', input], { windowsHide: true, timeout: 30_000 })
  const bytes = readFileSync(input)
  const upload = await request.post(`/api/events/${eventId}/media`, { multipart: { file: { name: 'Anuncio.mp4', mimeType: 'video/mp4', buffer: bytes } } })
  expect(upload.ok()).toBeTruthy()
  const original = await upload.json()
  await openLibrary(page, eventId)
  const originalCard = page.locator('.library-card').filter({ has: page.locator('strong[title="Anuncio"]') })
  await expect(originalCard.getByRole('button', { name: 'Reducir tamaño para TV', exact: true })).toBeEnabled()
  await originalCard.getByRole('button', { name: 'Reducir tamaño para TV', exact: true }).click()
  await expect(originalCard).toContainText(/En cola para TV|Reduciendo para TV|Copia TV lista/)
  await openLibrary(page, eventId)
  await expect(originalCard).toContainText('Copia TV lista', { timeout: 30_000 })
  const library = await (await request.get(`/api/events/${eventId}/media`)).json()
  expect(library).toHaveLength(2)
  const copy = library.find((item: { id: string }) => item.id !== original.id)
  expect(copy.fileSize).toBeLessThan(original.fileSize)
  expect((await (await request.get(original.contentUrl)).body()).equals(bytes)).toBeTruthy()
  await originalCard.getByRole('button', { name: 'Ver copia TV' }).click()
  await expect(page.getByRole('dialog')).toContainText('Anuncio · TV')
  await expect(page.getByRole('dialog').locator('video')).toHaveAttribute('src', copy.contentUrl)
  await page.keyboard.press('Escape')
  const copyCard = page.locator('.library-card').filter({ has: page.locator('strong[title="Anuncio · TV"]') })
  await copyCard.getByRole('button', { name: 'Ver original' }).click()
  await expect(page.getByRole('dialog').locator('video')).toHaveAttribute('src', original.contentUrl)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: testInfo.outputPath('tv-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 360, height: 800 })
  await originalCard.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('tv-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Seleccionar', exact: true }).click()
  await copyCard.getByRole('button', { name: 'Seleccionar archivo', exact: true }).click()
  await page.getByRole('button', { name: 'Agregar a playlist', exact: true }).click()
  await page.getByLabel('Nombre de la playlist').fill('Copia para TV')
  await page.getByRole('button', { name: 'Crear y agregar archivos' }).click()
  await expect(page.getByRole('heading', { name: 'Copia para TV', exact: true })).toBeVisible()
  const playlists = await (await request.get(`/api/events/${eventId}/playlists`)).json()
  expect(playlists[0].items[0].mediaAssetId).toBe(copy.id)
})

test('missing server tools disable the action with an explanation', async ({ page, request }) => {
  const eventId = await createEvent(request)
  const bytes = Buffer.alloc(64); bytes.write('ftyp', 4)
  expect((await request.post(`/api/events/${eventId}/media`, { multipart: { file: { name: 'Pendiente.mp4', mimeType: 'video/mp4', buffer: bytes } } })).ok()).toBeTruthy()
  await page.route(`**/api/events/${eventId}/media-optimizations`, route => route.fulfill({ json: { available: false, jobs: [] } }))
  await openLibrary(page, eventId)
  await expect(page.getByRole('button', { name: 'Reducir tamaño para TV', exact: true })).toBeDisabled()
  await expect(page.getByText('Reducir tamaño para TV requiere habilitar FFmpeg en el servidor.')).toBeVisible()
})
