export interface Announcement {
  kind: 'message' | 'countdown'
  text: string
  layout: 'fullscreen' | 'banner'
  theme: 'dark' | 'light'
  endsAt: string | null
  completedText: string | null
}

export function parseAnnouncement(value: unknown): Announcement | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if ((item.kind !== 'message' && item.kind !== 'countdown') ||
    typeof item.text !== 'string' || !item.text.trim() || item.text.length > 240 ||
    (item.layout !== 'fullscreen' && item.layout !== 'banner') ||
    (item.theme !== 'dark' && item.theme !== 'light')) return null
  if (item.kind === 'countdown' && (typeof item.endsAt !== 'string' || !Number.isFinite(Date.parse(item.endsAt)) ||
    typeof item.completedText !== 'string' || !item.completedText.trim() || item.completedText.length > 240)) return null
  return {
    kind: item.kind, text: item.text, layout: item.layout, theme: item.theme,
    endsAt: item.kind === 'countdown' ? item.endsAt as string : null,
    completedText: item.kind === 'countdown' ? item.completedText as string : null,
  }
}

export function countdownSeconds(endsAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000))
}

export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  const remaining = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(remaining)}` : `${pad(minutes)}:${pad(remaining)}`
}
