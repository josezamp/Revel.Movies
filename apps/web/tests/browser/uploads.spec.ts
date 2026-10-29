import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=', 'base64')
const file = (name: string, buffer = png) => ({ name, mimeType: 'image/png', buffer })

async function openLibrary(page: Page, request: APIRequestContext) {
  const created = await request.post('/api/events', { data: { name: `Subidas ${Date.now()}`, timeZone: 'UTC' } })
  expect(created.ok()).toBeTruthy()
  const { id } = await created.json()
  await page.goto('/admin')
  await page.getByLabel('Evento activo').selectOption(id)
  await page.getByRole('button', { name: 'Contenido', exact: true }).click()
  return id as string
}

test('60 files upload without secure-context UUID support and keep selection order', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined }))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const eventId = await openLibrary(page, request)
  const files = Array.from({ length: 60 }, (_, index) => file(`imagen-${String(index).padStart(2, '0')}.png`))
  await page.getByLabel('Agregar archivos a la cola').setInputFiles(files)
  const queue = page.locator('.upload-queue')
  await expect(queue.locator('li')).toHaveCount(60)
  await page.getByRole('button', { name: 'Subir archivos pendientes' }).click()
  await expect(queue).toContainText('60 de 60 archivos subidos', { timeout: 60_000 })
  expect((await (await request.get(`/api/events/${eventId}/media`)).json()).length).toBe(60)
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('uploads-desktop.png'), fullPage: false })
  await page.getByRole('button', { name: 'Agregar subidos a una playlist' }).click()
  await page.getByLabel('Nombre de la playlist').fill('Sesenta en orden')
  await page.getByRole('button', { name: 'Crear y agregar archivos' }).click()
  await expect(page.getByRole('heading', { name: 'Sesenta en orden' })).toBeVisible()
  const playlists = await (await request.get(`/api/events/${eventId}/playlists`)).json()
  expect(playlists[0].items.map((item: { mediaName: string }) => item.mediaName)).toEqual(files.map(item => item.name.replace('.png', '')))
})

test('duplicates in the library can be skipped or replaced without changing their identity', async ({ page, request }, testInfo) => {
  const eventId = await openLibrary(page, request)
  const initial = await request.post(`/api/events/${eventId}/media`, { multipart: { file: file('logo.png') } })
  const original = await initial.json()
  await page.reload()
  await page.getByLabel('Evento activo').selectOption(eventId)
  await page.getByRole('button', { name: 'Contenido', exact: true }).click()
  await page.setViewportSize({ width: 360, height: 800 })
  const changed = Buffer.concat([png, Buffer.from('new')])
  await page.getByLabel('Agregar archivos a la cola').setInputFiles([file('LOGO.PNG', changed), file('nuevo.png')])
  const dialog = page.getByRole('dialog', { name: 'Archivo duplicado' })
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('duplicate-mobile.png'), fullPage: false })
  await dialog.getByRole('button', { name: 'Omitir', exact: true }).click()
  await page.getByRole('button', { name: 'Subir archivos pendientes' }).click()
  await expect(page.locator('.upload-queue')).toContainText('1 de 2 archivos subidos')
  await expect(page.locator('.upload-queue')).toContainText('1 omitidos')
  expect((await (await request.get(`/api/media/${original.id}`)).json()).checksum).toBe(original.checksum)
  await page.getByLabel('Agregar archivos a la cola').setInputFiles(file('LOGO.PNG', changed))
  await dialog.getByRole('button', { name: 'Reemplazar', exact: true }).click()
  await page.getByRole('button', { name: 'Subir archivos pendientes' }).click()
  await expect(page.locator('.upload-queue')).toContainText('2 de 3 archivos subidos')
  const library = await (await request.get(`/api/events/${eventId}/media`)).json()
  expect(library).toHaveLength(2)
  expect(library.find((item: { id: string }) => item.id === original.id).checksum).not.toBe(original.checksum)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('uploads-mobile.png'), fullPage: false })
})

test('same-batch duplicates apply a bulk decision and replacements run after their originals', async ({ page, request }) => {
  const eventId = await openLibrary(page, request)
  const changed = Buffer.concat([png, Buffer.from('replacement')])
  await page.getByLabel('Agregar archivos a la cola').setInputFiles([
    file('a.png'), file('b.png'), file('A.PNG', changed), file('B.PNG', changed),
  ])
  const dialog = page.getByRole('dialog', { name: 'Archivo duplicado' })
  await dialog.getByRole('checkbox', { name: /Aplicar a todos/ }).check()
  await dialog.getByRole('button', { name: 'Reemplazar todos', exact: true }).click()
  await page.getByRole('button', { name: 'Subir archivos pendientes' }).click()
  await expect(page.locator('.upload-queue')).toContainText('4 de 4 archivos subidos')
  const library = await (await request.get(`/api/events/${eventId}/media`)).json()
  expect(library).toHaveLength(2)
  for (const asset of library) {
    expect(asset.fileSize).toBe(changed.length)
    expect(await (await request.get(asset.contentUrl)).body()).toEqual(changed)
  }
  await page.getByLabel('Agregar archivos a la cola').setInputFiles([file('a.png'), file('b.png')])
  await dialog.getByRole('checkbox', { name: /Aplicar a todos/ }).check()
  await dialog.getByRole('button', { name: 'Omitir todos', exact: true }).click()
  await expect(page.locator('.upload-queue')).toContainText('2 omitidos')
  expect((await (await request.get(`/api/events/${eventId}/media`)).json()).length).toBe(2)
})

