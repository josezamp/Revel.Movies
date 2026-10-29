import { test, expect } from '@playwright/test'
import { credentials, adminHeaders } from './adminFixture'

test('admin login rejects wrong credentials, preserves the destination, persists on reload and logs out', async ({ page, request }, testInfo) => {
  const target = '/admin?section=content'
  await page.goto(target)
  await expect(page.getByRole('button', { name: 'Ingresar al panel' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nuevo evento' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('admin-login-desktop.png'), fullPage: true })
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Ingresar al panel' }).click()
  await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos.')
  expect((await request.get('/api/events')).status()).toBe(401)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Ingresar al panel' }).click()
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('section')).toBe('content')
  await page.getByRole('button', { name: 'Nuevo evento', exact: true }).click()
  await page.getByLabel('Nombre del evento', { exact: true }).fill('Evento con acceso protegido')
  await page.getByRole('button', { name: 'Crear evento', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Evento con acceso protegido', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('button', { name: 'Ingresar al panel' })).toBeVisible()
  expect((await page.request.get('/api/events')).status()).toBe(401)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ingresar al panel' })).toBeVisible()
})

test('expired session returns to login and the mobile form fits the screen', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.request.post('/api/auth/login', { headers: adminHeaders, data: credentials })
  await page.goto('/admin?section=configuration')
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
  await context.clearCookies()
  await expect(page.getByRole('button', { name: 'Ingresar al panel' })).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('alert')).toContainText('Tu sesión terminó')
  expect(new URL(page.url()).searchParams.get('section')).toBe('configuration')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('admin-login-mobile.png'), fullPage: true })
})

test('an anonymous TV can pair, recover its identity and receive playback while admin APIs stay locked', async ({ page, request, playwright, baseURL }) => {
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: adminHeaders })
  try {
    expect((await admin.post('/api/auth/login', { data: credentials })).ok()).toBeTruthy()
    const event = await (await admin.post('/api/events', { data: { name: 'TV sin sesión de admin' } })).json()
    const pairing = await (await request.post('/api/player/pairing-session')).json()
    expect(pairing.code).toBeTruthy()
    const display = await (await admin.post('/api/displays/pair', { data: { code: pairing.code, name: 'TV pública', eventId: event.id } })).json()
    const identity = await (await request.get(`/api/player/pairing-session/${pairing.sessionToken}`)).json()
    await page.goto('/')
    await page.evaluate(token => localStorage.setItem('revel-movies.device-token', token), identity.deviceToken)
    await page.goto('/player')
    await expect(page.locator('.player-shell')).toBeVisible()
    expect((await request.get('/api/events')).status()).toBe(401)
    expect((await request.get('/api/player/identity', { headers: { 'X-Device-Token': identity.deviceToken } })).ok()).toBeTruthy()
    const upload = await admin.post(`/api/events/${event.id}/media`, { multipart: {
      file: { name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=', 'base64') },
    } })
    expect(upload.status()).toBe(201)
    const media = await upload.json()
    expect((await request.get(media.contentUrl, { headers: { Range: 'bytes=0-10' } })).status()).toBe(206)
    await expect.poll(async () => {
      const displays = await (await admin.get('/api/displays')).json()
      return displays.find((item: { id: string }) => item.id === display.id)?.status
    }).toBe('Online')
    expect((await admin.post(`/api/displays/${display.id}/commands`, { data: { type: 'media.play', payload: { mediaId: media.id } } })).status()).toBe(202)
    await expect(page.locator('img.player-media')).toBeVisible()
    await page.reload()
    await expect(page.locator('img.player-media')).toBeVisible()
    expect((await admin.post(`/api/displays/${display.id}/commands`, { data: { type: 'announcement.show', payload: { kind: 'message', text: 'Pantalla conectada', layout: 'fullscreen', theme: 'dark' } } })).status()).toBe(202)
    await expect(page.getByText('Pantalla conectada', { exact: true })).toBeVisible()
  } finally { await admin.dispose() }
})
