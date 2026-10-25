import { useEffect, useRef, useState } from 'react'
import { createEvent, getDisplays, getEvents, getMedia, getPendingPairings, getPlaylists, pairDisplay,
  type Display, type DisplayGroup, type EventSummary, type MediaAsset, type PendingPairing, type Playlist } from '../api/client'
import { OrchestrationPanel } from './OrchestrationPanel'
import { MediaWorkspace } from './MediaWorkspace'
import { DisplayCard } from './DisplayCard'
import { NameDialog } from './NameDialog'
import { ScenesPanel } from './ScenesPanel'
import { displayPresence } from './displayPresence'
import { ageLabel } from './liveState'
import './operations.css'

type Section = 'live' | 'scenes' | 'content' | 'configuration'
export function AdminPage() {
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [events, setEvents] = useState<EventSummary[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  const [prepared, setPrepared] = useState<Record<string, string[]>>({})
  const [section, setSection] = useState<Section>('live')
  const [dialog, setDialog] = useState<'event' | PendingPairing>()
  const [error, setError] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<number>()
  const [now, setNow] = useState(Date.now())
  const currentEventId = useRef(selectedEventId)
  const refreshRevision = useRef(0)
  const mediaRevision = useRef(0)
  currentEventId.current = selectedEventId

  async function refresh() {
    const revision = ++refreshRevision.current
    try {
      const [nextEvents, nextPending, nextDisplays] = await Promise.all([getEvents(), getPendingPairings(), getDisplays()])
      if (revision !== refreshRevision.current) return
      setEvents(nextEvents); setPending(nextPending); setDisplays(nextDisplays)
      setSelectedEventId(current => current || nextEvents[0]?.id || '')
      setError(''); setLastUpdated(Date.now())
    } catch (cause) {
      if (revision === refreshRevision.current) setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el panel.')
    }
  }
  async function refreshMedia(eventId = currentEventId.current) {
    const revision = ++mediaRevision.current
    try {
      const [nextMedia, nextPlaylists] = eventId ? await Promise.all([getMedia(eventId), getPlaylists(eventId)]) : [[], []]
      if (currentEventId.current === eventId && mediaRevision.current === revision) { setMedia(nextMedia); setPlaylists(nextPlaylists); setMediaError('') }
    } catch (cause) {
      if (currentEventId.current === eventId && mediaRevision.current === revision) setMediaError(cause instanceof Error ? cause.message : 'No se pudo actualizar el contenido.')
    }
  }
  useEffect(() => {
    let disposed = false
    let timer: number
    async function poll() { await refresh(); if (!disposed) timer = window.setTimeout(poll, 2000) }
    void poll()
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { disposed = true; refreshRevision.current++; window.clearTimeout(timer); window.clearInterval(clock) }
  }, [])
  useEffect(() => { void refreshMedia(selectedEventId); return () => { mediaRevision.current++ } }, [selectedEventId])
  const visibleDisplays = displays.filter(display => display.eventId === selectedEventId)
  const eventMedia = media.filter(item => item.eventId === selectedEventId)
  const eventPlaylists = playlists.filter(item => item.eventId === selectedEventId)
  const eventGroups = groups.filter(item => item.eventId === selectedEventId)
  const onlineCount = visibleDisplays.filter(item => displayPresence(item.status).connected).length
  const outdated = !!lastUpdated && now - lastUpdated > 10_000
  const eventName = events.find(item => item.id === selectedEventId)?.name

  return <main className="admin-shell operation-shell">
    <header className="operation-header">
      <div><p className="eyebrow">REVEL MOVIES · CONTROL DE EVENTO</p><h1>Todo a la vista.</h1><p className="muted">Lo que está al aire. Lo que viene después.</p></div>
      <div className="admin-toolbar"><label>Evento activo<select value={selectedEventId} onChange={event => setSelectedEventId(event.target.value)}>
        {events.length === 0 && <option value="">Sin eventos</option>}{events.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label><button onClick={() => setDialog('event')}>Nuevo evento</button></div>
    </header>
    <nav className="operation-nav" aria-label="Tareas del evento"><span className="nav-event">EVENTO ACTIVO · {eventName ?? 'Sin evento'}</span>{([['live', 'En vivo'], ['scenes', 'Escenas'], ['content', 'Contenido'], ['configuration', 'Configuración']] as const).map(([key, label]) => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { setSection(key); if (key === 'live' || key === 'scenes') void refreshMedia() }}>{label}</button>)}</nav>
    {(error || outdated) && <div className="server-alert" role="alert"><strong>Sin actualización del servidor.</strong> <span aria-live="off">{lastUpdated ? `Última actualización: ${ageLabel(now - lastUpdated).toLowerCase()}.` : 'Todavía no se recibieron datos.'}</span> Reintentando… <button onClick={() => void refresh()}>Reintentar ahora</button>{error && <small>{error}</small>}</div>}
    {mediaError && <p className="workspace-error" role="alert">Contenido desactualizado: {mediaError} <button onClick={() => void refreshMedia()}>Reintentar</button></p>}
    {pending.length > 0 && <aside className="pairing-notice"><span>{pending.length} {pending.length === 1 ? 'pantalla espera vinculación' : 'pantallas esperan vinculación'}</span><button onClick={() => setSection('configuration')}>Vincular pantallas</button></aside>}
    <div hidden={section !== 'live'}>
      <section aria-label="Pantallas en vivo"><div className="workspace-heading"><div><p className="eyebrow">EN VIVO · {eventName ?? 'ELEGÍ UN EVENTO'}</p><h2>Pantallas <span className="count-badge">{onlineCount} de {visibleDisplays.length} conectadas</span></h2></div><div className="button-row"><button onClick={() => setSection('scenes')}>Escenas preparadas →</button><button onClick={() => setSection('configuration')}>Agregar pantalla</button></div></div>
        {!lastUpdated && !error && <p role="status">Cargando pantallas…</p>}
        {lastUpdated && visibleDisplays.length === 0 && <div className="workspace-empty"><strong>Tu evento empieza con una pantalla.</strong><p>Abrí el reproductor en la TV y vinculala desde Configuración.</p><button onClick={() => setSection('configuration')}>Agregar pantalla</button></div>}
        <div className="card-grid display-grid">{visibleDisplays.map(display => <DisplayCard key={display.id} display={display} media={eventMedia} playlists={eventPlaylists} prepared={prepared[display.id] ?? []} now={now} onChanged={refresh} onUpdated={updated => setDisplays(items => items.map(item => item.id === updated.id ? { ...item, ...updated } : item))} />)}</div>
      </section>
    </div>
    <div hidden={section !== 'scenes'}><ScenesPanel key={selectedEventId} eventId={selectedEventId} displays={visibleDisplays} groups={eventGroups} media={eventMedia} playlists={eventPlaylists} onChanged={refresh} active={section === 'scenes' || section === 'live'} onPreparedChange={setPrepared} /></div>
    <div hidden={section !== 'configuration'}><section><div className="workspace-heading"><div><h2>Agregar pantalla</h2><p>Abrí <a href="/player" target="_blank" rel="noreferrer">el reproductor</a> en la TV. Su código aparecerá acá.</p></div></div>
      {pending.length === 0 && <p className="muted">No hay pantallas esperando vinculación.</p>}<div className="card-grid">{pending.map(item => <article className="card" key={item.code}><strong className="pair-code">{item.code.slice(0, 3)} {item.code.slice(3)}</strong><button disabled={!selectedEventId} onClick={() => setDialog(item)}>Vincular al evento {eventName}</button></article>)}</div>
      <p className="muted">Orientación, nombre, mantenimiento y diagnóstico están en “Detalles” de cada pantalla en En vivo.</p>
    </section></div>
    <div hidden={section !== 'content'}><MediaWorkspace key={selectedEventId + '-media'} eventId={selectedEventId} displays={visibleDisplays} groups={eventGroups} media={eventMedia} onMediaChanged={refreshMedia} /></div>
    <div hidden={section !== 'content' && section !== 'configuration'}><OrchestrationPanel key={selectedEventId} eventId={selectedEventId} displays={visibleDisplays} media={eventMedia} onGroupsChanged={setGroups} section={section === 'configuration' ? 'configuration' : 'content'} /></div>
    {dialog && <NameDialog title={dialog === 'event' ? 'Nuevo evento' : 'Vincular pantalla'} initialName="" label={dialog === 'event' ? 'Nombre del evento' : 'Nombre de la pantalla'} submitLabel={dialog === 'event' ? 'Crear evento' : 'Vincular'} onClose={() => setDialog(undefined)} onSave={async name => {
      if (dialog === 'event') { const item = await createEvent(name); setSelectedEventId(item.id) }
      else await pairDisplay(dialog.code, name, selectedEventId)
      await refresh()
    }} />}
  </main>
}
