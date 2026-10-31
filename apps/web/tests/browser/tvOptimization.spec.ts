import { test, expect, type APIRequestContext, type Page } from './adminFixture'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { MediaAsset, MediaOptimization } from '../../src/api/client'

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

async function uploadVideo(request: APIRequestContext, eventId: string, name: string, size = 512) {
  const buffer = Buffer.alloc(size); buffer.write('ftyp', 4)
  const response = await request.post(`/api/events/${eventId}/media`, {
    multipart: { file: { name, mimeType: 'video/mp4', buffer } },
  })
  expect(response.ok()).toBeTruthy()
  return await response.json() as MediaAsset
}

function optimization(original: MediaAsset, copy?: MediaAsset): MediaOptimization {
  return {
    mediaId: original.id, sourceChecksum: original.checksum, status: copy ? 'Completed' : 'Processing',
    progress: copy ? 100 : 40, originalSize: original.fileSize,
    resultMediaId: copy?.id ?? null, optimizedSize: copy?.fileSize ?? null, error: null,
  }
}

test('completed TV copy replaces the library card and selection while keeping both previews and a recoverable original', async ({ page, request }) => {
  const eventId = await createEvent(request)
  const original = await uploadVideo(request, eventId, 'Anuncio.mp4')
  let job = optimization(original)
  await page.route(`**/api/events/${eventId}/media-optimizations`, route => route.fulfill({ json: { available: true, jobs: [job] } }))
  await openLibrary(page, eventId)
  const cards = page.locator('.library-card')
  const originalCard = cards.filter({ has: page.locator('strong[title="Anuncio"]') })
  await expect(originalCard).toContainText('Reduciendo para TV')
  await page.getByRole('button', { name: 'Seleccionar', exact: true }).click()
  await originalCard.getByRole('button', { name: 'Seleccionar archivo', exact: true }).click()
  await expect(page.locator('.library-selection-bar')).toContainText('1 seleccionado')

  const copy = await uploadVideo(request, eventId, 'Anuncio · TV.mp4', 128)
  job = optimization(original, copy)
  const copyCard = cards.filter({ has: page.locator('strong[title="Anuncio · TV"]') })
  await expect(copyCard).toBeVisible({ timeout: 10_000 })
  await expect(cards).toHaveCount(1)
  await expect(originalCard).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Biblioteca 1', exact: true })).toBeVisible()
  await expect(page.getByText('1 de 1 elementos', { exact: true })).toBeVisible()
  await expect(copyCard.getByRole('button', { name: 'Quitar de la selección', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.library-selection-bar')).toContainText('1 seleccionado')
  await expect(copyCard).toContainText('75% menos')
  await copyCard.getByRole('button', { name: 'Vista previa local', exact: true }).click()
  await expect(page.getByRole('dialog').locator('video')).toHaveAttribute('src', copy.contentUrl)
  await page.keyboard.press('Escape')
  await copyCard.getByRole('button', { name: 'Ver original', exact: true }).click()
  await expect(page.getByRole('dialog').locator('video')).toHaveAttribute('src', original.contentUrl)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Agregar a playlist', exact: true }).click()
  await expect(page.getByRole('dialog').locator('.playlist-selection-summary li')).toHaveCount(1)
  await page.getByLabel('Nombre de la playlist').fill('Video reducido')
  await page.getByRole('button', { name: 'Crear y agregar archivos' }).click()
  await expect(page.getByRole('heading', { name: 'Video reducido', exact: true })).toBeVisible()
  const playlists = await (await request.get(`/api/events/${eventId}/playlists`)).json()
  expect(playlists[0].items.map((item: { mediaAssetId: string }) => item.mediaAssetId)).toEqual([copy.id])

  await page.getByRole('button', { name: 'Biblioteca 1', exact: true }).click()
  await copyCard.getByRole('button', { name: 'Eliminar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar archivo', exact: true }).click()
  await expect(originalCard).toBeVisible()
  await expect(cards).toHaveCount(1)
  await expect(originalCard.getByRole('button', { name: 'Reducir tamaño para TV', exact: true })).toBeEnabled()
  expect((await request.get(original.contentUrl)).ok()).toBeTruthy()
  await page.reload()
  await expect(originalCard).toBeVisible()
  await expect(cards).toHaveCount(1)
})

test('replacing the original shows the new video separately from its older TV copy', async ({ page, request }) => {
  const eventId = await createEvent(request)
  const original = await uploadVideo(request, eventId, 'Anuncio.mp4')
  const copy = await uploadVideo(request, eventId, 'Anuncio · TV.mp4', 128)
  const job = optimization(original, copy)
  await page.route(`**/api/events/${eventId}/media-optimizations`, route => route.fulfill({ json: { available: true, jobs: [job] } }))
  await openLibrary(page, eventId)
  await expect(page.getByRole('button', { name: 'Ver original', exact: true })).toBeVisible()
  await expect(page.locator('.library-card')).toHaveCount(1)

  const buffer = Buffer.alloc(1024); buffer.write('ftyp', 4)
  const replacement = await request.post(`/api/events/${eventId}/media`, {
    multipart: { replaceMediaId: original.id, file: { name: original.fileName, mimeType: 'video/mp4', buffer } },
  })
  expect(replacement.ok()).toBeTruthy()
  expect((await replacement.json()).checksum).not.toBe(original.checksum)
  await openLibrary(page, eventId)
  await expect(page.locator('.library-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Ver original', exact: true })).toHaveCount(0)
  await expect(page.getByText('2 de 2 elementos', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reducir tamaño para TV', exact: true })).toHaveCount(2)
})

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
  await expect(page.locator('#media-library')).toContainText(/En cola para TV|Reduciendo para TV|Copia TV lista|Copia para TV/)
  await openLibrary(page, eventId)
  const copyCard = page.locator('.library-card').filter({ has: page.locator('strong[title="Anuncio · TV"]') })
  await expect(copyCard).toBeVisible({ timeout: 30_000 })
  await expect(originalCard).toHaveCount(0)
  await expect(page.locator('.library-card')).toHaveCount(1)
  const library = await (await request.get(`/api/events/${eventId}/media`)).json()
  expect(library).toHaveLength(2)
  const copy = library.find((item: { id: string }) => item.id !== original.id)
  expect(copy.fileSize).toBeLessThan(original.fileSize)
  expect((await (await request.get(original.contentUrl)).body()).equals(bytes)).toBeTruthy()
  await copyCard.getByRole('button', { name: 'Vista previa local' }).click()
  await expect(page.getByRole('dialog')).toContainText('Anuncio · TV')
  await expect(page.getByRole('dialog').locator('video')).toHaveAttribute('src', copy.contentUrl)
  await page.keyboard.press('Escape')
  await copyCard.getByRole('button', { name: 'Ver original' }).click()
  await expect(page.getByRole('dialog').locator('video')).toHaveAttribute('src', original.contentUrl)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: testInfo.outputPath('tv-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 360, height: 800 })
  await copyCard.scrollIntoViewIfNeeded()
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
