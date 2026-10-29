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
  return ({ preparing: 'Preparando', ready: 'Lista para activar', network: 'Disponible por red', attention: 'Requiere atención', activating: 'Activando', active: 'Activa', partial: 'Aplicada parcialmente', pending: 'Esperando confirmación', applied: 'Aplicada', error: 'No se pudo aplicar', timeout: 'Tiempo de espera agotado', offline: 'Sin conexión', skipped: 'Excluida por la política elegida', restoring: 'Retorno enviado · esperando confirmación', restored: 'Configuración anterior restaurada', superseded: 'Reemplazada por una acción posterior', expired: 'Vencida', cancelled: 'Cancelada' } as Record<string, string>)[status] ?? status
}
