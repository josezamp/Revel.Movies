import { useEffect, useRef, useState, type FormEvent } from 'react'
import { WebPagePanel } from './WebPagePanel'
import { AnnouncementsPanel } from './AnnouncementsPanel'
import { Dialog } from './Dialog'
import { createDisplayGroup, deleteDisplayGroup, getDisplayGroups, replaceDisplayGroupMembers, sendGroupCommand, type Display, type DisplayGroup, type MediaAsset } from '../api/client'
import './content.css'

type Props = {
  eventId: string; displays: Display[]; media: MediaAsset[]; onGroupsChanged: (groups: DisplayGroup[]) => void
  section?: 'content' | 'configuration' | 'all'
}

export function OrchestrationPanel({ eventId, displays, media, onGroupsChanged, section = 'all' }: Props) {
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  const [groupMedia, setGroupMedia] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<DisplayGroup>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const revision = useRef(0)
  const mounted = useRef(true)
  const sending = useRef(false)
  const displayMembershipKey = displays.map(display => display.id).sort().join(',')

  async function refresh() {
    if (!mounted.current) return
    const request = ++revision.current
    try {
      const nextGroups = eventId ? await getDisplayGroups(eventId) : []
      if (!mounted.current || request !== revision.current) return
      setGroups(nextGroups); onGroupsChanged(nextGroups); setLoadError('')
    } catch (cause) {
      if (request === revision.current) setLoadError(cause instanceof Error ? cause.message : 'No se pudieron cargar los grupos.')
    } finally { if (request === revision.current) setLoading(false) }
  }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current++ } }, [])
  useEffect(() => { setGroups([]); setGroupMedia({}); setLoading(true); setCreating(false); setRemoving(undefined); setError(''); setNotice('') }, [eventId])
  useEffect(() => { void refresh(); return () => { revision.current++ } }, [eventId, displayMembershipKey])

  async function run(action: () => Promise<unknown>, message: string, reload = false) {
    if (sending.current) return
    sending.current = true; setBusy(true); setError(''); setNotice('')
    try { await action(); if (reload) await refresh(); setNotice(message) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción.') }
    finally { sending.current = false; setBusy(false) }
  }

  function createGroup(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !eventId) return
    void run(async () => { await createDisplayGroup(eventId, name.trim()); setCreating(false); setName('') }, 'Grupo guardado.', true)
  }

  function toggleGroupMember(group: DisplayGroup, displayId: string) {
    const displayIds = group.displayIds.includes(displayId) ? group.displayIds.filter(id => id !== displayId) : [...group.displayIds, displayId]
    void run(() => replaceDisplayGroupMembers(group.id, displayIds), `Integrantes de ${group.name} guardados.`, true)
  }

  return <>
    <div className="orchestration-section" hidden={section === 'configuration'}>
      {loadError && <p className="workspace-error" role="alert">{loadError} Los grupos no están disponibles hasta actualizar. <button onClick={() => void refresh()}>Reintentar</button></p>}
      <details className="content-compose"><summary>Publicar un anuncio o una cuenta regresiva</summary><AnnouncementsPanel key={`announcements-${eventId}`} eventId={eventId} displays={displays} groups={loadError ? [] : groups} /></details>
      <details className="content-compose"><summary>Proyectar una página web</summary><WebPagePanel key={`web-${eventId}`} eventId={eventId} displays={displays} groups={loadError ? [] : groups} /></details>
    </div>
    <section className="orchestration-section" hidden={section === 'content'} aria-labelledby="display-groups-heading">
      <div className="section-heading"><div><h2 id="display-groups-heading">Grupos de pantallas</h2><p className="muted">Elegí los integrantes y operá sobre destinos concretos.</p></div>
        <button disabled={!eventId || busy || loading || !!loadError} onClick={() => { setCreating(true); setName(''); setError('') }}>Nuevo grupo</button></div>
      {loading && <p role="status">Cargando grupos…</p>}
      {loadError && <p role="alert" className="workspace-error">{loadError} Los datos pueden estar desactualizados. <button onClick={() => void refresh()}>Reintentar</button></p>}
      {notice && <p role="status" className="workspace-feedback">{notice}</p>}
      {error && <p role="alert" className="workspace-error">{error}</p>}
      {!loading && !loadError && !groups.length && <p className="muted">Todavía no hay grupos en este evento.</p>}
      <div className="card-grid orchestration-grid">{groups.map(group => {
        const members = displays.filter(display => group.displayIds.includes(display.id))
        const asset = media.find(item => item.id === groupMedia[group.id])
        return <article className="card group-card" key={group.id}>
          <div className="display-heading"><strong>{group.name}</strong><span className="count-badge">{members.length} pantallas</span></div>
          <div className="member-list">{displays.map(display => <label key={display.id}><input type="checkbox" checked={group.displayIds.includes(display.id)} disabled={busy || !!loadError}
            onChange={() => toggleGroupMember(group, display.id)} />{display.name}</label>)}{!displays.length && <small className="muted">No hay pantallas vinculadas.</small>}</div>
          <p className="content-target-names">{members.length ? `Destino: ${members.map(display => display.name).join(', ')}` : 'Agregá integrantes para operar.'}</p>
          <div className="inline-control"><label className="workspace-field">Contenido para {group.name}<select value={asset?.id ?? ''} disabled={busy || !!loadError}
            onChange={event => setGroupMedia(current => ({ ...current, [group.id]: event.target.value }))}><option value="">Elegí un archivo</option>{media.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button disabled={busy || !members.length || !asset || !!loadError} onClick={() => void run(() => sendGroupCommand(group.id, 'media.play', { mediaId: asset!.id }), `Reproducción enviada a ${group.name} · ${members.length} pantallas. Revisá la confirmación en En vivo.`)}>Reproducir en {group.name}</button></div>
          <div className="button-row">
            <button disabled={busy || !members.length || !!loadError} onClick={() => void run(() => sendGroupCommand(group.id, 'display.identify'), `Identificación enviada a ${group.name}.`)}>Identificar</button>
            <button disabled={busy || !members.length || !!loadError} onClick={() => void run(() => sendGroupCommand(group.id, 'display.blackout'), `Oscurecimiento enviado a ${group.name}.`)}>Oscurecer pantallas</button>
            <button disabled={busy || !members.length || !!loadError} onClick={() => void run(() => sendGroupCommand(group.id, 'display.restore'), `Restauración enviada a ${group.name}.`)}>Restaurar imagen</button>
            <button disabled={busy || !members.length || !!loadError} onClick={() => void run(() => sendGroupCommand(group.id, 'media.stop'), `Detención enviada a ${group.name}.`)}>Detener contenido</button>
            <button className="danger-button" disabled={busy} onClick={() => { setRemoving(group); setError('') }}>Eliminar grupo</button>
          </div>
        </article>
      })}</div>
    </section>
    {creating && <Dialog title="Crear grupo de pantallas" busy={busy} onClose={() => setCreating(false)}><form onSubmit={createGroup}><label className="workspace-field">Nombre del grupo<input autoFocus maxLength={200} required value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      {error && <p role="alert" className="workspace-error">{error}</p>}<div className="playlist-dialog-footer"><button type="button" disabled={busy} onClick={() => setCreating(false)}>Cancelar</button><button disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Crear grupo'}</button></div></form></Dialog>}
    {removing && <Dialog title="Eliminar grupo" busy={busy} onClose={() => setRemoving(undefined)}><p>¿Eliminar «{removing.name}»? Las pantallas seguirán vinculadas y reproduciendo.</p>{error && <p role="alert" className="workspace-error">{error}</p>}
      <div className="playlist-dialog-footer"><button disabled={busy} onClick={() => setRemoving(undefined)}>Cancelar</button><button className="danger-button" disabled={busy} onClick={() => void run(async () => { await deleteDisplayGroup(removing.id); setRemoving(undefined) }, 'Grupo eliminado.', true)}>{busy ? 'Eliminando…' : 'Eliminar grupo'}</button></div></Dialog>}
  </>
}
