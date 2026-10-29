export const adminSessionExpired = 'revel:admin-session-expired'
export const adminRequestHeader = { 'X-Revel-Admin': '1' }

export interface AdminSession { configured: boolean; authenticated: boolean; username: string | null }

export function notifySessionExpired(status: number) {
  if (status === 401) window.dispatchEvent(new Event(adminSessionExpired))
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('X-Revel-Admin', '1')
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin' })
  if (!url.startsWith('/api/player/')) notifySessionExpired(response.status)
  return response
}

async function authRequest(path: string, body?: unknown): Promise<AdminSession | undefined> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15000)
  let response: Response
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: path === 'session' ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { ...adminRequestHeader, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch { throw new Error('No se pudo conectar con el servidor. Volvé a intentar.') }
  finally { window.clearTimeout(timeout) }
  if (path === 'logout' && response.status === 401) return
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'No se pudo conectar con el servidor. Volvé a intentar.')
  }
  return response.status === 204 ? undefined : response.json()
}

export const getAdminSession = () => authRequest('session') as Promise<AdminSession>
export const loginAdmin = (username: string, password: string) => authRequest('login', { username, password }) as Promise<AdminSession>
export const logoutAdmin = () => authRequest('logout')
