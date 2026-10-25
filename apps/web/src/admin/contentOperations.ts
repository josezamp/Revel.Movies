import type { Display } from '../api/client'

export type ContentDelivery = { displayId: string; name: string; sentAt: number; commandId?: string; previousCommandId?: string | null; error?: string; expected?: 'playback' | 'configuration' }

export function playbackCommandId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result = value as { commandId?: string; playCommand?: { commandId?: string }; command?: { commandId?: string } }
  return result.playCommand?.commandId ?? result.command?.commandId ?? result.commandId
}

export function deliveryState(delivery: ContentDelivery, display: Display | undefined, now: number): string {
  if (delivery.error) return delivery.error
  if (!display) return 'Destino no disponible'
  const reported = display as Display & { actualCommandId?: string | null; lastCommandId?: string | null }
  if (delivery.commandId && reported.lastCommandId && reported.lastCommandId !== delivery.commandId && reported.lastCommandId !== delivery.previousCommandId) return 'Hay una acción posterior en esta pantalla'
  if (delivery.commandId && reported.actualCommandId === delivery.commandId) {
    const reportedAt = Date.parse(display.lastPlaybackReportAt ?? '')
    if (!Number.isFinite(reportedAt) || reportedAt < delivery.sentAt - 2000 || now - reportedAt > 15000 || reportedAt - now > 5000) return 'Confirmación desactualizada · revisar En vivo'
    if (delivery.expected === 'configuration') return 'Configuración confirmada'
    if (display.actualPlaybackState === 'Error') return 'El reproductor informó un error'
    if (display.actualPlaybackState === 'Playing' || display.actualPlaybackState === 'Paused') return 'Aplicación confirmada'
    return 'Comando confirmado; cargando contenido'
  }
  if (now - delivery.sentAt > 30000) return 'Sin confirmación reciente · revisar En vivo'
  return 'Enviado · esperando confirmación'
}
