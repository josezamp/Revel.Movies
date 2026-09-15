export type DisplayStatus = 'Unknown' | 'Online' | 'Offline' | 'Playing' | 'Paused' | 'Error' | number

export interface Display {
  id: string
  name: string
  status: DisplayStatus
  lastSeenAt?: string
}

export interface PendingPairing {
  code: string
  createdAt: string
  expiresAt: string
}

export async function getPendingPairings(): Promise<PendingPairing[]> {
  return getJson('/api/pairing/pending')
}

export async function pairDisplay(code: string, name: string): Promise<Display> {
  return requestJson('/api/displays/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  })
}

export async function getDisplays(): Promise<Display[]> {
  return getJson('/api/displays')
}

export async function sendCommand(displayId: string, type: string, payload?: unknown) {
  return requestJson(`/api/displays/${displayId}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  })
}

export async function createPairingSession(): Promise<{ sessionToken: string; code: string; expiresAt: string }> {
  return requestJson('/api/player/pairing-session', { method: 'POST' })
}

export async function getPairingResult(sessionToken: string): Promise<{ isPaired: boolean; displayId?: string; deviceToken?: string }> {
  return getJson(`/api/player/pairing-session/${sessionToken}`)
}

async function getJson<T>(url: string): Promise<T> {
  return requestJson(url)
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}