test('a server conflict is reviewable and a failed file retries without repeating successes', async ({ page, request }) => {
  const eventId = await openLibrary(page, request)
  // Another operator uploads after this page fetched the library.
  await request.post(`/api/events/${eventId}/media`, { multipart: { file: file('concurrente.png') } })
  let attempts = 0
  await page.route(`**/api/events/${eventId}/media`, async route => {
    if (route.request().method() === 'POST' && route.request().postDataBuffer()?.includes(Buffer.from('reintentar.png'))) {
      attempts++
      if (attempts === 1) { await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); return }
    }
    await route.continue()
  })
  await page.getByLabel('Agregar archivos a la cola').setInputFiles([file('concurrente.png'), file('reintentar.png'), file('correcto.png')])
  await page.getByRole('button', { name: 'Subir archivos pendientes' }).click()
  const dialog = page.getByRole('dialog', { name: 'Archivo duplicado' })
  await expect(dialog).toBeVisible()
  // The admin polls in the background; that rerender must not forget the server conflict.
  await page.waitForResponse(response => response.url().endsWith('/api/events') && response.request().method() === 'GET')
  await dialog.getByRole('button', { name: 'Reemplazar', exact: true }).click()
  const queue = page.locator('.upload-queue')
  await expect(queue).toContainText('2 de 3 archivos subidos')
  await queue.getByRole('button', { name: 'Reintentar fallidos y cancelados' }).click()
  await expect(queue).toContainText('3 de 3 archivos subidos')
  expect(attempts).toBe(2)
  expect((await (await request.get(`/api/events/${eventId}/media`)).json()).length).toBe(3)
})

test('drag and drop validates files and changing event clears its pending queue', async ({ page, request }) => {
  await openLibrary(page, request)
  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['unsupported'], 'documento.pdf', { type: 'application/pdf' }))
    transfer.items.add(new File([], 'vacio.png', { type: 'image/png' }))
    transfer.items.add(new File(['placeholder'], 'pendiente.png', { type: 'image/png' }))
    return transfer
  })
  await page.locator('.upload-dropzone').dispatchEvent('drop', { dataTransfer: data })
  await data.dispose()
  await expect(page.locator('.upload-queue')).toContainText('Formato no compatible')
  await expect(page.locator('.upload-queue')).toContainText('El archivo está vacío')
  const other = await request.post('/api/events', { data: { name: `Otro ${Date.now()}`, timeZone: 'UTC' } })
  const otherId = (await other.json()).id
  await expect(page.getByLabel('Evento activo').locator(`option[value="${otherId}"]`)).toHaveCount(1)
  await page.getByLabel('Evento activo').selectOption(otherId)
  await expect(page.locator('.upload-queue')).toHaveCount(0)
})

test('only three transfers run together and cancelling the batch leaves it retryable', async ({ page, request }) => {
  const eventId = await openLibrary(page, request)
  let started = 0
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let paused = true
  await page.route(`**/api/events/${eventId}/media`, async route => {
    if (paused && route.request().method() === 'POST') {
      started++
      await held
      await route.abort().catch(() => undefined)
    } else await route.continue()
  })
  await page.getByLabel('Agregar archivos a la cola').setInputFiles(Array.from({ length: 5 }, (_, index) => file(`cancelar-${index}.png`)))
  await page.getByRole('button', { name: 'Subir archivos pendientes' }).click()
  await expect.poll(() => started).toBe(3)
  await page.getByRole('button', { name: 'Cancelar pendientes', exact: true }).click()
  await expect(page.locator('.upload-queue li[data-status="cancelled"]')).toHaveCount(5)
  expect(started).toBe(3)
  expect((await (await request.get(`/api/events/${eventId}/media`)).json()).length).toBe(0)
  paused = false
  release()
  await page.getByRole('button', { name: 'Reintentar fallidos y cancelados' }).click()
  await expect(page.locator('.upload-queue')).toContainText('5 de 5 archivos subidos')
  expect((await (await request.get(`/api/events/${eventId}/media`)).json()).length).toBe(5)
})
