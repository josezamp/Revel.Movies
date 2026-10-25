import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=', 'base64')

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('Player page error:', error.message))
  page.on('console', message => { if (message.type() === 'error') console.error('Player console:', message.text()) })
})

async function setup(page: Page, request: APIRequestContext) {
  const eventResponse = await request.post('/api/events', { data: { name: `Escenas Player ${Date.now()}`, timeZone: 'UTC' } })
  expect(eventResponse.ok()).toBeTruthy()
  const eventId = (await eventResponse.json()).id as string
  await page.goto('/player')
  await expect(page.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await page.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const paired = await request.post('/api/displays/pair', { data: { eventId, code, name: 'TV Patio' } })
  expect(paired.ok()).toBeTruthy()
  const displayId = (await paired.json()).id as string
  await expect(page.locator('.pairing-screen')).toHaveCount(0)
  const upload = await request.post(`/api/events/${eventId}/media`, { multipart: { file: { name: 'fondo.png', mimeType: 'image/png', buffer: pixel } } })
  expect(upload.ok()).toBeTruthy()
  const mediaId = (await upload.json()).id as string
  await send(request, displayId, 'media.play', { mediaId })
  try { await expect(page.locator('img.player-media')).toBeVisible() }
  catch (error) {
    console.error('Display state:', await displays(request, eventId))
    throw error
  }
  await expect.poll(async () => (await displays(request, eventId))[0].actualPlaybackState).toBe('Playing')
  return { eventId, displayId, mediaId }
}

async function displays(request: APIRequestContext, eventId: string) {
  return (await request.get(`/api/displays?eventId=${eventId}`)).json()
}

async function send(request: APIRequestContext, displayId: string, type: string, payload?: unknown) {
  const response = await request.post(`/api/displays/${displayId}/commands`, { data: { type, payload } })
  expect(response.status(), await response.text()).toBe(202)
}

async function saveOverlay(request: APIRequestContext, eventId: string, displayId: string, duration: number | null = null) {
  const response = await request.post(`/api/events/${eventId}/scenes`, { data: {
    name: 'Sorteo', temporaryDurationSeconds: duration,
    assignments: [{ displayIds: [displayId], groupIds: [], media: { action: 'keep' }, webPage: { action: 'keep' },
      announcement: { action: 'replace', payload: { kind: 'message', text: 'Sorteo en el salón', layout: 'banner', theme: 'dark' } }, blackout: 'off', promotions: 'keep' }],
  } })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function prepare(request: APIRequestContext, eventId: string, scene: { id: string; version: number }) {
  const response = await request.post(`/api/events/${eventId}/scenes/${scene.id}/prepare`, { data: { version: scene.version } })
  expect(response.ok(), await response.text()).toBeTruthy()
  const session = await response.json()
  await expect.poll(async () => (await (await request.get(`/api/scene-sessions/${session.id}`)).json()).status).toBe('ready')
  return session.id as string
}

async function activate(request: APIRequestContext, eventId: string, scene: { id: string; version: number }, preparationId: string) {
  const response = await request.post(`/api/events/${eventId}/scenes/${scene.id}/activate`, { data: { version: scene.version, preparationId, policy: 'all' } })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

test('saving and preparing leaves the background intact; correlated overlay apply and restore keep its media element', async ({ page, request }) => {
  const { eventId, displayId, mediaId } = await setup(page, request)
  await page.locator('img.player-media').evaluate(element => element.setAttribute('data-original-background', 'yes'))
  const scene = await saveOverlay(request, eventId, displayId)
  await expect(page.getByText('Sorteo en el salón')).toHaveCount(0)
  const preparationId = await prepare(request, eventId, scene)
  await expect(page.getByText('Sorteo en el salón')).toHaveCount(0)
  await expect(page.locator('img.player-media')).toHaveAttribute('data-original-background', 'yes')
  const activation = await activate(request, eventId, scene, preparationId)
  await expect(page.getByText('Sorteo en el salón')).toBeVisible()
  await expect.poll(async () => (await (await request.get(`/api/scene-sessions/${activation.id}`)).json()).status).toBe('active')
  const state = (await displays(request, eventId))[0]
  expect(state.actualMediaAssetId).toBe(mediaId)
  expect(state.actualCommandId).toBe(activation.targets[0].commandId)
  expect(state.actualAnnouncement.text).toBe('Sorteo en el salón')
  await expect(page.locator('img.player-media')).toHaveAttribute('data-original-background', 'yes')
  expect((await request.post(`/api/scene-sessions/${activation.id}/restore`)).ok()).toBeTruthy()
  await expect(page.getByText('Sorteo en el salón')).toHaveCount(0)
  await expect(page.locator('img.player-media')).toHaveAttribute('data-original-background', 'yes')

  await send(request, displayId, 'display.blackout')
  await expect(page.locator('img.player-media')).toBeHidden()
  await send(request, displayId, 'display.restore')
  await expect(page.locator('img.player-media')).toBeVisible()
  await expect(page.locator('img.player-media')).toHaveAttribute('data-original-background', 'yes')

  expect((await request.put(`/api/displays/${displayId}/settings`, { data: { name: 'Patio principal', rotation: 90 } })).ok()).toBeTruthy()
  await send(request, displayId, 'display.identify')
  await expect(page.locator('.identify-overlay')).toContainText('Patio principal')
  await expect(page.locator('.identify-overlay')).toContainText(displayId.slice(0, 8).toUpperCase())
  await expect(page.locator('.player-viewport')).toHaveClass(/rotation-90/)
  await expect(page.locator('.identify-overlay')).toHaveCount(0, { timeout: 7000 })
})

test('an expired temporal scene is not replayed on reconnect', async ({ page, request }) => {
  const { eventId, displayId, mediaId } = await setup(page, request)
  const scene = await saveOverlay(request, eventId, displayId, 2)
  const preparationId = await prepare(request, eventId, scene)
  const activation = await activate(request, eventId, scene, preparationId)
  await expect(page.getByText('Sorteo en el salón')).toBeVisible()
  await page.goto('about:blank')
  await expect.poll(async () => (await (await request.get(`/api/scene-sessions/${activation.id}`)).json()).targets[0].status, { timeout: 8000 }).toMatch(/restoring|restored/)
  await page.goto('/player')
  await expect(page.locator('img.player-media')).toBeVisible()
  await expect(page.locator('img.player-media')).toHaveAttribute('src', new RegExp(mediaId))
  await expect(page.getByText('Sorteo en el salón')).toHaveCount(0)
  await expect.poll(async () => (await displays(request, eventId))[0].actualAnnouncement).toBeNull()
  await expect.poll(async () => (await (await request.get(`/api/scene-sessions/${activation.id}`)).json()).status).toBe('restored')
})

test('a manual decision survives a previous temporal scene expiry', async ({ page, request }) => {
  const { eventId, displayId } = await setup(page, request)
  const scene = await saveOverlay(request, eventId, displayId, 2)
  const preparationId = await prepare(request, eventId, scene)
  const activation = await activate(request, eventId, scene, preparationId)
  await expect(page.getByText('Sorteo en el salón')).toBeVisible()
  await send(request, displayId, 'announcement.show', { kind: 'message', text: 'Decisión posterior', layout: 'banner', theme: 'dark' })
  await expect(page.getByText('Decisión posterior')).toBeVisible()
  await expect.poll(async () => (await (await request.get(`/api/scene-sessions/${activation.id}`)).json()).targets[0].status).toBe('superseded')
  // Force the former automatic restoration path, which must remain a no-op.
  expect((await request.post(`/api/scene-sessions/${activation.id}/restore`)).ok()).toBeTruthy()
  await expect(page.getByText('Decisión posterior')).toBeVisible()
})

test('media preparation leaves a paused background unchanged and temporary replacement returns it paused', async ({ page, request }) => {
  const { eventId, displayId, mediaId } = await setup(page, request)
  await send(request, displayId, 'media.pause')
  await expect.poll(async () => (await displays(request, eventId))[0].actualPlaybackState).toBe('Paused')
  await page.locator('img.player-media').evaluate(element => element.setAttribute('data-paused-background', 'yes'))
  const response = await request.post(`/api/events/${eventId}/scenes`, { data: {
    name: 'Fondo temporal', temporaryDurationSeconds: 3,
    assignments: [{ displayIds: [displayId], groupIds: [], media: { action: 'replace', type: 'media', mediaId },
      webPage: { action: 'keep' }, announcement: { action: 'keep' }, blackout: 'off', promotions: 'keep' }],
  } })
  expect(response.ok(), await response.text()).toBeTruthy()
  const scene = await response.json()
  const preparationId = await prepare(request, eventId, scene)
  await expect(page.locator('img.player-media')).toHaveAttribute('data-paused-background', 'yes')
  expect((await displays(request, eventId))[0].actualPlaybackState).toBe('Paused')
  const activation = await activate(request, eventId, scene, preparationId)
  await expect.poll(async () => (await displays(request, eventId))[0].actualPlaybackState).toBe('Playing')
  await expect(page.locator('img.player-media')).not.toHaveAttribute('data-paused-background', 'yes')
  await expect.poll(async () => (await (await request.get(`/api/scene-sessions/${activation.id}`)).json()).status, { timeout: 9000 }).toBe('restored')
  expect((await displays(request, eventId))[0].actualPlaybackState).toBe('Paused')
  await expect(page.locator('img.player-media')).toBeVisible()
})

test('a recovered temporary overlay also returns locally when the TV loses its network', async ({ page, context, request }) => {
  const { eventId, displayId } = await setup(page, request)
  const scene = await saveOverlay(request, eventId, displayId, 5)
  const preparationId = await prepare(request, eventId, scene)
  const activation = await activate(request, eventId, scene, preparationId)
  await expect(page.getByText('Sorteo en el salón')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Sorteo en el salón')).toBeVisible()
  await page.locator('img.player-media').evaluate(element => element.setAttribute('data-recovered-background', 'yes'))
  await context.setOffline(true)
  await expect(page.getByText('Sorteo en el salón')).toHaveCount(0, { timeout: 7000 })
  await expect(page.locator('img.player-media')).toHaveAttribute('data-recovered-background', 'yes')
  await context.setOffline(false)
  await expect.poll(async () => (await (await request.get(`/api/scene-sessions/${activation.id}`)).json()).status, { timeout: 10000 }).toBe('restored')
})

test('a newer layer command reconciles a canceled scheduled scene without replaying its old announcement', async ({ page, request }) => {
  const { eventId, displayId } = await setup(page, request)
  const upload = await request.post(`/api/events/${eventId}/media`, { multipart: { file: { name: 'premio.png', mimeType: 'image/png', buffer: pixel } } })
  const mediaId = (await upload.json()).id as string
  const response = await request.post(`/api/events/${eventId}/scenes`, { data: {
    name: 'Cambio inmediato', assignments: [{ displayIds: [displayId], groupIds: [], media: { action: 'replace', type: 'media', mediaId },
      webPage: { action: 'keep' }, announcement: { action: 'replace', payload: { kind: 'message', text: 'Anuncio anterior de escena', layout: 'banner', theme: 'dark' } },
      blackout: 'off', promotions: 'keep' }],
  } })
  expect(response.ok(), await response.text()).toBeTruthy()
  const scene = await response.json()
  const preparationId = await prepare(request, eventId, scene)
  const activation = await activate(request, eventId, scene, preparationId)
  await send(request, displayId, 'announcement.show', { kind: 'message', text: 'Anuncio posterior del operador', layout: 'banner', theme: 'dark' })
  await expect(page.getByText('Anuncio posterior del operador')).toBeVisible()
  await expect(page.locator('img.player-media')).toHaveAttribute('src', new RegExp(mediaId))
  await expect.poll(() => Date.now() > Date.parse(activation.createdAt) + 1800).toBeTruthy()
  await expect(page.getByText('Anuncio anterior de escena')).toHaveCount(0)
  await expect(page.getByText('Anuncio posterior del operador')).toBeVisible()
  await expect.poll(async () => (await displays(request, eventId))[0].actualMediaAssetId).toBe(mediaId)
})

test('returning before coordinated activation cancels the pending scene', async ({ page, request }) => {
  const { eventId, displayId } = await setup(page, request)
  const scene = await saveOverlay(request, eventId, displayId)
  const preparationId = await prepare(request, eventId, scene)
  const activation = await activate(request, eventId, scene, preparationId)
  expect((await request.post(`/api/scene-sessions/${activation.id}/restore`)).ok()).toBeTruthy()
  await expect.poll(async () => (await (await request.get(`/api/scene-sessions/${activation.id}`)).json()).status).toBe('restored')
  await expect.poll(() => Date.now() > Date.parse(activation.createdAt) + 1800).toBeTruthy()
  await expect(page.getByText('Sorteo en el salón')).toHaveCount(0)
  await expect(page.locator('img.player-media')).toBeVisible()
})
