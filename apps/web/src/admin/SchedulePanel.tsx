import { useCallback, useEffect, useRef, useState } from 'react'
import { getScenes, type Scene } from '../api/scenes'
import { cancelSchedule, getSchedule, saveSchedule, type SceneSchedule } from '../api/schedules'
import { Dialog } from './Dialog'
import { sceneStatus } from './sceneView'
import { localDateTime, pendingSchedule, scheduleDate, scheduleStatus, scheduleTime } from './scheduleView'
import './schedule.css'

type Props = { eventId: string; timeZone: string; initialSceneId?: string; onEditorClosed: () => void; onScenes: () => void }
export function SchedulePanel({ eventId, timeZone, initialSceneId, onEditorClosed, onScenes }: Props) {
  const [entries, setEntries] = useState<SceneSchedule[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState('')
  const [editor, setEditor] = useState<SceneSchedule | 'new' | undefined>(initialSceneId ? 'new' : undefined)
  const revision = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++revision.current
    try {
      const [nextEntries, nextScenes] = await Promise.all([getSchedule(eventId), getScenes(eventId)])
      if (request !== revision.current) return
      setEntries(nextEntries); setScenes(nextScenes); setLoadError('')
    } catch (cause) { if (request === revision.current) setLoadError(cause instanceof Error ? cause.message : 'No se pudo cargar la agenda.') }
    finally { if (request === revision.current) setLoading(false) }
  }, [eventId])
  useEffect(() => {
    let disposed = false
    let timer: number
    async function poll() { await refresh(); if (!disposed) timer = window.setTimeout(poll, 3000) }
    void poll()
    return () => { disposed = true; revision.current++; window.clearTimeout(timer) }
  }, [refresh])
  async function cancel(entry: SceneSchedule) {
    if (busy) return
    setBusy(entry.id); setError(''); setFeedback('')
    try { await cancelSchedule(eventId, entry); setFeedback(`«${entry.sceneName}» cancelada. La emisión actual sigue igual.`); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cancelar.'); await refresh() }
    finally { setBusy('') }
  }
  const pending = entries.filter(entry => pendingSchedule(entry.status))
  const history = entries.filter(entry => !pendingSchedule(entry.status)).reverse()
  const next = pending.find(entry => entry.status !== 'activating')
  function closeEditor() { setEditor(undefined); onEditorClosed() }
  function row(entry: SceneSchedule) {
    const editable = ['scheduled', 'preparing'].includes(entry.status) && Date.parse(entry.startsAt) > Date.now()
    return <article className="schedule-entry" key={entry.id} aria-label={`${entry.sceneName} ${scheduleTime(entry.startsAt, entry.timeZone)}`}>
      <div className="schedule-when"><time dateTime={entry.startsAt}>{scheduleTime(entry.startsAt, entry.timeZone)}</time><span>{scheduleDate(entry.startsAt, entry.timeZone)}</span><small>{entry.timeZone}</small></div>
      <div className="schedule-content">
        <div className="schedule-entry-heading"><h4>{entry.sceneName}</h4><span className={`state-tag schedule-state-${entry.status}`}>{scheduleStatus(entry.status)}</span></div>
        <p className="muted">Versión {entry.sceneVersion} · {entry.targets.length} {entry.targets.length === 1 ? 'pantalla' : 'pantallas'} · {entry.policy === 'all' ? 'Requiere todas disponibles' : 'Activar las disponibles'}</p>
        {entry.detail && <p className="schedule-detail">{entry.detail}</p>}
        <details><summary>Resultados por pantalla ({entry.targets.length})</summary><div className="schedule-results" role="region" aria-label={`Resultados de ${entry.sceneName}`} tabIndex={0}><table>
          <thead><tr><th>Pantalla</th><th>Preparación</th><th>Ejecución</th></tr></thead>
          <tbody>{entry.targets.map(target => <tr key={target.displayId}><th scope="row">{target.displayName}</th>
            <td>{target.preparationStatus === 'pending' ? 'Pendiente' : sceneStatus(target.preparationStatus, 'prepare')}</td>
            <td>{target.status === 'pending' ? entry.status === 'activating' ? 'Esperando confirmación' : 'Pendiente de horario' : target.status === 'missed' ? 'Omitida' : sceneStatus(target.status, 'activate')}
              {target.detail && <small>{target.detail}</small>}{target.reportedAt && <small>Reporte: {new Date(target.reportedAt).toLocaleString('es-AR', { timeZone: entry.timeZone })}</small>}</td></tr>)}</tbody>
        </table></div></details>
        {editable && <div className="button-row schedule-actions"><button disabled={!!busy || !!loadError} onClick={() => setEditor(entry)}>Editar horario o escena</button><button disabled={!!busy || !!loadError} onClick={() => void cancel(entry)}>{busy === entry.id ? 'Cancelando…' : 'Cancelar entrada'}</button></div>}
      </div>
    </article>
  }
  return <section className="schedule-panel" aria-label="Agenda del evento">
    <div className="workspace-heading"><div><p className="eyebrow">EL EVENTO, A SU TIEMPO</p><h2>Programación</h2><p>Elegí las escenas y sus horarios. El servidor se ocupa de los cambios aunque cierres este panel.</p></div><button className="workspace-primary" disabled={loading || !!loadError || !scenes.length} onClick={() => setEditor('new')}>Programar escena</button></div>
    <p className="workspace-help">Las pantallas se preparan automáticamente dos minutos antes. El servidor y las pantallas deben permanecer encendidos y conectados.</p>
    {loading && <p role="status">Cargando programación…</p>}
    {loadError && <p role="alert" className="workspace-error">Agenda desactualizada: {loadError} <button onClick={() => void refresh()}>Reintentar</button></p>}
    {error && <p role="alert" className="workspace-error">{error}</p>}{feedback && <p role="status" className="workspace-feedback">{feedback}</p>}
    {!loading && !loadError && !scenes.length && <div className="workspace-empty"><strong>Primero, prepará una escena.</strong><p>La escena define el contenido y las pantallas. Acá elegís cuándo mostrarla.</p><button onClick={onScenes}>Ir a Escenas</button></div>}
    {next && <div className="schedule-next"><div><p className="eyebrow">PRÓXIMO CAMBIO</p><strong>{next.sceneName}</strong><p>{scheduleDate(next.startsAt, next.timeZone)} · {next.timeZone}</p></div><time dateTime={next.startsAt}>{scheduleTime(next.startsAt, next.timeZone)}</time></div>}
    {!loading && !!scenes.length && !pending.length && <div className="workspace-empty"><strong>No hay cambios pendientes.</strong><p>Armá la secuencia de bienvenida, concurso y cierre con fecha y hora para cada momento.</p><button disabled={!!loadError} onClick={() => setEditor('new')}>Programar primera escena</button></div>}
    {pending.length > 0 && <div className="schedule-list"><h3>Agenda · {pending.length} pendientes</h3>{pending.map(row)}</div>}
    {history.length > 0 && <div className="schedule-list schedule-history"><h3>Historial · {history.length} entradas</h3>{history.map(row)}</div>}
    <details className="schedule-help"><summary>Qué sucede si algo cambia</summary><p>Una entrada conserva la versión y los destinos que confirmaste. Si editás la escena, sus grupos o su contenido, editá también su programación para confirmar los cambios.</p><p>Si falta preparación al llegar la hora, el servidor reintenta durante un minuto. Las entradas más antiguas se omiten y quedan en el historial. Una acción manual cambia la emisión actual; las próximas entradas siguen programadas hasta que las canceles.</p><p>La confirmación de una web indica que el reproductor asignó la página. La carga del sitio externo depende de su disponibilidad y de que permita mostrarse en la pantalla.</p></details>
    {editor && !loading && <ScheduleEditor key={editor === 'new' ? 'new' : editor.id} eventId={eventId} scenes={scenes} entry={editor === 'new' ? undefined : editor} initialSceneId={initialSceneId} defaultTimeZone={timeZone}
      onClose={closeEditor} onSaved={async () => { closeEditor(); setFeedback('Programación guardada. Podés cerrar el panel; el servidor ejecutará la agenda.'); await refresh() }} />}
  </section>
}

