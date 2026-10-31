import { test, expect, type Page, type APIRequestContext } from './adminFixture'

async function setup(player: Page, request: APIRequestContext) {
  const created = await request.post('/api/events', { data: { name: `Importación ${Date.now()}`, timeZone: 'America/Argentina/Buenos_Aires' } })
  expect(created.ok(), await created.text()).toBeTruthy()
  const eventId = (await created.json()).id as string
  await player.goto('/player')
  await expect(player.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await player.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const paired = await request.post('/api/displays/pair', { data: { eventId, code, name: 'TV Importada' } })
  expect(paired.ok(), await paired.text()).toBeTruthy()
  const displayId = (await paired.json()).id as string
  await expect(player.locator('.pairing-screen')).toHaveCount(0)
  return { eventId, displayId }
}

function makePackage(eventId: string, displayId: string) {
  const tomorrow = new Date(Date.now() + 86400000)
  const following = new Date(Date.now() + 2 * 86400000)
  const firstDate = tomorrow.toISOString().slice(0, 10)
  const secondDate = following.toISOString().slice(0, 10)
  const scenes = [['previa', 'Previa'], ['anuncios', 'Anuncios'], ['fiesta', 'Fiesta']].map(([key, name]) => ({
    key, name, assignments: [{ displayIds: [displayId], groupIds: [], media: { action: 'keep' }, webPage: { action: 'remove' },
      announcement: { action: 'replace', payload: { kind: 'message', text: name, layout: 'banner', theme: 'dark' } }, blackout: 'off', promotions: 'keep' }],
  }))
  return { schemaVersion: 1, eventId, timeZone: 'America/Argentina/Buenos_Aires', scenes,
    schedule: [
      { sceneKey: 'previa', localStartsAt: `${firstDate}T21:00`, policy: 'available' },
      { sceneKey: 'anuncios', localStartsAt: `${secondDate}T00:00`, policy: 'available' },
      { sceneKey: 'fiesta', localStartsAt: `${secondDate}T01:00`, policy: 'available' },
    ],
  }
}

async function entries(request: APIRequestContext, eventId: string, kind: 'scenes' | 'schedule') {
  const response = await request.get(`/api/events/${eventId}/${kind}`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

test('copies actual event context and imports pasted scenes and midnight schedule only after confirmation', async ({ page, context, request }) => {
  const player = await context.newPage()
  const { eventId, displayId } = await setup(player, request)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/admin?event=${eventId}&section=schedule`)
  await page.getByRole('button', { name: 'Copiar contexto para ChatGPT' }).click()
  const contextDialog = page.getByRole('dialog', { name: 'Contexto para ChatGPT' })
  await expect(contextDialog.getByLabel('Contexto del evento')).toHaveValue(new RegExp(displayId))
  await contextDialog.getByRole('button', { name: 'Copiar contexto', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(eventId)
  await contextDialog.getByRole('button', { name: 'Volver', exact: true }).click()

  await page.getByRole('button', { name: 'Importar JSON', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Importar escenas y programación' })
  const packageText = JSON.stringify(makePackage(eventId, displayId), null, 2)
  await dialog.getByLabel('JSON de programación').fill(packageText)
  await dialog.getByRole('button', { name: 'Validar y previsualizar' }).click()
  await expect(dialog.getByRole('heading', { name: 'Revisá la programación' })).toBeVisible()
  await expect(dialog).toContainText('21:00')
  await expect(dialog).toContainText('00:00')
  await expect(dialog).toContainText('01:00')
  await expect(dialog.getByLabel('JSON de programación')).toBeHidden()
  await expect(dialog.locator('.schedule-import-timeline time').first()).toBeInViewport()
  expect(await entries(request, eventId, 'scenes')).toEqual([])
  expect(await entries(request, eventId, 'schedule')).toEqual([])
  await expect(player.getByText('Previa', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('schedule-import-desktop.png'), fullPage: true })
  await dialog.getByRole('button', { name: 'Importar programación', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.schedule-entry')).toHaveCount(3)
  expect((await entries(request, eventId, 'scenes')).map((scene: { name: string }) => scene.name).sort()).toEqual(['Anuncios', 'Fiesta', 'Previa'])
  await expect(player.getByText('Previa', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Importar JSON', exact: true }).click()
  await dialog.getByLabel('JSON de programación').fill(packageText)
  await dialog.getByRole('button', { name: 'Validar y previsualizar' }).click()
  await dialog.getByRole('button', { name: 'Ver programación importada' }).click()
  await expect(dialog).toHaveCount(0)
  expect(await entries(request, eventId, 'scenes')).toHaveLength(3)
  expect(await entries(request, eventId, 'schedule')).toHaveLength(3)
})

test('mobile file import preserves failed drafts and editing or changing destinations invalidates confirmation', async ({ page, context, request }) => {
  const player = await context.newPage()
  const { eventId, displayId } = await setup(player, request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/admin?event=${eventId}&section=schedule`)
  await page.getByRole('button', { name: 'Importar JSON', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Importar escenas y programación' })
  const editor = dialog.getByLabel('JSON de programación')
  await editor.fill('{ invalid json')
  await dialog.getByRole('button', { name: 'Validar y previsualizar' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(editor).toHaveValue('{ invalid json')

  const packageValue = makePackage(eventId, displayId)
  const packageText = JSON.stringify(packageValue, null, 2)
  const duplicateProperty = packageText.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,')
  await editor.fill(duplicateProperty)
  await dialog.getByRole('button', { name: 'Validar y previsualizar' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(editor).toHaveValue(duplicateProperty)
  await expect(dialog.getByRole('heading', { name: 'Revisá la programación' })).toHaveCount(0)
  await dialog.getByLabel('Archivo JSON').setInputFiles({ name: 'cronograma.json', mimeType: 'application/json', buffer: Buffer.from(packageText) })
  await expect(editor).toHaveValue(packageText)
  await dialog.getByRole('button', { name: 'Validar y previsualizar' }).click()
  await expect(dialog.getByRole('heading', { name: 'Revisá la programación' })).toBeVisible()
  await expect(editor).toBeHidden()
  await dialog.getByText('Ver o editar JSON', { exact: true }).click()
  await editor.fill(packageText + '\n')
  await expect(dialog.getByRole('heading', { name: 'Revisá la programación' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Importar programación', exact: true })).toHaveCount(0)

  packageValue.scenes[0].assignments[0].displayIds = ['00000000-0000-0000-0000-000000000001']
  const invalidReference = JSON.stringify(packageValue, null, 2)
  await editor.fill(invalidReference)
  await dialog.getByRole('button', { name: 'Validar y previsualizar' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(editor).toHaveValue(invalidReference)
  expect(await entries(request, eventId, 'scenes')).toEqual([])

  await editor.fill(packageText)
  await dialog.getByRole('button', { name: 'Validar y previsualizar' }).click()
  await expect(dialog.getByRole('heading', { name: 'Revisá la programación' })).toBeVisible()
  await expect(editor).toBeHidden()
  await expect(dialog.locator('.schedule-import-timeline time').first()).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: test.info().outputPath('schedule-import-mobile.png'), fullPage: true })
  expect((await request.put(`/api/displays/${displayId}/settings`, { data: { name: 'TV con nuevo nombre' } })).ok()).toBeTruthy()
  await dialog.getByRole('button', { name: 'Importar programación', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(editor).toHaveValue(packageText)
  expect(await entries(request, eventId, 'scenes')).toEqual([])
  expect(await entries(request, eventId, 'schedule')).toEqual([])
})

test('imported scenes activate on the real player in order after the administrator closes the panel', async ({ page, context, request }) => {
  test.setTimeout(65000)
  const player = await context.newPage()
  const { eventId, displayId } = await setup(player, request)
  await page.goto(`/admin?event=${eventId}&section=schedule`)
  const value = makePackage(eventId, displayId)
  value.timeZone = 'UTC'
  value.scenes = value.scenes.slice(0, 2)
  const start = Date.now()
  value.schedule = value.schedule.slice(0, 2).map((entry, index) => ({ ...entry,
    localStartsAt: new Date(start + (18 + index * 10) * 1000).toISOString().slice(0, 19),
  }))
  await page.getByRole('button', { name: 'Importar JSON', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Importar escenas y programación' })
  await dialog.getByLabel('JSON de programación').fill(JSON.stringify(value))
  await dialog.getByRole('button', { name: 'Validar y previsualizar' }).click()
  await dialog.getByRole('button', { name: 'Importar programación', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.schedule-entry')).toHaveCount(2)
  await page.close()
  await expect(player.getByText('Previa', { exact: true })).toBeVisible({ timeout: 25000 })
  await expect(player.getByText('Anuncios', { exact: true })).toBeVisible({ timeout: 17000 })
  await expect(player.getByText('Previa', { exact: true })).toHaveCount(0)
  await expect.poll(async () => (await entries(request, eventId, 'schedule')).map((entry: { status: string }) => entry.status))
    .toEqual(['completed', 'completed'])
})
