import type { Display, DisplayGroup } from '../api/client'
import type { SceneAssignment } from '../api/scenes'

export function sceneDestinations<T extends Pick<Display, 'id' | 'name'>>(assignments: SceneAssignment[], displays: T[], groups: Pick<DisplayGroup, 'id' | 'displayIds'>[]) {
  const destinations = new Map<string, { display: T; assignment: SceneAssignment }>()
  const conflicts = new Set<string>()
  const missing = new Set<string>()
  for (const assignment of assignments) {
    const ids = new Set(assignment.displayIds)
    for (const groupId of assignment.groupIds) {
      const group = groups.find(item => item.id === groupId)
      if (!group) missing.add(groupId)
      group?.displayIds.forEach(id => ids.add(id))
    }
    for (const id of ids) {
      const display = displays.find(item => item.id === id)
      if (!display) { missing.add(id); continue }
      const previous = destinations.get(id)
      const composition = (value: SceneAssignment) => JSON.stringify({ media: value.media, webPage: value.webPage, announcement: value.announcement, blackout: value.blackout, promotions: value.promotions })
      if (previous && composition(previous.assignment) !== composition(assignment)) conflicts.add(display.name)
      else destinations.set(id, { display, assignment })
    }
  }
  return { destinations: [...destinations.values()], conflicts: [...conflicts], missing: [...missing] }
}

export function sceneStatus(status: string, kind?: 'prepare' | 'activate'): string {
  if (status === 'partial' && kind === 'prepare') return 'Preparación parcial'
  return ({ preparing: 'Preparando', ready: 'Lista para activar', network: 'Disponible por red', attention: 'Requiere atención', activating: 'Activando', active: 'Activa', partial: 'Aplicada parcialmente', pending: 'Esperando confirmación', applied: 'Aplicada', error: 'No se pudo aplicar', timeout: 'Tiempo de espera agotado', offline: 'Sin conexión', skipped: 'No se activó', restoring: 'Retorno enviado · esperando confirmación', restored: 'Configuración anterior restaurada', superseded: 'Reemplazada por una acción posterior', expired: 'Vencida', cancelled: 'Cancelada' } as Record<string, string>)[status] ?? status
}

/** One plain-language line describing what an assignment puts on its screens. */
export function assignmentSummary(assignment: SceneAssignment, media: { id: string; name: string }[], playlists: { id: string; name: string }[]): string {
  const parts: string[] = []
  if (assignment.blackout === 'on') parts.push('Pantalla negra')
  if (assignment.media.action === 'replace')
    parts.push(assignment.media.type === 'playlist'
      ? `Playlist ${playlists.find(item => item.id === assignment.media.playlistId)?.name ?? 'no disponible'}`
      : media.find(item => item.id === assignment.media.mediaId)?.name ?? 'Archivo no disponible')
  else if (assignment.media.action === 'remove') parts.push('Quita la multimedia')
  if (assignment.webPage.action === 'replace') {
    const url = assignment.webPage.payload?.url ?? ''
    let host = url
    try { host = new URL(url).hostname } catch { /* keep the raw text */ }
    parts.push(`Página ${host}`)
  } else if (assignment.webPage.action === 'remove') parts.push('Quita la página web')
  if (assignment.announcement.action === 'replace') {
    const payload = assignment.announcement.payload
    parts.push(`${payload?.kind === 'countdown' ? 'Cuenta regresiva' : 'Anuncio'}: ${payload?.text ?? ''}`.trim())
  } else if (assignment.announcement.action === 'remove') parts.push('Quita el anuncio')
  if (assignment.blackout === 'off') parts.push('Restaura la imagen')
  if (assignment.promotions === 'suspend') parts.push('Sin cortes promocionales')
  return parts.length ? parts.join(' + ') : 'Sin cambios'
}

export function returnLabel(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`
}
