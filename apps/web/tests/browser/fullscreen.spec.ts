import { test, expect, type Page, type APIRequestContext } from './adminFixture'

const unsupportedMessage = 'Este navegador no permite pantalla completa. Probá abrir el reproductor en otro navegador.'
const failureMessage = 'No se pudo cambiar a pantalla completa. Volvé a intentarlo desde este dispositivo.'
const enterButton = (page: Page) => page.getByRole('button', { name: 'Pantalla completa', exact: true, includeHidden: true })
const exitButton = (page: Page) => page.getByRole('button', { name: 'Salir de pantalla completa', exact: true, includeHidden: true })
const isFullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement === document.documentElement)

async function pair(page: Page, request: APIRequestContext) {
  const created = await request.post('/api/events', { data: { name: `Fullscreen ${Date.now()}`, timeZone: 'UTC' } })
  expect(created.ok()).toBeTruthy()
  const { id: eventId } = await created.json()
  await expect(page.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
  const code = (await page.locator('.pairing-code').innerText()).replace(/\s/g, '')
  const paired = await request.post('/api/displays/pair', { data: { eventId, code, name: 'Android pantalla completa' } })
  expect(paired.ok()).toBeTruthy()
  const { id: displayId } = await paired.json()
  await expect(page.locator('.pairing-screen')).toHaveCount(0)
  return { eventId, displayId }
}

async function send(request: APIRequestContext, displayId: string, type: string, payload?: unknown) {
  const response = await request.post(`/api/displays/${displayId}/commands`, { data: { type, payload } })
  expect(response.status(), await response.text()).toBe(202)
}

test.describe('touch fullscreen', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('fullscreen survives pairing and projected layers, and touch controls can hide and return', async ({ page, request }, testInfo) => {
    await page.addInitScript(() => {
      const requestFullscreen = Element.prototype.requestFullscreen
      Element.prototype.requestFullscreen = function (options) {
        document.documentElement.dataset.navigationUi = options?.navigationUI ?? ''
        return requestFullscreen.call(this, options)
      }
    })
    await page.goto('/player')
    await expect(enterButton(page)).toBeVisible()
    await enterButton(page).tap()
    await expect.poll(() => isFullscreen(page)).toBeTruthy()
    await expect(page.locator('html')).toHaveAttribute('data-navigation-ui', 'hide')

    const { displayId } = await pair(page, request)
    await send(request, displayId, 'announcement.show', {
      kind: 'message', text: 'Bienvenidos al evento', layout: 'fullscreen', theme: 'dark',
    })
    const announcement = page.getByText('Bienvenidos al evento', { exact: true })
    await expect(announcement).toBeVisible()
    await announcement.evaluate(element => element.setAttribute('data-original-layer', 'yes'))
    expect(await isFullscreen(page)).toBeTruthy()

    await expect(exitButton(page)).toBeHidden({ timeout: 7000 })
    await page.getByRole('button', { name: 'Mostrar controles de pantalla', exact: true }).tap()
    await expect(exitButton(page)).toBeVisible()
    expect(await isFullscreen(page)).toBeTruthy()
    await page.screenshot({ path: testInfo.outputPath('fullscreen-touch-controls.png') })
    await exitButton(page).tap()
    await expect.poll(() => isFullscreen(page)).toBeFalsy()
    await expect(enterButton(page)).toBeVisible()
    await expect(announcement).toHaveAttribute('data-original-layer', 'yes')
    await expect(announcement).toBeVisible()
  })

  test('an external fullscreen exit updates the button after controls have hidden', async ({ page }) => {
    await page.goto('/player')
    await enterButton(page).tap()
    await expect.poll(() => isFullscreen(page)).toBeTruthy()
    await expect(exitButton(page)).toBeHidden({ timeout: 7000 })
    // Models browser/OS exit (such as Android Back), independently of the control.
    await page.evaluate(() => document.exitFullscreen())
    await expect.poll(() => isFullscreen(page)).toBeFalsy()
    await expect(enterButton(page)).toBeVisible()
    await expect(exitButton(page)).toHaveCount(0)
  })
})

