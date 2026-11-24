import { randomUUID } from 'node:crypto'
import { test, expect } from './adminFixture'
import type { Display, DisplayStatus } from '../../src/api/client'

test('live online switch filters cards and map as presence changes without altering the saved layout', async ({ page, request }, testInfo) => {
  const event = await (await request.post('/api/events', { data: { name: 'Filtro en vivo', timeZone: 'UTC' } })).json()
  const screens: Display[] = []
  for (const name of ['Patio', 'Barra', 'Salón', 'Entrada']) {
    const session = await (await request.post('/api/player/pairing-session')).json()
    const paired = await request.post('/api/displays/pair', { data: { code: session.code, name, eventId: event.id } })
    expect(paired.ok()).toBeTruthy()
    screens.push(await paired.json())
  }
  let statuses: DisplayStatus[] = ['Online', 'Playing', 'Paused', 'Offline']
  await page.route(/\/api\/displays(?:\?.*)?$/, route => route.fulfill({ json: screens.map((screen, index) => ({ ...screen, status: statuses[index] })) }))
  const map = await (await request.get(`/api/events/${event.id}/map`)).json()
  const nodes = [screens[0], screens[3]].map((screen, index) => ({ id: randomUUID(), kind: 'display', x: 100 + index * 240, y: 100,
    width: 180, height: 90, label: screen.name, color: 'blue', displayId: screen.id }))
  const saved = await request.put(`/api/events/${event.id}/map`, { data: { version: map.version, nodes } })
  expect(saved.ok()).toBeTruthy()
  const savedMap = await saved.json()
  await page.goto(`/admin?event=${event.id}&section=live`)
  const live = page.getByRole('region', { name: 'Pantallas en vivo' })
  const toggle = live.getByRole('switch', { name: 'Solo en línea' })
  const cards = live.locator('.display-card')
  await expect(cards).toHaveCount(4)
  await expect(live.locator('.count-badge')).toHaveText('3 de 4 conectadas')
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toBeChecked()
  await expect(cards).toHaveCount(3)
  await expect(live.getByRole('heading', { name: 'Entrada', exact: true })).toHaveCount(0)
  await expect(live.locator('.count-badge')).toHaveText('3 de 4 conectadas')
  await page.setViewportSize({ width: 360, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  expect(await toggle.evaluate(element => element.getBoundingClientRect().height)).toBe(24)
  await live.locator('.live-view-toolbar').screenshot({ path: testInfo.outputPath('live-filter-mobile.png') })
  await live.getByRole('button', { name: 'Mapa', exact: true }).click()
  await expect(live.getByRole('button', { name: 'Pantalla: Patio', exact: true })).toBeVisible()
  await expect(live.getByRole('button', { name: 'Pantalla: Entrada', exact: true })).toHaveCount(0)
  await expect(live.locator('.map-display-list button')).toHaveCount(2)
  await live.getByRole('button', { name: 'Editar croquis', exact: true }).click()
  await expect(live.getByRole('button', { name: 'Pantalla: Entrada', exact: true })).toBeVisible()
  await expect(live.getByText('Al editar se muestran todas las pantallas.', { exact: false })).toBeVisible()
  await live.getByRole('button', { name: 'Operar', exact: true }).click()
  await expect(live.getByRole('button', { name: 'Pantalla: Entrada', exact: true })).toHaveCount(0)
  await live.getByRole('button', { name: 'Tarjetas', exact: true }).click()
  statuses = ['Offline', 'Offline', 'Offline', 'Offline']
  await expect(cards).toHaveCount(0, { timeout: 10000 })
  await expect(live.getByText('No hay pantallas en línea.', { exact: true })).toBeVisible()
  statuses[3] = 'Online'
  await expect(cards).toHaveCount(1, { timeout: 10000 })
  await expect(live.getByRole('heading', { name: 'Entrada', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Contenido', exact: true }).click()
  await expect(page.getByRole('radio', { name: /^Patio/ })).toBeVisible()
  await page.getByRole('button', { name: 'En vivo', exact: true }).click()
  await expect(toggle).toBeChecked()
  statuses[3] = 'Offline'
  await expect(live.getByRole('button', { name: 'Mostrar todas las pantallas' })).toBeVisible({ timeout: 10000 })
  await live.getByRole('button', { name: 'Mostrar todas las pantallas' }).click()
  await expect(toggle).not.toBeChecked()
  await expect(cards).toHaveCount(4)
  expect(await (await request.get(`/api/events/${event.id}/map`)).json()).toEqual(savedMap)
})
