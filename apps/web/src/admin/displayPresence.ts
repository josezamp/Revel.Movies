import type { DisplayStatus } from '../api/client'

export function displayPresence(status: DisplayStatus) {
  if (['Online', 'Playing', 'Paused', 1, 3, 4].includes(status))
    return { kind: 'online', label: 'Online', connected: true }
  if (status === 'Offline' || status === 2)
    return { kind: 'offline', label: 'Offline', connected: false }
  if (status === 'Error' || status === 5)
    return { kind: 'error', label: 'Error', connected: false }
  return { kind: 'unknown', label: 'Sin conexión confirmada', connected: false }
}
