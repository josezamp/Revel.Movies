import type { DisplayStatus } from '../api/client'

export function displayPresence(status: DisplayStatus | undefined) {
  if (status !== undefined && ['Online', 'Playing', 'Paused', 1, 3, 4].includes(status))
    return { kind: 'online', label: 'Conectada', connected: true }
  if (status === 'Offline' || status === 2)
    return { kind: 'offline', label: 'Sin conexión', connected: false }
  if (status === 'Error' || status === 5)
    return { kind: 'error', label: 'Error', connected: false }
  return { kind: 'unknown', label: 'Sin conexión confirmada', connected: false }
}

export function sortByConnection<T>(items: readonly T[], status: (item: T) => DisplayStatus | undefined): T[] {
  return items.map(item => ({ item, connected: displayPresence(status(item)).connected }))
    .sort((left, right) => Number(right.connected) - Number(left.connected))
    .map(({ item }) => item)
}