function ScheduleEditor({ eventId, scenes, entry, initialSceneId, defaultTimeZone, onClose, onSaved }: {
  eventId: string; scenes: Scene[]; entry?: SceneSchedule; initialSceneId?: string; defaultTimeZone: string; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [sceneId, setSceneId] = useState(entry?.sceneId ?? initialSceneId ?? '')
  const [timeZone, setTimeZone] = useState(entry?.timeZone ?? defaultTimeZone)
  const [localStart, setLocalStart] = useState(() => entry?.localStartsAt ?? localDateTime(new Date(Date.now() + 5 * 60000), defaultTimeZone))
  const [policy, setPolicy] = useState<'all' | 'available'>(entry?.policy ?? 'available')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scene = scenes.find(item => item.id === sceneId)
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!scene || busy) return
    setBusy(true); setError('')
    try { await saveSchedule(eventId, { sceneId, sceneVersion: scene.version, localStartsAt: localStart, timeZone, policy, version: entry?.version }, entry?.id); await onSaved() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el guardado. Revisá la agenda antes de reintentar.'); setBusy(false) }
  }
  return <Dialog title={entry ? 'Editar programación' : 'Programar escena'} busy={busy} onClose={onClose}>
    <form onSubmit={event => void save(event)} className="schedule-form">
      <label className="workspace-field">Escena<select required value={sceneId} onChange={event => setSceneId(event.target.value)}><option value="">Elegí una escena</option>{scenes.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>
      {entry && scene && entry.sceneVersion !== scene.version && <p className="workspace-help">Al guardar, confirmarás la versión {scene.version} y sus destinos actuales.</p>}
      <label className="workspace-field">Fecha y hora<input required type="datetime-local" step="1" value={localStart} onChange={event => setLocalStart(event.target.value)} /></label>
      <label className="workspace-field">Zona horaria<input required list="schedule-time-zones" maxLength={100} value={timeZone} onChange={event => setTimeZone(event.target.value)} /></label>
      <datalist id="schedule-time-zones">{[...new Set([defaultTimeZone, 'America/Argentina/Buenos_Aires', 'America/Montevideo', 'America/Santiago', 'America/Mexico_City', 'Europe/Madrid', 'UTC'])].map(zone => <option key={zone} value={zone} />)}</datalist>
      <p className="workspace-help">La fecha y hora se interpretan en esta zona. Para después de medianoche, elegí la fecha del día siguiente.</p>
      <label className="workspace-field">Si falta alguna pantalla<select value={policy} onChange={event => setPolicy(event.target.value as 'all' | 'available')}><option value="available">Activar las disponibles y registrar las excluidas</option><option value="all">Esperar a que estén todas disponibles (hasta 1 minuto)</option></select></label>
      {scene?.temporaryDurationSeconds && <p className="workspace-help">Esta escena volverá a la configuración anterior después de {scene.temporaryDurationSeconds} segundos.</p>}
      {error && <p role="alert" className="workspace-error">{error}</p>}
      <div className="playlist-dialog-footer"><button type="button" disabled={busy} onClick={onClose}>Volver</button><button type="submit" className="workspace-primary" disabled={busy || !scene}>{busy ? 'Guardando…' : 'Guardar programación'}</button></div>
    </form>
  </Dialog>
}
