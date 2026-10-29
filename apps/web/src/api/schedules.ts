import { apiFetch } from './auth'

export interface ScheduleTarget {
  displayId: string; displayName: string; preparationStatus: string; status: string
  detail: string | null; reportedAt: string | null
}
export interface SceneSchedule {
  id: string; eventId: string; sceneId: string; sceneName: string; sceneVersion: number
  startsAt: string; localStartsAt: string; timeZone: string; policy: 'all' | 'available'
  status: string; detail: string | null; targets: ScheduleTarget[]; completedAt: string | null; version: number
}
export interface ScheduleInput {
  sceneId: string; sceneVersion: number; localStartsAt: string; timeZone: string; policy: 'all' | 'available'; version?: number
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await apiFetch(`/api${path}`, { method, signal: AbortSignal.timeout(30000),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error ?? 'No se pudo actualizar la programación.')
  }
  return response.json()
}
export const getSchedule = (eventId: string) => request<SceneSchedule[]>(`/events/${eventId}/schedule`)
export const saveSchedule = (eventId: string, input: ScheduleInput, id?: string) =>
  request<SceneSchedule>(`/events/${eventId}/schedule${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', input)
export const cancelSchedule = (eventId: string, entry: SceneSchedule) =>
  request<SceneSchedule>(`/events/${eventId}/schedule/${entry.id}/cancel`, 'POST', { version: entry.version })
