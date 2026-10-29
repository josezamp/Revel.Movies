import { Fragment } from 'react'
import type { Display } from '../api/client'
import { displayPresence, sortByConnection } from './displayPresence'

export function ConnectionDot({ connected, label }: { connected: boolean; label: string }) {
  return <span className={`status-dot display-connection-dot${connected ? ' is-connected' : ''}`} role="img" aria-label={`Conexión actual: ${label}`} title={`Conexión actual: ${label}`} />
}

export function DisplayName({ display, fallbackName }: { display?: Pick<Display, 'name' | 'status'>; fallbackName?: string }) {
  const presence = displayPresence(display?.status)
  return <span className="display-name"><ConnectionDot connected={presence.connected} label={presence.label} /><span>{display?.name ?? fallbackName ?? 'Pantalla no disponible'}</span></span>
}

export function DisplayNames({ displays }: { displays: Pick<Display, 'id' | 'name' | 'status'>[] }) {
  return <>{sortByConnection(displays, display => display.status).map((display, index) => <Fragment key={display.id}>{index > 0 && ', '}<DisplayName display={display} /></Fragment>)}</>
}
