export type LayerAction = 'keep' | 'replace' | 'remove'
export type SceneAnnouncement = { kind: 'message' | 'countdown'; text: string; layout: 'fullscreen' | 'banner'; theme: 'dark' | 'light'; endsAt?: string | null; durationSeconds?: number; completedText?: string | null }
export interface SceneAssignment {
  displayIds: string[]; groupIds: string[]
  media: { action: LayerAction; type?: 'media' | 'playlist'; mediaId?: string; playlistId?: string; loop?: boolean; state?: 'Playing' | 'Paused' | 'Stopped'; resumePositionSeconds?: number | null; resumePlaylistIndex?: number | null }
  webPage: { action: LayerAction; payload?: { url: string } }
  announcement: { action: LayerAction; payload?: SceneAnnouncement }
  blackout: 'keep' | 'on' | 'off'; promotions: 'keep' | 'suspend'
}
export interface Scene { id: string; eventId: string; name: string; version: number; assignments: SceneAssignment[]; temporaryDurationSeconds: number | null; createdAt: string; updatedAt: string }
export type SceneInput = Pick<Scene, 'name' | 'assignments' | 'temporaryDurationSeconds'> & { version?: number }
export interface SceneTarget { displayId: string; displayName: string; commandId: string; status: string; detail: string | null; reportedAt: string | null; appliedRevision: number }
export interface SceneSession { id: string; sceneId: string; version: number; kind: 'prepare' | 'activate'; status: string; targets: SceneTarget[]; createdAt: string; expiresAt: string | null }

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 30000)
  let response: Response
  try { response = await fetch(`/api${url}`, { method, signal: controller.signal, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }) }
  catch (cause) { if (controller.signal.aborted) throw new Error('No se pudo confirmar la respuesta del servidor. Revisá el estado actualizado antes de reintentar.'); throw cause }
  finally { window.clearTimeout(timer) }
  if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error ?? `No se pudo completar la operación (${response.status}).`) }
  return response.status === 204 ? undefined as T : response.json()
}
export const getScenes = (eventId: string) => request<Scene[]>(`/events/${eventId}/scenes`)
export const getSceneSessions = (eventId: string) => request<SceneSession[]>(`/events/${eventId}/scene-sessions`)
export const saveScene = (eventId: string, value: SceneInput, id?: string) => request<Scene>(`/events/${eventId}/scenes${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', value)
export const duplicateScene = (eventId: string, id: string) => request<Scene>(`/events/${eventId}/scenes/${id}/duplicate`, 'POST')
export const deleteScene = (eventId: string, id: string) => request<void>(`/events/${eventId}/scenes/${id}`, 'DELETE')
export const captureScene = (eventId: string, name: string, displayIds: string[]) => request<Scene>(`/events/${eventId}/scenes/snapshot`, 'POST', { name, displayIds })
export const prepareScene = (eventId: string, scene: Scene, displayIds?: string[]) => request<SceneSession>(`/events/${eventId}/scenes/${scene.id}/prepare`, 'POST', { version: scene.version, displayIds })
export const activateScene = (eventId: string, scene: Scene, policy: 'all' | 'available', preparationId?: string, displayIds?: string[]) => request<SceneSession>(`/events/${eventId}/scenes/${scene.id}/activate`, 'POST', { version: scene.version, policy, preparationId, displayIds })
export const restoreScene = (id: string) => request<SceneSession>(`/scene-sessions/${id}/restore`, 'POST')
