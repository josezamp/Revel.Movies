import type { Display } from '../api/client'

export const REPORT_FRESHNESS_MS = 15_000

export function reportAge(display: Pick<Display, 'lastPlaybackReportAt'>, now: number): number | null {
  const reported = display.lastPlaybackReportAt ? Date.parse(display.lastPlaybackReportAt) : NaN
  return Number.isFinite(reported) ? Math.max(0, now - reported) : null
}

export function playbackConfirmed(display: Pick<Display, 'actualCommandId' | 'lastCommandId' | 'lastPlaybackReportAt'>, now: number): boolean {
  const age = reportAge(display, now)
  return !!display.lastCommandId && display.actualCommandId === display.lastCommandId && age !== null && age <= REPORT_FRESHNESS_MS
}

export function ageLabel(ageMs: number | null): string {
  if (ageMs === null) return 'Sin confirmación del reproductor'
  const seconds = Math.floor(ageMs / 1000)
  return seconds < 60 ? `Hace ${seconds} s` : seconds < 3600 ? `Hace ${Math.floor(seconds / 60)} min` : `Hace ${Math.floor(seconds / 3600)} h`
}

export function timeLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const seconds = Math.max(0, Math.floor(value))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

export function playbackLabel(state: string | null): string {
  const labels: Record<string, string> = { Playing: 'Reproduciendo', Paused: 'Pausado', Stopped: 'Detenido', Idle: 'Sin contenido', Loading: 'Cargando', Preparing: 'Preparando', Starting: 'Cargando', Buffering: 'Cargando', Error: 'No se pudo reproducir', Ended: 'Finalizado', Blackout: 'Pantalla negra', Recovering: 'Recuperando reproducción' }
  return labels[state ?? ''] ?? 'Sin reproducción confirmada'
}
