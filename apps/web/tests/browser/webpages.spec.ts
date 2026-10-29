import { test, expect, type Page, type APIRequestContext } from './adminFixture'
import { createServer, type Server } from 'node:http'

let site: Server
let siteUrl: string
test.beforeAll(async ({ baseURL }) => {
  site = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.setHeader('Content-Security-Policy', `frame-ancestors ${new URL(baseURL!).origin}`)
    res.end(`<html><body style="margin:0;background:#152035;color:white;display:grid;place-content:center;height:100dvh"><h1>Concurso ${req.url === '/second' ? 'premios' : 'muro'}</h1><script>document.body.dataset.scripts = 'ready'</script></body></html>`)
  })
  await new Promise<void>(resolve => site.listen(0, 'localhost', resolve))
  const address = site.address()
  if (!address || typeof address === 'string') throw new Error('Test site did not bind a TCP port.')
  siteUrl = `http://localhost:${address.port}`
})
test.afterAll(async () => { await new Promise<void>((resolve, reject) => site.close(error => error ? reject(error) : resolve())) })

async function pair(page: Page, request: APIRequestContext, eventId?: string, name = 'Escenario') {
  if (!eventId) {
    const event = await request.post('/api/events', { data: { name: `Web ${Date.now()}`, timeZone: 'UTC' } })
    expect(event.ok()).toBeTruthy()
    eventId = (await event.json()).id
  }
  await page.goto('/player')
  await expect(page.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await page.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const response = await request.post('/api/displays/pair', { data: { code, name, eventId } })
  expect(response.ok()).toBeTruthy()
  const display = await response.json()
  await expect(page.locator('.pairing-screen')).toHaveCount(0)
  return { displayId: display.id as string, eventId: eventId! }
}

async function send(request: APIRequestContext, id: string, type: string, payload?: unknown) {
  const response = await request.post(`/api/displays/${id}/commands`, { data: { type, payload } })
  expect(response.status()).toBe(202)
}

test('existing pairing projects from admin, replaces, recovers after disconnect, rotates and clears', async ({ page, context, request }) => {
  const { displayId, eventId } = await pair(page, request)
  const upload = await request.post(`/api/events/${eventId}/media`, { multipart: {
    file: { name: 'background.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=', 'base64') },
  } })
  expect(upload.ok()).toBeTruthy()
  const media = await upload.json()
  await send(request, displayId, 'media.play', { mediaId: media.id })
  await expect(page.locator('img.player-media')).toBeVisible()
  const admin = await context.newPage()
  await admin.goto('/admin')
  await admin.locator('header select').selectOption(eventId)
  await admin.getByRole('button', { name: 'Contenido', exact: true }).click()
  await admin.locator('summary').filter({ hasText: 'Proyectar una página web' }).click()
  await admin.getByLabel('URL de la página').fill(`${siteUrl}/first`)
  await admin.getByRole('combobox', { name: 'Proyectar en', exact: true }).selectOption(`display:${displayId}`)
  await admin.getByRole('button', { name: 'Mostrar página en Escenario', exact: true }).click()
  await expect(admin.getByRole('status').filter({ hasText: 'URL guardada' })).toBeVisible()
  const frame = page.frameLocator('iframe.player-webpage')
  await expect(frame.getByRole('heading', { name: 'Concurso muro' })).toBeVisible()
  await expect(frame.locator('body')).toHaveAttribute('data-scripts', 'ready')
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
  await expect(page.locator('iframe')).toHaveAttribute('referrerpolicy', 'no-referrer')
  expect(await page.locator('iframe').boundingBox()).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 })

  // An offline screen receives the latest stored URL without a new pair.
  await page.goto('about:blank')
  await send(request, displayId, 'webpage.show', { url: `${siteUrl}/second` })
  await page.goto('/player')
  await expect(frame.getByRole('heading', { name: 'Concurso premios' })).toBeVisible()
  await page.reload()
  await expect(frame.getByRole('heading', { name: 'Concurso premios' })).toBeVisible()

  expect((await request.put(`/api/displays/${displayId}/settings`, { data: { rotation: 90 } })).ok()).toBeTruthy()
  await expect(page.locator('.player-viewport')).toHaveClass(/rotation-90/)
  const dimensions = await frame.locator('body').evaluate(() => ({ width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollHeight > innerHeight }))
  expect(dimensions).toEqual({ width: 720, height: 1280, scroll: false })

  await send(request, displayId, 'announcement.show', { kind: 'message', text: '¡Atención!', layout: 'banner', theme: 'dark' })
  await expect(page.getByText('¡Atención!', { exact: true })).toBeVisible()
  await send(request, displayId, 'display.blackout')
  await expect(page.locator('iframe')).toBeHidden()
  await expect(page.getByText('¡Atención!', { exact: true })).toHaveCount(0)
  await admin.getByRole('button', { name: 'En vivo', exact: true }).click()
  await admin.getByRole('button', { name: 'Restaurar imagen', exact: true }).click()
  await expect(page.locator('iframe')).toBeVisible()
  await expect(frame.getByRole('heading', { name: 'Concurso premios' })).toBeVisible()
  await send(request, displayId, 'media.play', { mediaId: media.id })
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('img.player-media')).toBeVisible()
  await admin.getByRole('button', { name: 'Contenido', exact: true }).click()
  await admin.getByRole('button', { name: 'Retirar página', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('img.player-media')).toBeVisible()
  await expect(page.getByText('¡Atención!', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('¡Atención!', { exact: true })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
})

test('group assignment reaches paired members and can be removed while offline', async ({ page, browser, request, baseURL }) => {
  const first = await pair(page, request)
  const secondContext = await browser.newContext({ baseURL })
  const secondPage = await secondContext.newPage()
  // Independent TV storage, same event.
  await secondPage.goto('/')
  const second = await pair(secondPage, request, first.eventId, 'Entrada')
  const groupResponse = await request.post(`/api/events/${first.eventId}/display-groups`, { data: { name: 'Concurso' } })
  const group = await groupResponse.json()
  expect((await request.put(`/api/display-groups/${group.id}/members`, { data: { displayIds: [first.displayId, second.displayId] } })).ok()).toBeTruthy()
  expect((await request.post(`/api/display-groups/${group.id}/commands`, { data: { type: 'webpage.show', payload: { url: `${siteUrl}/first` } } })).status()).toBe(202)
  for (const tv of [page, secondPage]) await expect(tv.frameLocator('iframe').getByText('Concurso muro')).toBeVisible()
  await secondPage.goto('about:blank')
  expect((await request.post(`/api/display-groups/${group.id}/commands`, { data: { type: 'webpage.clear' } })).status()).toBe(202)
  await expect(page.locator('iframe')).toHaveCount(0)
  await secondPage.goto('/player')
  await expect(secondPage.locator('.player-shell')).toBeVisible()
  await expect(secondPage.locator('.pairing-screen')).toHaveCount(0)
  await expect(secondPage.locator('iframe')).toHaveCount(0)
  await secondContext.close()
})
