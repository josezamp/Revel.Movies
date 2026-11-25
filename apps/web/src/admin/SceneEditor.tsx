import { useState } from 'react'
import { isMediaLink, type Display, type DisplayGroup, type MediaAsset, type Playlist } from '../api/client'
import { saveScene, type LayerAction, type Scene, type SceneAnnouncement, type SceneAssignment } from '../api/scenes'
import { Dialog } from './Dialog'
import { ScenePreview } from './ScenePreview'
import { sceneDestinations } from './sceneView'
import { webPageUrlError } from '../webpages/webPage'
import { ConnectionDot, DisplayName, DisplayNames } from './DisplayName'
import { displayPresence, sortByConnection } from './displayPresence'
import { displayTargets } from './displayTargets'
import { DisplayMediaPicker, type DisplayContentSelection } from './DisplayMediaPicker'

export function emptyAssignment(): SceneAssignment {
  return { displayIds: [], groupIds: [], media: { action: 'keep' }, webPage: { action: 'keep' }, announcement: { action: 'keep' }, blackout: 'keep', promotions: 'keep' }
}
const pristineAssignment = JSON.stringify(emptyAssignment())
const returnPresets = [[0, 'No, queda hasta que la cambie'], [30, 'A los 30 segundos'], [60, 'Al minuto'], [300, 'A los 5 minutos'], [600, 'A los 10 minutos'], [1800, 'A los 30 minutos']] as const

// The simple picker covers "show this file, playlist or saved link"; anything else lives in the advanced layers.
function contentSelection(assignment: SceneAssignment, media: MediaAsset[]): DisplayContentSelection | null {
  if (assignment.webPage.action === 'replace') {
    const link = media.find(item => isMediaLink(item) && item.contentUrl === assignment.webPage.payload?.url)
    return link ? { kind: 'media', id: link.id } : null
  }
  if (assignment.media.action !== 'replace') return null
  if (assignment.media.type === 'playlist') return assignment.media.playlistId ? { kind: 'playlist', id: assignment.media.playlistId } : null
  return assignment.media.mediaId ? { kind: 'media', id: assignment.media.mediaId } : null
}
function applySelection(assignment: SceneAssignment, selection: DisplayContentSelection | null, media: MediaAsset[]): SceneAssignment {
  const withoutPage = assignment.webPage.action === 'replace' ? { action: 'keep' as const } : assignment.webPage
  if (!selection) return { ...assignment, media: assignment.media.action === 'replace' ? { action: 'keep' } : assignment.media, webPage: withoutPage }
  if (selection.kind === 'playlist') return { ...assignment, media: { action: 'replace', type: 'playlist', playlistId: selection.id, loop: assignment.media.loop ?? false }, webPage: withoutPage }
  const asset = media.find(item => item.id === selection.id)
  if (asset && isMediaLink(asset)) return { ...assignment, media: assignment.media.action === 'replace' ? { action: 'keep' } : assignment.media, webPage: { action: 'replace', payload: { url: asset.contentUrl } } }
  return { ...assignment, media: { action: 'replace', type: 'media', mediaId: selection.id, loop: assignment.media.loop ?? false }, webPage: withoutPage }
}
function needsAdvanced(assignment: SceneAssignment, media: MediaAsset[]) {
  return assignment.media.action === 'remove' || assignment.webPage.action === 'remove' || assignment.announcement.action === 'remove'
    || assignment.blackout !== 'keep' || assignment.promotions !== 'keep' || (assignment.webPage.action === 'replace' && !contentSelection(assignment, media))
}

const defaultAnnouncement: SceneAnnouncement = { kind: 'message', text: '', layout: 'fullscreen', theme: 'dark', completedText: '¡Es ahora!' }

