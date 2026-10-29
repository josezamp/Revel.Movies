import { useState } from 'react'
import { isMediaLink, type Display, type DisplayGroup, type MediaAsset, type Playlist } from '../api/client'
import { saveScene, type LayerAction, type Scene, type SceneAnnouncement, type SceneAssignment } from '../api/scenes'
import { Dialog } from './Dialog'
import { ScenePreview } from './ScenePreview'
import { sceneDestinations } from './sceneView'
import { webPageUrlError } from '../webpages/webPage'

export function emptyAssignment(): SceneAssignment {
  return { displayIds: [], groupIds: [], media: { action: 'keep' }, webPage: { action: 'keep' }, announcement: { action: 'keep' }, blackout: 'keep', promotions: 'keep' }
}
const defaultAnnouncement: SceneAnnouncement = { kind: 'message', text: '', layout: 'fullscreen', theme: 'dark', completedText: '¡Es ahora!' }

export function SceneEditor({ eventId, scene, displays, groups, media, playlists, onClose, onSaved }: { eventId: string; scene?: Scene; displays: Display[]; groups: DisplayGroup[]; media: MediaAsset[]; playlists: Playlist[]; onClose: () => void; onSaved: (scene: Scene) => void }) {
  const [name, setName] = useState(scene?.name ?? '')
  const [assignments, setAssignments] = useState<SceneAssignment[]>(scene?.assignments ?? [])
  const [temporary, setTemporary] = useState(scene?.temporaryDurationSeconds ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const dirty = name !== (scene?.name ?? '') || temporary !== (scene?.temporaryDurationSeconds ?? 0) || JSON.stringify(assignments) !== JSON.stringify(scene?.assignments ?? [])
  const resolved = sceneDestinations(assignments, displays, groups)
  function update(index: number, value: SceneAssignment) { setAssignments(current => current.map((item, i) => i === index ? value : item)); setError('') }
  function close() { if (dirty) setDiscard(true); else onClose() }
  async function save() {
    if (busy) return
    if (!name.trim() || name.trim().length > 100) { setError('Ingresá un nombre de hasta 100 caracteres.'); return }
    if (!Number.isInteger(temporary) || temporary < 0 || temporary > 604800) { setError('El retorno debe ser 0 (sin retorno) o una cantidad entera de segundos, hasta 7 días.'); return }
    for (const [index, assignment] of assignments.entries()) {
      const prefix = `Asignación ${index + 1}: `
      if (!assignment.displayIds.length && !assignment.groupIds.length) { setError(`${prefix}elegí un destino o quitá esta asignación para guardar el borrador.`); return }
      if (assignment.media.action === 'replace' && !(assignment.media.type === 'playlist' ? assignment.media.playlistId : assignment.media.mediaId)) { setError(`${prefix}elegí el archivo o playlist de fondo.`); return }
      if (assignment.webPage.action === 'replace') {
        const problem = webPageUrlError(assignment.webPage.payload?.url ?? '', window.location.href)
        if (problem) { setError(prefix + problem); return }
      }
      if (assignment.announcement.action === 'replace') {
        const payload = assignment.announcement.payload
        if (!payload?.text.trim() || (payload.kind === 'countdown' && !payload.completedText?.trim())) { setError(`${prefix}completá los textos del anuncio.`); return }
        if (payload.kind === 'countdown') {
          if (payload.durationSeconds !== undefined && (!Number.isInteger(payload.durationSeconds) || payload.durationSeconds < 1 || payload.durationSeconds > 604800)) { setError(`${prefix}la duración debe ser de 1 segundo a 7 días.`); return }
          if (payload.durationSeconds === undefined && (!payload.endsAt || !Number.isFinite(Date.parse(payload.endsAt)) || Date.parse(payload.endsAt) <= Date.now() || Date.parse(payload.endsAt) > Date.now() + 604800000)) { setError(`${prefix}elegí una hora futura dentro de los próximos 7 días.`); return }
        }
      }
    }
    if (resolved.conflicts.length || resolved.missing.length) { setError('Revisá los destinos incompatibles o eliminados antes de guardar.'); return }
    setBusy(true); setError('')
    try { const saved = await saveScene(eventId, { name: name.trim(), assignments, temporaryDurationSeconds: temporary || null, version: scene?.version }, scene?.id); onSaved(saved) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'); setBusy(false) }
  }
  return <Dialog title={scene ? `Editar ${scene.name}` : 'Crear escena'} busy={busy} onClose={close}>
    <div className="scene-editor"><p className="muted">Guardar conserva un borrador. Las pantallas siguen con su contenido actual.</p>
      <fieldset disabled={busy} className="scene-editor-fields"><div className="scene-form-row"><label className="workspace-field">Nombre de la escena<input autoFocus value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label><label className="workspace-field">Retorno automático (segundos)<input type="number" min={0} max={604800} value={temporary} onChange={event => setTemporary(Number(event.target.value))} /><small>0: sin retorno automático.</small></label></div>
        {assignments.map((assignment, index) => <fieldset className="scene-assignment" key={index}><legend>Asignación {index + 1}</legend>
          <div className="scene-target-picker"><fieldset><legend>Pantallas</legend>{displays.map(display => <label className="workspace-check" key={display.id}><input type="checkbox" checked={assignment.displayIds.includes(display.id)} onChange={event => update(index, { ...assignment, displayIds: toggle(assignment.displayIds, display.id, event.target.checked) })} />{display.name}</label>)}</fieldset><fieldset><legend>Grupos</legend>{groups.length === 0 && <small className="muted">Creá grupos en Configuración.</small>}{groups.map(group => <label className="workspace-check" key={group.id}><input type="checkbox" checked={assignment.groupIds.includes(group.id)} onChange={event => update(index, { ...assignment, groupIds: toggle(assignment.groupIds, group.id, event.target.checked) })} />{group.name} · {group.displayIds.length} pantallas</label>)}</fieldset></div>
          <div className="scene-layers"><div><LayerSelect label="Multimedia de fondo" value={assignment.media.action} onChange={action => update(index, { ...assignment, media: { ...assignment.media, action } })} />
            {assignment.media.action === 'replace' && <><label className="workspace-field">Archivo o playlist<select value={assignment.media.type === 'playlist' ? `playlist:${assignment.media.playlistId ?? ''}` : assignment.media.mediaId ? `media:${assignment.media.mediaId}` : ''} onChange={event => { const [type, id] = event.target.value.split(':'); update(index, { ...assignment, media: { action: 'replace', type: type as 'media' | 'playlist', ...(type === 'playlist' ? { playlistId: id } : { mediaId: id }), loop: assignment.media.loop ?? false } }) }}><option value="">Elegir contenido…</option><optgroup label="Archivos">{media.filter(item => !isMediaLink(item)).map(item => <option key={item.id} value={`media:${item.id}`}>{item.name}</option>)}</optgroup><optgroup label="Playlists">{playlists.map(item => <option key={item.id} value={`playlist:${item.id}`}>{item.name}</option>)}</optgroup></select></label><label className="workspace-check"><input type="checkbox" checked={assignment.media.loop ?? false} onChange={event => update(index, { ...assignment, media: { ...assignment.media, loop: event.target.checked } })} />Repetir</label></>}
          </div><div><LayerSelect label="Página web" value={assignment.webPage.action} onChange={action => update(index, { ...assignment, webPage: { action, payload: assignment.webPage.payload ?? { url: '' } } })} />{assignment.webPage.action === 'replace' && <label className="workspace-field">URL externa<input type="url" placeholder="https://…" value={assignment.webPage.payload?.url ?? ''} onChange={event => update(index, { ...assignment, webPage: { action: 'replace', payload: { url: event.target.value } } })} /><small>Depende de la red y de que el sitio permita mostrarse en un iframe.</small></label>}</div></div>
          <LayerSelect label="Anuncio o cuenta regresiva" value={assignment.announcement.action} onChange={action => update(index, { ...assignment, announcement: { action, payload: assignment.announcement.payload ?? { ...defaultAnnouncement } } })} />
          {assignment.announcement.action === 'replace' && <AnnouncementFields value={assignment.announcement.payload ?? defaultAnnouncement} onChange={payload => update(index, { ...assignment, announcement: { action: 'replace', payload } })} />}
          <div className="scene-form-row"><label className="workspace-field">Pantalla negra<select value={assignment.blackout} onChange={event => update(index, { ...assignment, blackout: event.target.value as SceneAssignment['blackout'] })}><option value="keep">Mantener estado actual</option><option value="on">Oscurecer pantalla</option><option value="off">Restaurar imagen</option></select></label><label className="workspace-field">Cortes promocionales<select value={assignment.promotions} onChange={event => update(index, { ...assignment, promotions: event.target.value as SceneAssignment['promotions'] })}><option value="keep">Mantener política actual</option><option value="suspend">Suspender mientras esté activa</option></select></label></div>
          <ScenePreview assignment={assignment} media={media} playlists={playlists} />
          <button className="danger-button" onClick={() => setAssignments(current => current.filter((_, i) => i !== index))}>Quitar asignación {index + 1}</button>
        </fieldset>)}
        <button onClick={() => setAssignments(current => [...current, emptyAssignment()])}>+ Agregar asignación</button>
      </fieldset>
      <div className="scene-resolved"><strong>{resolved.destinations.length} pantallas concretas</strong><p>{resolved.destinations.map(item => item.display.name).join(' · ') || 'Borrador sin destinos. Podés guardarlo y completarlo después.'}</p>{resolved.conflicts.length > 0 && <p className="workspace-error">Asignaciones incompatibles: {resolved.conflicts.join(', ')}</p>}{resolved.missing.length > 0 && <p className="workspace-error">Hay destinos eliminados. Quitá la asignación afectada y volvé a elegirlos.</p>}</div>
      <p className="workspace-help">Mantener deja la capa como está; reemplazar inicia el contenido nuevo; retirar revela la capa inferior. La orientación pertenece a cada pantalla.</p>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {discard && <div className="workspace-error" role="alert">Tenés cambios sin guardar. <button onClick={() => setDiscard(false)}>Seguir editando</button> <button onClick={onClose}>Descartar cambios</button></div>}
      <div className="playlist-dialog-footer"><button disabled={busy} onClick={close}>Cancelar</button><button className="workspace-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar borrador'}</button></div>
    </div>
  </Dialog>
}

function toggle(ids: string[], id: string, checked: boolean) { return checked ? [...ids, id] : ids.filter(item => item !== id) }
function LayerSelect({ label, value, onChange }: { label: string; value: LayerAction; onChange: (value: LayerAction) => void }) {
  return <label className="workspace-field">{label}<select value={value} onChange={event => onChange(event.target.value as LayerAction)}><option value="keep">Mantener</option><option value="replace">Reemplazar</option><option value="remove">Retirar</option></select></label>
}
function AnnouncementFields({ value, onChange }: { value: SceneAnnouncement; onChange: (value: SceneAnnouncement) => void }) {
  return <div className="scene-announcement-fields"><div className="scene-form-row"><label className="workspace-field">Tipo de anuncio<select value={value.kind} onChange={event => onChange({ ...value, kind: event.target.value as SceneAnnouncement['kind'], durationSeconds: event.target.value === 'countdown' ? 300 : undefined, endsAt: undefined })}><option value="message">Mensaje</option><option value="countdown">Cuenta regresiva</option></select></label><label className="workspace-field">Formato<select value={value.layout} onChange={event => onChange({ ...value, layout: event.target.value as SceneAnnouncement['layout'] })}><option value="fullscreen">Pantalla completa</option><option value="banner">Franja sobre el fondo</option></select></label><label className="workspace-field">Tema<select value={value.theme} onChange={event => onChange({ ...value, theme: event.target.value as SceneAnnouncement['theme'] })}><option value="dark">Oscuro</option><option value="light">Claro</option></select></label></div>
    <label className="workspace-field">Texto del anuncio<textarea value={value.text} maxLength={240} rows={2} onChange={event => onChange({ ...value, text: event.target.value })} /></label>
    {value.kind === 'countdown' && <><label className="workspace-field">Inicio de la cuenta<select value={value.durationSeconds !== undefined ? 'duration' : 'fixed'} onChange={event => onChange({ ...value, durationSeconds: event.target.value === 'duration' ? 300 : undefined, endsAt: undefined })}><option value="duration">Duración desde la activación</option><option value="fixed">Finaliza a una hora fija</option></select></label>{value.durationSeconds !== undefined ? <label className="workspace-field">Duración en segundos<input type="number" min={1} max={604800} value={value.durationSeconds} onChange={event => onChange({ ...value, durationSeconds: Number(event.target.value) })} /><small>Guardar y preparar no inician la cuenta.</small></label> : <label className="workspace-field">Fecha y hora de finalización<input type="datetime-local" value={value.endsAt ? localDateTime(value.endsAt) : ''} onChange={event => onChange({ ...value, endsAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /><small>Hora local de este panel. Se validará otra vez al activar.</small></label>}<label className="workspace-field">Texto al finalizar<input value={value.completedText ?? ''} maxLength={240} onChange={event => onChange({ ...value, completedText: event.target.value })} /></label></>}
  </div>
}
function localDateTime(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
