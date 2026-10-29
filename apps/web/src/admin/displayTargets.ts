import type { Display, DisplayGroup } from '../api/client'
import { displayPresence } from './displayPresence'

export type DisplayTarget = {
  value: string
  id: string
  kind: 'display' | 'group'
  label: string
  ids: string[]
  connected: boolean
  statusLabel: string
}

export function displayTargets(displays: Display[], groups: DisplayGroup[]): DisplayTarget[] {
  const presenceById = new Map(displays.map(display => [display.id, displayPresence(display.status)]))
  const targets: DisplayTarget[] = [
    ...displays.map(display => {
      const presence = presenceById.get(display.id)!
      return { value: `display:${display.id}`, id: display.id, kind: 'display' as const,
        label: display.name, ids: [display.id], connected: presence.connected, statusLabel: presence.label }
    }),
    ...groups.map(group => {
      const onlineCount = group.displayIds.filter(id => presenceById.get(id)?.connected).length
      return { value: `group:${group.id}`, id: group.id, kind: 'group' as const,
        label: `Grupo: ${group.name}`, ids: group.displayIds,
        connected: group.displayIds.length > 0 && onlineCount === group.displayIds.length,
        statusLabel: group.displayIds.length ? `${onlineCount}/${group.displayIds.length} conectadas` : 'Sin pantallas' }
    }),
  ]
  return targets.sort((left, right) => Number(right.connected) - Number(left.connected))
}
