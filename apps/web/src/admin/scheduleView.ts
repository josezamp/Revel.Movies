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
