export const pendingSchedule = (status: string) => ['scheduled', 'preparing', 'activating'].includes(status)
export function scheduleStatus(status: string): string {
  return ({ scheduled: 'Programada', preparing: 'Preparando pantallas', activating: 'Esperando confirmación',
    completed: 'Confirmada', partial: 'Con resultados parciales', failed: 'No se pudo ejecutar', missed: 'Omitida',
    cancelled: 'Cancelada' } as Record<string, string>)[status] ?? status
}
export function localDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}
export function scheduleDate(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(startsAt))
}
export function scheduleTime(startsAt: string, timeZone: string): string {
  const date = new Date(startsAt)
  return new Intl.DateTimeFormat('es-AR', { timeZone, hour: '2-digit', minute: '2-digit',
    second: date.getUTCSeconds() ? '2-digit' : undefined, hourCycle: 'h23' }).format(date)
}

/** "en 12 min", "en 2 h 5 min", "en 3 días"; empty once the time has passed. */
export function relativeStart(startsAt: string, now: number): string {
  const seconds = Math.round((Date.parse(startsAt) - now) / 1000)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return 'en menos de 1 min'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `en ${minutes} min`
  if (minutes < 1440) return `en ${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
  const days = Math.floor(minutes / 1440)
  return `en ${days} ${days === 1 ? 'día' : 'días'}`
}
const dayKey = (value: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
/** Agenda group heading in the entry's own time zone: "Hoy · mié, 25 nov", "Mañana · …" or the plain date. */
export function scheduleDay(startsAt: string, timeZone: string, now: number): string {
  const day = new Intl.DateTimeFormat('es-AR', { timeZone, weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(startsAt))
  const key = dayKey(Date.parse(startsAt), timeZone)
  return key === dayKey(now, timeZone) ? `Hoy · ${day}` : key === dayKey(now + 86400000, timeZone) ? `Mañana · ${day}` : scheduleDate(startsAt, timeZone)
}
