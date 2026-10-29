import { createServer, type Server } from 'node:http'
import { test, expect, type Page, type APIRequestContext } from './adminFixture'

let web: Server
let webUrl: string
test.beforeAll(async () => {
  web = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<html><body><h1>${request.url === '/second' ? 'Página del concurso' : 'Página de bienvenida'}</h1></body></html>`)
  })
  await new Promise<void>(resolve => web.listen(0, '127.0.0.1', resolve))
  const address = web.address()
  if (!address || typeof address === 'string') throw new Error('No test web port')
  webUrl = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => { await new Promise<void>(resolve => web.close(() => resolve())) })

async function setup(player: Page, request: APIRequestContext) {
  const event = await (await request.post('/api/events', { data: { name: `Agenda ${Date.now()}`, timeZone: 'UTC' } })).json()
  await player.goto('/player')
  await expect(player.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await player.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const paired = await request.post('/api/displays/pair', { data: { eventId: event.id, code, name: 'TV Programada' } })
  expect(paired.ok()).toBeTruthy()
  const display = await paired.json()
  await expect(player.locator('.pairing-screen')).toHaveCount(0)
  const sceneIds: string[] = []
  for (const [name, path] of [['Bienvenida', '/first'], ['Concurso', '/second']]) {
    const response = await request.post(`/api/events/${event.id}/scenes`, { data: { name, assignments: [{ displayIds: [display.id], groupIds: [],
      media: { action: 'keep' }, webPage: { action: 'replace', payload: { url: webUrl + path } }, announcement: { action: 'remove' }, blackout: 'off', promotions: 'keep' }] } })
    expect(response.ok(), await response.text()).toBeTruthy()
    sceneIds.push((await response.json()).id)
  }
  return { eventId: event.id as string, sceneIds }
}
async function program(page: Page, sceneId: string, start: Date) {
  await page.getByRole('button', { name: 'Programar escena', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Escena', exact: true }).selectOption(sceneId)
  await dialog.getByLabel('Fecha y hora').fill(start.toISOString().slice(0, 19))
  await dialog.getByLabel('Zona horaria').fill('UTC')
  await dialog.getByRole('button', { name: 'Guardar programación' }).click()
  await expect(dialog).toHaveCount(0)
}

test('two websites run in order after closing the admin panel, with automatic preparation and per-screen history', async ({ page, context, request }) => {
  test.setTimeout(65000)
  const player = await context.newPage()
  const { eventId, sceneIds } = await setup(player, request)
  await page.goto(`/admin?event=${eventId}&section=schedule`)
  await expect(page.getByRole('heading', { name: 'Programación', exact: true })).toBeVisible()
  const start = Date.now()
  await program(page, sceneIds[0], new Date(start + 18000))
  await program(page, sceneIds[1], new Date(start + 29000))
  await expect(page.locator('.schedule-entry')).toHaveCount(2)
  await page.screenshot({ path: test.info().outputPath('schedule-desktop.png'), fullPage: true })
  await page.close()
  await expect(player.frameLocator('iframe').getByRole('heading', { name: 'Página de bienvenida' })).toBeVisible({ timeout: 25000 })
  await expect(player.frameLocator('iframe').getByRole('heading', { name: 'Página del concurso' })).toBeVisible({ timeout: 20000 })
  await expect.poll(async () => (await (await request.get(`/api/events/${eventId}/schedule`)).json()).map((entry: { status: string }) => entry.status)).toEqual(['completed', 'completed'])
  const admin = await context.newPage()
  await admin.goto(`/admin?event=${eventId}&section=schedule`)
  await expect(admin.getByRole('heading', { name: 'Historial · 2 entradas' })).toBeVisible()
  await admin.getByText('Resultados por pantalla (1)', { exact: true }).first().click()
  await expect(admin.getByRole('cell', { name: 'Disponible por red' })).toBeVisible()
  await expect(admin.getByRole('cell', { name: 'Aplicada', exact: false })).toBeVisible()
})

test('mobile scheduling from a scene can be edited and cancelled, and is scoped to its event', async ({ page, context, request }) => {
  const player = await context.newPage()
  const { eventId } = await setup(player, request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/admin?event=${eventId}&section=scenes`)
  await page.getByRole('button', { name: 'Programar por fecha y hora' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('combobox', { name: 'Escena', exact: true })).not.toHaveValue('')
  await dialog.getByLabel('Fecha y hora').fill(new Date(Date.now() + 3600000).toISOString().slice(0, 19))
  await dialog.getByRole('button', { name: 'Guardar programación' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.schedule-entry')).toHaveCount(1)
  await page.getByRole('button', { name: 'Editar horario o escena' }).click()
  await dialog.getByLabel('Fecha y hora').fill(new Date(Date.now() + 7200000).toISOString().slice(0, 19))
  await dialog.getByRole('button', { name: 'Guardar programación' }).click()
  await expect(dialog).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: test.info().outputPath('schedule-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: 'Cancelar entrada' }).click()
  await expect(page.locator('.schedule-entry')).toContainText('Cancelada')
  await page.reload()
  await expect(page.locator('.schedule-entry')).toContainText('Cancelada')
  const other = await (await request.post('/api/events', { data: { name: `Otro ${Date.now()}`, timeZone: 'UTC' } })).json()
  expect(await (await request.get(`/api/events/${other.id}/schedule`)).json()).toEqual([])
  await page.goto(`/admin?event=${other.id}&section=schedule`)
  await expect(page.locator('.schedule-entry')).toHaveCount(0)
})
