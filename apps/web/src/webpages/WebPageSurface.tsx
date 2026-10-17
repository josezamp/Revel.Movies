import type { WebPage } from './webPage'

export function WebPageSurface({ page, hidden }: { page: WebPage; hidden: boolean }) {
  return <iframe
    className={`player-webpage ${hidden ? 'is-hidden' : ''}`}
    title="Página web proyectada"
    src={page.url}
    sandbox="allow-scripts allow-same-origin"
    referrerPolicy="no-referrer"
    allow="camera 'none'; microphone 'none'; geolocation 'none'; autoplay 'none'"
    tabIndex={-1}
    aria-hidden={hidden}
  />
}