test('F toggles fullscreen without intercepting typing, modified shortcuts or repeated keys', async ({ page }) => {
  await page.addInitScript(() => {
    const requestFullscreen = Element.prototype.requestFullscreen
    Element.prototype.requestFullscreen = function (options) {
      document.documentElement.dataset.fullscreenRequests = String(Number(document.documentElement.dataset.fullscreenRequests ?? 0) + 1)
      return requestFullscreen.call(this, options)
    }
  })
  await page.goto('/player')
  await expect(enterButton(page)).toBeVisible()
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'fullscreen-test-input'
    const editor = document.createElement('div')
    editor.id = 'fullscreen-test-editor'
    editor.contentEditable = 'true'
    editor.textContent = 'Texto: '
    document.body.append(input, editor)
  })
  await page.locator('#fullscreen-test-input').focus()
  await page.keyboard.press('f')
  await expect(page.locator('#fullscreen-test-input')).toHaveValue('f')
  await page.locator('#fullscreen-test-editor').focus()
  await page.keyboard.press('f')
  await expect(page.locator('#fullscreen-test-editor')).toContainText('f')
  await page.evaluate(() => {
    document.querySelector('#fullscreen-test-input')!.remove()
    document.querySelector('#fullscreen-test-editor')!.remove()
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, [modifier]: true }))
    }
  })
  await expect(page.locator('html')).not.toHaveAttribute('data-fullscreen-requests')
  expect(await isFullscreen(page)).toBeFalsy()

  await page.keyboard.down('f')
  await expect.poll(() => isFullscreen(page)).toBeTruthy()
  await page.keyboard.down('f') // A held key produces repeat=true.
  await page.keyboard.up('f')
  expect(await isFullscreen(page)).toBeTruthy()
  await expect(page.locator('html')).toHaveAttribute('data-fullscreen-requests', '1')
  await page.keyboard.press('f')
  await expect.poll(() => isFullscreen(page)).toBeFalsy()
  await expect(enterButton(page)).toBeVisible()
})

test('keyboard users can reveal hidden controls and retain the focused fullscreen button', async ({ page }) => {
  await page.goto('/player')
  await enterButton(page).click()
  await expect.poll(() => isFullscreen(page)).toBeTruthy()
  await page.mouse.move(100, 100)
  await expect(exitButton(page)).toBeHidden({ timeout: 7000 })

  const reveal = page.getByRole('button', { name: 'Mostrar controles de pantalla', exact: true })
  await reveal.focus()
  await expect(reveal).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(exitButton(page)).toBeVisible()
  await expect(exitButton(page)).toBeFocused()
  // Wait past the inactivity deadline: focused controls must remain available.
  await page.waitForTimeout(4500)
  await expect(exitButton(page)).toBeVisible()
  await expect(exitButton(page)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => isFullscreen(page)).toBeFalsy()
  await expect(enterButton(page)).toBeVisible()
})

test('the prefixed WebKit contract handles void methods and fullscreenchange events', async ({ page }) => {
  // Emulate only the legacy API contract; this does not exercise a WebKit browser.
  await page.addInitScript(() => {
    let current: Element | null = null
    Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: undefined })
    Object.defineProperty(document, 'webkitFullscreenEnabled', { configurable: true, value: true })
    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => current })
    Object.defineProperty(Element.prototype, 'webkitRequestFullscreen', {
      configurable: true,
      value: function (this: Element) {
        current = this
        document.dispatchEvent(new Event('webkitfullscreenchange'))
      },
    })
    Object.defineProperty(document, 'webkitExitFullscreen', {
      configurable: true,
      value: () => {
        current = null
        document.dispatchEvent(new Event('webkitfullscreenchange'))
      },
    })
  })
  await page.goto('/player')
  await expect(enterButton(page)).toBeEnabled()
  await enterButton(page).click()
  await expect(exitButton(page)).toBeVisible()
  expect(await page.evaluate(() =>
    (document as Document & { webkitFullscreenElement: Element | null }).webkitFullscreenElement === document.documentElement,
  )).toBeTruthy()
  await exitButton(page).click()
  await expect(enterButton(page)).toBeVisible()
  expect(await page.evaluate(() =>
    (document as Document & { webkitFullscreenElement: Element | null }).webkitFullscreenElement,
  )).toBeNull()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const unavailable of ['missing API', 'disabled by browser'] as const) {
  test(`fullscreen explains ${unavailable} and leaves pairing usable`, async ({ page }) => {
    await page.addInitScript(mode => {
      if (mode === 'missing API') {
        Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined })
        Object.defineProperty(Element.prototype, 'webkitRequestFullscreen', { configurable: true, value: undefined })
      } else {
        Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })
        Object.defineProperty(document, 'webkitFullscreenEnabled', { configurable: true, value: false })
      }
    }, unavailable)
    await page.goto('/player')
    await expect(enterButton(page)).toBeDisabled()
    await expect(page.getByText(unsupportedMessage, { exact: true })).toBeVisible()
    await expect(page.locator('.pairing-code')).toHaveText(/\d{3} \d{3}/)
    await page.keyboard.press('f')
    expect(await isFullscreen(page)).toBeFalsy()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
}

test('a rejected fullscreen request explains the failure and allows retrying', async ({ page }) => {
  await page.addInitScript(() => {
    const requestFullscreen = Element.prototype.requestFullscreen
    let rejectNextRequest = true
    Element.prototype.requestFullscreen = function (options) {
      if (rejectNextRequest) {
        rejectNextRequest = false
        return Promise.reject(new DOMException('Fullscreen denied', 'NotAllowedError'))
      }
      return requestFullscreen.call(this, options)
    }
  })
  await page.goto('/player')
  await enterButton(page).click()
  await expect(page.getByRole('alert')).toHaveText(failureMessage)
  expect(await isFullscreen(page)).toBeFalsy()
  await expect(enterButton(page)).toBeEnabled()
  await enterButton(page).click()
  await expect.poll(() => isFullscreen(page)).toBeTruthy()
  await expect(exitButton(page)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
