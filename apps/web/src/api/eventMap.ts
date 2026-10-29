import { apiFetch } from './auth'

export type MapKind = 'rectangle' | 'ellipse' | 'wall' | 'label' | 'display'
export type MapColor = 'slate' | 'blue' | 'amber' | 'rose' | 'green'
export interface MapNode {
  id: string; kind: MapKind; x: number; y: number; width: number; height: number
  label: string; color: MapColor; displayId: string | null
}
export interface EventMap { eventId: string; version: number; nodes: MapNode[] }

export class MapRequestError extends Error {
  conflict: boolean
  constructor(message: string, conflict = false) { super(message); this.conflict = conflict }
}

async function request(eventId: string, value?: EventMap): Promise<EventMap> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 20000)
  try {
    const response = await apiFetch(`/api/events/${eventId}/map`, {
      signal: controller.signal, ...(value ? { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: value.version, nodes: value.nodes }) } : {}),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new MapRequestError(data?.error ?? 'No se pudo cargar o guardar el croquis.', response.status === 409 && data?.code === 'map_version_conflict')
    }
    return await response.json()
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('El servidor no respondió a tiempo. Tu borrador se conserva; podés reintentar.')
    throw cause
  } finally { window.clearTimeout(timer) }
}

export const getEventMap = (eventId: string) => request(eventId)
export const saveEventMap = (value: EventMap) => request(value.eventId, value)
