import { apiFetch } from './auth'
import type { SceneAssignment } from './scenes'

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
async function request<T>(path: string, method = 'GET', body?: unknown, rawJson?: string): Promise<T> {
  const response = await apiFetch(`/api${path}`, { method, signal: AbortSignal.timeout(30000),
    ...(body === undefined && rawJson === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: rawJson ?? JSON.stringify(body) }) })
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

export interface ScheduleImportScene {
  key: string; name: string; assignments: SceneAssignment[]; temporaryDurationSeconds: number | null
}
export interface ScheduleImportEntry {
  sceneKey: string; sceneName: string; localStartsAt: string; timeZone: string; policy: 'all' | 'available'
  targets: { displayId: string; displayName: string }[]
}
export interface ScheduleImportPreview {
  previewToken: string; alreadyImported: boolean; scenes: ScheduleImportScene[]
  schedule: ScheduleImportEntry[]; warnings: string[]
}
export interface ScheduleImportResult { alreadyImported: boolean; sceneCount: number; scheduleCount: number }

export const getScheduleImportContext = (eventId: string) =>
  request<{ prompt: string }>(`/events/${eventId}/schedule/import-context`)
export const previewScheduleImport = (eventId: string, json: string) =>
  request<ScheduleImportPreview>(`/events/${eventId}/schedule/preview-import`, 'POST', undefined, json)
export const importSchedule = (eventId: string, json: string, previewToken: string) =>
  // Keep the locally checked JSON literal intact so the server can reject duplicate properties.
  request<ScheduleImportResult>(`/events/${eventId}/schedule/import`, 'POST', undefined,
    `{"previewToken":${JSON.stringify(previewToken)},"package":${json}}`)
