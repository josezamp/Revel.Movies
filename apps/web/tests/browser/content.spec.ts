import { test, expect, type APIRequestContext } from './adminFixture'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=', 'base64')

async function event(request: APIRequestContext) {
  const response = await request.post('/api/events', { data: { name: `Contenido ${Date.now()}`, timeZone: 'UTC' } })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).id as string
}

async function display(request: APIRequestContext, eventId: string, name: string) {
  const session = await request.post('/api/player/pairing-session')
  const response = await request.post('/api/displays/pair', { data: { code: (await session.json()).code, name, eventId } })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).id as string
}

test('upload queue keeps individual success, failure, cancellation and chosen playlist order on mobile', async ({ page, request }, testInfo) => {
  const eventId = await event(request)
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/admin')
  await page.getByLabel('Evento activo').selectOption(eventId)
  await page.getByRole('button', { name: 'Contenido', exact: true }).click()
  await page.getByLabel('Agregar archivos a la cola').setInputFiles([
    { name: 'primero.png', mimeType: 'image/png', buffer: png },
    { name: 'fallido.png', mimeType: 'image/png', buffer: Buffer.from('invalid png') },
    { name: 'ultimo.png', mimeType: 'image/png', buffer: png },
    { name: 'cancelado.png', mimeType: 'image/png', buffer: png },
  ])
  const queue = page.locator('.upload-queue')
  await queue.locator('li').filter({ hasText: 'cancelado.png' }).getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(queue.locator('li').filter({ hasText: 'cancelado.png' })).toContainText('Cancelado')
  await queue.locator('li').filter({ hasText: 'primero.png' }).getByRole('button', { name: 'Vista previa', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('img')).toHaveAttribute('src', /^blob:/)
  await page.getByRole('button', { name: 'Cerrar modal' }).click()
  await page.getByRole('button', { name: 'Subir archivos pendientes' }).click()
  await expect(queue).toContainText('2 de 4 archivos subidos')
  await expect(queue.locator('li').filter({ hasText: 'fallido.png' })).toContainText('Falló')
  await queue.locator('li').filter({ hasText: 'fallido.png' }).getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(queue.locator('li').filter({ hasText: 'fallido.png' })).toContainText('Falló')
  expect((await (await request.get(`/api/events/${eventId}/media`)).json()).length).toBe(2)
  await page.getByRole('button', { name: 'Agregar subidos a una playlist' }).click()
  await page.getByLabel('Nombre de la playlist').fill('Subidos en orden')
  await page.getByRole('button', { name: 'Crear y agregar archivos' }).click()
  await expect(page.getByRole('heading', { name: 'Subidos en orden' })).toBeVisible()
  const saved = await (await request.get(`/api/events/${eventId}/playlists`)).json()
  expect(saved[0].items.map((item: { mediaName: string }) => item.mediaName)).toEqual(['primero', 'ultimo'])
  await expect(page.getByLabel('Destino de la playlist')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Aplicar cambios', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('content-mobile.png'), fullPage: true })
})

test('destinations require a choice and removing a screen never selects another', async ({ page, request }) => {
  const eventId = await event(request)
  const first = await display(request, eventId, 'Patio')
  await display(request, eventId, 'Barra')
  await page.goto('/admin')
  await page.getByLabel('Evento activo').selectOption(eventId)
  await page.getByRole('button', { name: 'Contenido', exact: true }).click()
  const destination = page.getByRole('radiogroup', { name: 'Destino de reproducción' })
  await expect(destination.getByRole('radio', { checked: true })).toHaveCount(0)
  await destination.getByRole('radio', { name: /Patio/ }).check()
  await expect(destination.getByRole('radio', { name: /Patio/ })).toBeChecked()
  expect((await request.delete(`/api/displays/${first}`)).ok()).toBeTruthy()
  await expect(destination.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(destination.getByRole('radio', { name: /Barra.*Sin conexión/ })).toHaveCount(1)
  await page.getByText('Publicar un anuncio o una cuenta regresiva', { exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Enviar a', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Mostrar anuncio · elegí destino' })).toBeDisabled()
  await page.locator('summary').filter({ hasText: 'Proyectar una página web' }).click()
  await expect(page.getByRole('combobox', { name: 'Proyectar en', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Mostrar página · elegí destino' })).toBeDisabled()
})

test('saved playlist edits stay pending after reloading the panel until explicitly applied', async ({ page, request }) => {
  const eventId = await event(request)
  const targetId = await display(request, eventId, 'Patio')
  const upload = await request.post(`/api/events/${eventId}/media`, { multipart: { file: { name: 'fondo.png', mimeType: 'image/png', buffer: png } } })
  expect(upload.ok()).toBeTruthy()
  const asset = await upload.json()
  const created = await request.post(`/api/events/${eventId}/playlists`, { data: { name: 'Ambientación', isLoop: true, items: [{ mediaAssetId: asset.id, durationSeconds: 10 }] } })
  expect(created.ok()).toBeTruthy()
  const playlist = await created.json()
  const applied = await request.post(`/api/playlists/${playlist.id}/play`, { data: { targetType: 'display', targetId } })
  expect(applied.ok()).toBeTruthy()
  expect((await request.put(`/api/playlists/${playlist.id}`, { data: { name: 'Ambientación nueva', isLoop: false } })).ok()).toBeTruthy()
  await page.goto('/admin')
  await page.getByLabel('Evento activo').selectOption(eventId)
  await page.getByRole('button', { name: 'Contenido', exact: true }).click()
  await page.getByRole('navigation', { name: 'Contenido del evento' }).getByRole('button', { name: /^Playlists/ }).click()
  await expect(page.getByText('Cambios pendientes de aplicar en Patio.', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Destino de la playlist')).toHaveValue('')
  await page.getByLabel('Destino de la playlist').selectOption(`display:${targetId}`)
  await page.getByRole('button', { name: 'Aplicar cambios en Patio', exact: true }).click()
  await expect(page.getByText('Cambios pendientes de aplicar en Patio.', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Enviado · esperando confirmación', { exact: true })).toBeVisible()
})

test('destination cards filter connection states, clear hidden selections and work with keyboard on mobile', async ({ page, request }, testInfo) => {
  const eventId = await event(request)
  const patio = await display(request, eventId, 'Patio')
  const barra = await display(request, eventId, 'Barra')
  const salon = await display(request, eventId, 'Salón')
  for (const [name, displayIds] of [['Todas', [patio, barra]], ['Conectadas', [patio, salon]], ['Vacío', []]] as const) {
    const group = await request.post(`/api/events/${eventId}/display-groups`, { data: { name, displayIds } })
    expect(group.ok()).toBeTruthy()
    const groupId = (await group.json()).id
    expect((await request.put(`/api/display-groups/${groupId}/members`, { data: { displayIds } })).ok()).toBeTruthy()
  }
  const screens = await (await request.get(`/api/displays?eventId=${eventId}`)).json()
  let online = true
  await page.route(/\/api\/displays(?:\?.*)?$/, route => route.fulfill({ json: screens.map((screen: { id: string }) => ({ ...screen,
    status: screen.id === patio && online ? 'Playing' : screen.id === salon ? 'Paused' : 'Offline' })) }))
  await page.goto(`/admin?event=${eventId}&section=content`)
  const destinations = page.getByRole('radiogroup', { name: 'Destino de reproducción' })
  const radios = destinations.getByRole('radio')
  await expect(radios).toHaveCount(6)
  await destinations.getByRole('radio', { name: /^Barra/ }).check()
  await page.getByRole('switch', { name: 'Solo en línea' }).click()
  await expect(radios).toHaveCount(3)
  await expect(destinations.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(page.locator('.destination-controls').getByRole('button', { name: 'Pausar', exact: true })).toBeDisabled()
  await expect(destinations.getByRole('radio', { name: /Grupo: Conectadas/ })).toBeVisible()
  await destinations.getByRole('radio', { name: /^Patio/ }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  await expect(destinations.getByRole('radio', { name: /^Salón/ })).toBeChecked()
  await page.getByRole('switch', { name: 'Solo en línea' }).click()
  await expect(destinations.getByRole('radio', { name: /^Salón/ })).toBeChecked()
  await page.locator('.library-play-target').screenshot({ path: testInfo.outputPath('destinations-desktop.png') })
  await page.setViewportSize({ width: 360, height: 800 })
  await destinations.getByRole('radio', { name: /Grupo: Vacío/ }).check()
  await expect(page.locator('.destination-controls').getByRole('button', { name: 'Pausar', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.locator('.library-play-target').screenshot({ path: testInfo.outputPath('destinations-mobile.png') })
  await destinations.getByRole('radio', { name: /^Patio/ }).check()
  await page.getByRole('switch', { name: 'Solo en línea' }).click()
  online = false
  await expect(destinations.getByRole('radio', { name: /^Patio/ })).toHaveCount(0, { timeout: 15000 })
  await expect(destinations.getByRole('radio', { checked: true })).toHaveCount(0)
  await page.getByRole('switch', { name: 'Solo en línea' }).click()
  await expect(destinations.getByRole('radio', { checked: true })).toHaveCount(0)
})
