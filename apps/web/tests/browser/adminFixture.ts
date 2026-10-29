import { test as base, expect } from '@playwright/test'

export const credentials = { username: 'test-admin', password: 'Test-only-password-2026!' }
export const adminHeaders = { 'X-Revel-Admin': '1' }

export const test = base.extend({
  storageState: async ({ playwright, baseURL }, use) => {
    const client = await playwright.request.newContext({ baseURL, extraHTTPHeaders: adminHeaders })
    expect((await client.post('/api/auth/login', { data: credentials })).ok()).toBeTruthy()
    await use(await client.storageState())
    await client.dispose()
  },
  request: async ({ playwright, baseURL, storageState }, use) => {
    const client = await playwright.request.newContext({ baseURL, storageState, extraHTTPHeaders: adminHeaders })
    await use(client)
    await client.dispose()
  },
})

export { expect }
export type { Page, APIRequestContext } from '@playwright/test'
