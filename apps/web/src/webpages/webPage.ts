export type WebPage = { url: string }

export function webPageUrlError(value: string, playerLocation: string): string | null {
  const raw = value.trim()
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(raw))
    return 'Ingresá una URL HTTP o HTTPS de hasta 2048 caracteres.'
  try {
    const url = new URL(raw)
    const player = new URL(playerLocation)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
      return 'Usá una URL HTTP o HTTPS sin credenciales.'
    // Scripts + same-origin are needed by web apps, but must not grant access to Revel's parent window.
    if (url.origin === player.origin)
      return 'La página debe estar alojada en un origen distinto de Revel (dominio o puerto).'
    if (player.protocol === 'https:' && url.protocol === 'http:')
      return 'Una pantalla de Revel en HTTPS necesita una página en HTTPS.'
    return null
  } catch {
    return 'Ingresá una URL completa, incluyendo https:// o http://.'
  }
}

export function parseWebPage(value: unknown, playerLocation: string): WebPage | null {
  if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string') return null
  if (webPageUrlError(value.url, playerLocation)) return null
  return { url: new URL(value.url.trim()).href }
}