export function SceneEditor({ eventId, scene, displays, groups, media, playlists, onClose, onSaved }: { eventId: string; scene?: Scene; displays: Display[]; groups: DisplayGroup[]; media: MediaAsset[]; playlists: Playlist[]; onClose: () => void; onSaved: (scene: Scene) => void }) {
  const [name, setName] = useState(scene?.name ?? '')
  // A scene always starts with one block ready to fill; untouched blocks are dropped on save.
  const [initialAssignments] = useState<SceneAssignment[]>(() => scene?.assignments.length ? scene.assignments : [emptyAssignment()])
  const [assignments, setAssignments] = useState<SceneAssignment[]>(initialAssignments)
  const [temporary, setTemporary] = useState(scene?.temporaryDurationSeconds ?? 0)
  const [customReturn, setCustomReturn] = useState(() => !returnPresets.some(([seconds]) => seconds === (scene?.temporaryDurationSeconds ?? 0)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const dirty = name !== (scene?.name ?? '') || temporary !== (scene?.temporaryDurationSeconds ?? 0) || JSON.stringify(assignments) !== JSON.stringify(initialAssignments)
  const resolved = sceneDestinations(assignments, displays, groups)
  const orderedDisplays = sortByConnection(displays, display => display.status)
  const groupTargets = displayTargets(displays, groups).filter(target => target.kind === 'group')
  function update(index: number, value: SceneAssignment) { setAssignments(current => current.map((item, i) => i === index ? value : item)); setError('') }
  function close() { if (dirty) setDiscard(true); else onClose() }
  async function save() {
    if (busy) return
    if (!name.trim() || name.trim().length > 100) { setError('Ingresá un nombre de hasta 100 caracteres.'); return }
    if (!Number.isInteger(temporary) || temporary < 0 || temporary > 604800) { setError('El retorno debe ser 0 (sin retorno) o una cantidad entera de segundos, hasta 7 días.'); return }
    for (const [index, assignment] of assignments.entries()) {
      if (JSON.stringify(assignment) === pristineAssignment) continue
      const prefix = assignments.length > 1 ? `Bloque ${index + 1}: ` : ''
      if (!assignment.displayIds.length && !assignment.groupIds.length) { setError(`${prefix}elegí al menos una pantalla o grupo.`); return }
      if (assignment.media.action === 'replace' && !(assignment.media.type === 'playlist' ? assignment.media.playlistId : assignment.media.mediaId)) { setError(`${prefix}elegí el archivo o la playlist a mostrar.`); return }
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
    try { const saved = await saveScene(eventId, { name: name.trim(), assignments: assignments.filter(item => JSON.stringify(item) !== pristineAssignment), temporaryDurationSeconds: temporary || null, version: scene?.version }, scene?.id); onSaved(saved) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'); setBusy(false) }
  }
  return <Dialog title={scene ? `Editar ${scene.name}` : 'Crear escena'} busy={busy} onClose={close}>
    <div className="scene-editor"><p className="muted">Guardar no cambia nada en las pantallas. La escena se muestra recién al activarla.</p>
      <fieldset disabled={busy} className="scene-editor-fields"><div className="scene-form-row"><label className="workspace-field">Nombre de la escena<input autoFocus value={name} maxLength={100} placeholder="Ej. Brindis, Sorteo, Cierre" onChange={event => setName(event.target.value)} /></label>
        <div className="scene-return"><label className="workspace-field">Volver a lo anterior automáticamente<select value={customReturn ? 'custom' : String(temporary)} onChange={event => { if (event.target.value === 'custom') { setCustomReturn(true); if (!temporary) setTemporary(120) } else { setCustomReturn(false); setTemporary(Number(event.target.value)) } }}>{returnPresets.map(([seconds, label]) => <option key={seconds} value={seconds}>{label}</option>)}<option value="custom">Otro tiempo…</option></select></label>
          {customReturn && <label className="workspace-field">Segundos hasta volver<input type="number" min={0} max={604800} value={temporary} onChange={event => setTemporary(Number(event.target.value))} /></label>}</div></div>
        {assignments.map((assignment, index) => {
          const selection = contentSelection(assignment, media)
          const targetNames = [...orderedDisplays.filter(display => assignment.displayIds.includes(display.id)).map(display => display.name), ...groupTargets.filter(group => assignment.groupIds.includes(group.id)).map(group => group.label)].join(', ')
          const announcing = assignment.announcement.action === 'replace'
          return <fieldset className="scene-assignment" key={index}><legend>{assignments.length > 1 ? `Bloque ${index + 1}` : 'Dónde y qué mostrar'}</legend>
            <div className="scene-step"><strong>1. ¿En qué pantallas?</strong>
              <div className={`scene-target-picker${groups.length ? '' : ' is-single'}`}><fieldset><legend>Pantallas</legend>{orderedDisplays.length === 0 && <small className="muted">Vinculá una pantalla desde Configuración.</small>}{orderedDisplays.map(display => <label className="workspace-check" key={display.id}><input type="checkbox" aria-label={display.name} aria-description={displayPresence(display.status).label} checked={assignment.displayIds.includes(display.id)} onChange={event => update(index, { ...assignment, displayIds: toggle(assignment.displayIds, display.id, event.target.checked) })} /><DisplayName display={display} /></label>)}</fieldset>
                {groups.length > 0 && <fieldset><legend>Grupos</legend>{groupTargets.map(group => <label className="workspace-check" key={group.id}><input type="checkbox" aria-label={group.label} aria-description={group.statusLabel} checked={assignment.groupIds.includes(group.id)} onChange={event => update(index, { ...assignment, groupIds: toggle(assignment.groupIds, group.id, event.target.checked) })} /><span className="display-name"><ConnectionDot connected={group.connected} label={group.statusLabel} /><span>{group.label} · {group.statusLabel}</span></span></label>)}</fieldset>}</div>
            </div>
            <div className="scene-step"><strong>2. ¿Qué mostrar?</strong>
              <DisplayMediaPicker displayName={targetNames || 'esta escena'} media={media} playlists={playlists} selected={selection} assigned={null} disabled={false} pendingLabel="" resetLabel="No cambiar el contenido"
                footerHint="El contenido elegido se muestra recién al activar la escena." onSelect={next => update(index, applySelection(assignment, next, media))} />
              {assignment.media.action === 'replace' && <label className="workspace-check"><input type="checkbox" checked={assignment.media.loop ?? false} onChange={event => update(index, { ...assignment, media: { ...assignment.media, loop: event.target.checked } })} />Repetir</label>}
              {!selection && assignment.media.action === 'keep' && assignment.webPage.action === 'keep' && <small className="muted">Sin elegir contenido, las pantallas siguen con lo que estén mostrando.</small>}
            </div>
            <div className="scene-step"><strong>3. ¿Algo encima?</strong>
              <label className="workspace-check"><input type="checkbox" checked={announcing} onChange={event => update(index, { ...assignment, announcement: event.target.checked ? { action: 'replace', payload: assignment.announcement.payload ?? { ...defaultAnnouncement } } : { action: 'keep' } })} />Mostrar un anuncio o cuenta regresiva</label>
              {announcing && <AnnouncementFields value={assignment.announcement.payload ?? defaultAnnouncement} onChange={payload => update(index, { ...assignment, announcement: { action: 'replace', payload } })} />}
            </div>
            <details className="scene-advanced" open={needsAdvanced(assignment, media) || undefined}><summary>Opciones avanzadas · retirar capas, pantalla negra y promociones</summary>
              <div className="scene-layers"><LayerSelect label="Multimedia de fondo" value={assignment.media.action} onChange={action => update(index, { ...assignment, media: { ...assignment.media, action } })} />
                <div><LayerSelect label="Página web" value={assignment.webPage.action} onChange={action => update(index, { ...assignment, webPage: { action, payload: assignment.webPage.payload ?? { url: '' } } })} />{assignment.webPage.action === 'replace' && <label className="workspace-field">URL externa<input type="url" placeholder="https://…" value={assignment.webPage.payload?.url ?? ''} onChange={event => update(index, { ...assignment, webPage: { action: 'replace', payload: { url: event.target.value } } })} /><small>Depende de la red y de que el sitio permita mostrarse dentro de Revel.</small></label>}</div>
                <LayerSelect label="Anuncio o cuenta regresiva" value={assignment.announcement.action} onChange={action => update(index, { ...assignment, announcement: { action, payload: assignment.announcement.payload ?? { ...defaultAnnouncement } } })} />
                <label className="workspace-field">Pantalla negra<select value={assignment.blackout} onChange={event => update(index, { ...assignment, blackout: event.target.value as SceneAssignment['blackout'] })}><option value="keep">Mantener estado actual</option><option value="on">Oscurecer pantalla</option><option value="off">Restaurar imagen</option></select></label>
                <label className="workspace-field">Cortes promocionales<select value={assignment.promotions} onChange={event => update(index, { ...assignment, promotions: event.target.value as SceneAssignment['promotions'] })}><option value="keep">Mantener política actual</option><option value="suspend">Suspender mientras esté activa</option></select></label></div>
              <p className="workspace-help">Mantener deja esa capa como está; reemplazar inicia el contenido nuevo; retirar la quita y deja ver lo que hay debajo. La orientación pertenece a cada pantalla.</p>
            </details>
            <ScenePreview assignment={assignment} media={media} playlists={playlists} />
            {assignments.length > 1 && <button className="danger-button" onClick={() => setAssignments(current => current.filter((_, i) => i !== index))}>Quitar bloque {index + 1}</button>}
          </fieldset>
        })}
        <button onClick={() => setAssignments(current => [...current, emptyAssignment()])}>+ Otro contenido para otras pantallas</button>
      </fieldset>
      <div className="scene-resolved">{resolved.destinations.length ? <><strong>Se activa en {resolved.destinations.length} {resolved.destinations.length === 1 ? 'pantalla' : 'pantallas'}</strong><p><DisplayNames displays={resolved.destinations.map(item => item.display)} /></p></> : <p>Todavía sin pantallas elegidas. Podés guardarla y completarla después.</p>}{resolved.conflicts.length > 0 && <p className="workspace-error">Una misma pantalla está en bloques con contenido distinto: {resolved.conflicts.join(', ')}</p>}{resolved.missing.length > 0 && <p className="workspace-error">Hay destinos eliminados. Quitá el bloque afectado y volvé a elegirlos.</p>}</div>
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
