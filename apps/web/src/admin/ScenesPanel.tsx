import { useEffect, useRef, useState } from 'react'
import type { Display, DisplayGroup, MediaAsset, Playlist } from '../api/client'
import { activateScene, captureScene, deleteScene, duplicateScene, getScenes, getSceneSessions, prepareScene, restoreScene, saveScene, type Scene, type SceneSession } from '../api/scenes'
import { Dialog } from './Dialog'
import { NameDialog } from './NameDialog'
import { SceneEditor } from './SceneEditor'
import { ScenePreview } from './ScenePreview'
import { sceneDestinations, sceneStatus } from './sceneView'
import { DisplayName, DisplayNames } from './DisplayName'
import { displayPresence, sortByConnection } from './displayPresence'

type Props = { eventId: string; displays: Display[]; groups: DisplayGroup[]; media: MediaAsset[]; playlists: Playlist[]; onChanged: () => Promise<void>; active: boolean; onPreparedChange: (labels: Record<string, string[]>) => void; onSchedule: (sceneId: string) => void }
export function ScenesPanel({ eventId, displays, groups, media, playlists, onChanged, active, onPreparedChange, onSchedule }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [sessions, setSessions] = useState<SceneSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState('')
  const [editor, setEditor] = useState<Scene | 'new'>()
  const [rename, setRename] = useState<Scene>()
  const [remove, setRemove] = useState<Scene>()
  const [snapshot, setSnapshot] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [snapshotIds, setSnapshotIds] = useState<string[]>([])
  const [preview, setPreview] = useState<Scene>()
  const [policies, setPolicies] = useState<Record<string, 'all' | 'available'>>({})
  const orderedDisplays = sortByConnection(displays, display => display.status)
  const requestRevision = useRef(0)
  async function refresh() {
    const revision = ++requestRevision.current
    try {
      const [nextScenes, nextSessions] = eventId ? await Promise.all([getScenes(eventId), getSceneSessions(eventId)]) : [[], []]
      if (revision !== requestRevision.current) return
      setScenes(nextScenes); setSessions(nextSessions); setLoadError('')
      const preparedLabels: Record<string, string[]> = {}
      for (const scene of nextScenes) {
        const session = nextSessions.filter(item => item.sceneId === scene.id && item.version === scene.version && item.kind === 'prepare').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
        for (const target of session?.targets ?? []) if (['ready', 'network', 'pending', 'partial', 'error'].includes(target.status))
          (preparedLabels[target.displayId] ??= []).push(`${scene.name} · v${scene.version} · ${sceneStatus(target.status, 'prepare')}`)
      }
      onPreparedChange(preparedLabels)
    } catch (cause) { if (revision === requestRevision.current) { setLoadError(cause instanceof Error ? cause.message : 'No se pudieron actualizar las escenas.'); onPreparedChange({}) } }
    finally { if (revision === requestRevision.current) setLoading(false) }
  }
  useEffect(() => {
    if (!active) return
    let disposed = false
    let timer: number
    async function poll() { await refresh(); if (!disposed) timer = window.setTimeout(poll, 2000) }
    void poll()
    return () => { disposed = true; requestRevision.current++; window.clearTimeout(timer) }
  }, [eventId, active])
  async function action(key: string, run: () => Promise<unknown>, message: string) {
    if (busy) return
    setBusy(key); setError(''); setFeedback('')
    try { await run(); setFeedback(message); await refresh(); await onChanged() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción.') }
    finally { setBusy('') }
  }
  const latest = (scene: Scene, kind: SceneSession['kind']) => sessions.filter(item => item.sceneId === scene.id && item.kind === kind).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  return <section className="scenes-panel">
    <div className="workspace-heading"><div><p className="eyebrow">PREPARÁ EL SIGUIENTE MOMENTO</p><h2>Escenas</h2><p>Guardá una configuración, prepará sus recursos y activala con destinos claros.</p></div><div className="button-row"><button disabled={!eventId || displays.length === 0} onClick={() => setSnapshot(true)}>Guardar configuración actual</button><button className="workspace-primary" disabled={!eventId} onClick={() => setEditor('new')}>Crear escena</button></div></div>
    {loading && <p role="status">Cargando escenas…</p>}{loadError && <p className="workspace-error" role="alert">Escenas desactualizadas: {loadError} <button onClick={() => void refresh()}>Reintentar</button></p>}{error && <p className="workspace-error" role="alert">{error}</p>}{feedback && <p className="workspace-feedback" role="status">{feedback}</p>}
    {!loading && !loadError && scenes.length === 0 && <div className="workspace-empty playlist-empty"><span aria-hidden="true">▧</span><strong>Un momento, varias pantallas.</strong><p>Prepará la bienvenida, el sorteo o el cierre del evento con un contenido distinto para cada destino.</p><button disabled={!eventId} onClick={() => setEditor('new')}>Crear primera escena</button></div>}
    <div className="scene-grid">{scenes.map(scene => {
      const resolved = sceneDestinations(scene.assignments, displays, groups)
      const preparation = latest(scene, 'prepare')
      const activation = latest(scene, 'activate')
      const previousActivations = sessions.filter(item => item.sceneId === scene.id && item.kind === 'activate' && item.id !== activation?.id)
      const currentPreparation = preparation?.version === scene.version ? preparation : undefined
      const policy = policies[scene.id] ?? 'all'
      const valid = resolved.destinations.length > 0 && resolved.conflicts.length === 0 && resolved.missing.length === 0
      const readyCount = currentPreparation?.targets.filter(target => target.status === 'ready').length ?? 0
      const networkCount = currentPreparation?.targets.filter(target => target.status === 'network').length ?? 0
      const availableIds = new Set(currentPreparation?.targets.filter(target => ['ready', 'network'].includes(target.status)).map(target => target.displayId))
      const activationCount = policy === 'available' ? resolved.destinations.filter(item => availableIds.has(item.display.id)).length : resolved.destinations.length
      const excludedDisplays = policy === 'available' ? resolved.destinations.filter(item => !availableIds.has(item.display.id)).map(item => item.display) : []
      const canActivate = valid && (policy === 'all' ? resolved.destinations.every(item => availableIds.has(item.display.id)) : resolved.destinations.some(item => availableIds.has(item.display.id)))
      const failed = activation?.targets.filter(target => ['error', 'timeout', 'offline', 'skipped'].includes(target.status)).map(target => target.displayId) ?? []
      const status = activation?.version === scene.version && activation.status === 'active' ? 'Activa' : currentPreparation ? sceneStatus(currentPreparation.status) : preparation ? 'Cambios pendientes de preparar' : 'Guardada'
      return <article className="card scene-card" key={scene.id}>
        <div className="display-heading"><h3>{scene.name}</h3><span className="state-tag">{status}</span></div>
        <p className="muted">Versión {scene.version} · {resolved.destinations.length} {resolved.destinations.length === 1 ? 'pantalla' : 'pantallas'}{scene.temporaryDurationSeconds ? ` · Retorno en ${scene.temporaryDurationSeconds} s` : ''}</p>
        <p className="scene-destinations">{resolved.destinations.length ? <DisplayNames displays={resolved.destinations.map(item => item.display)} /> : 'Borrador sin destinos'}</p>
        <button disabled={!valid || !!loadError} onClick={() => onSchedule(scene.id)}>Programar por fecha y hora</button>
        {!!resolved.conflicts.length && <p className="workspace-error">Destinos con asignaciones incompatibles: {resolved.conflicts.join(', ')}</p>}{!!resolved.missing.length && <p className="workspace-error">Hay destinos que ya no existen. Editá la escena.</p>}
        <div className="button-row"><button disabled={!!busy} onClick={() => setEditor(scene)}>Editar</button><button onClick={() => setPreview(scene)}>Previsualizar por destino</button><button disabled={!!busy} onClick={() => setRename(scene)}>Renombrar</button><button disabled={!!busy} onClick={() => void action(`duplicate:${scene.id}`, () => duplicateScene(eventId, scene.id), 'Copia guardada. Las pantallas siguen igual.')}>Duplicar</button><button className="danger-button" disabled={!!busy} onClick={() => setRemove(scene)}>Eliminar</button></div>
        <div className="scene-stage"><div className="section-heading"><strong>1. Preparar</strong><button disabled={!!busy || !valid || !!loadError} onClick={() => void action(`prepare:${scene.id}`, () => prepareScene(eventId, scene), 'Preparación enviada. Esperando resultados por pantalla.')}>{busy === `prepare:${scene.id}` ? 'Enviando…' : 'Preparar recursos'}</button></div><p className="workspace-help">Continúa la emisión actual. La preparación no activa anuncios ni inicia cuentas regresivas.</p>
          {currentPreparation && <><p>{readyCount} de {currentPreparation.targets.length} {currentPreparation.targets.length === 1 ? 'lista' : 'listas'} en caché{networkCount > 0 ? ` · ${networkCount} ${networkCount === 1 ? 'disponible' : 'disponibles'} por red` : ''}</p><SessionResults session={currentPreparation} displays={displays} /></>}
        </div>
        <div className="scene-stage"><strong>2. Activar</strong><label className="workspace-field">Si falta alguna pantalla<select value={policy} onChange={event => setPolicies(current => ({ ...current, [scene.id]: event.target.value as 'all' | 'available' }))}><option value="all">Esperar a que estén todas disponibles</option><option value="available">Activar solo las disponibles y listar las excluidas</option></select></label>
          <p className="workspace-help">{scene.assignments.some(item => item.media.state || item.media.resumePositionSeconds) ? 'La configuración capturada conserva su posición y estado de pausa.' : 'El contenido reemplazado comienza desde el inicio.'} La web requiere red. Inicio coordinado, sin garantía cuadro a cuadro.</p>
          {!canActivate && valid && <small className="muted">{currentPreparation ? 'Faltan destinos disponibles para la política elegida. Prepará de nuevo o elegí activar solo las disponibles.' : 'Prepará esta versión para habilitar la activación.'}</small>}
          {excludedDisplays.length > 0 && <p className="workspace-help">Quedan fuera de esta activación: <DisplayNames displays={excludedDisplays} />.</p>}
          <button className="workspace-primary scene-activate" disabled={!!busy || !canActivate || !!loadError} onClick={() => void action(`activate:${scene.id}`, () => activateScene(eventId, scene, policy, currentPreparation?.id), 'Activación enviada. Confirmá el resultado de cada pantalla abajo.')}>{busy === `activate:${scene.id}` ? 'Activando…' : `Activar ${scene.name} en ${activationCount} ${activationCount === 1 ? 'pantalla' : 'pantallas'}`}</button>
          {activation && <>
            <p>Versión {activation.version} · {sceneStatus(activation.status)}</p>
            <SessionResults session={activation} displays={displays} />
            {activation.expiresAt && <small>Retorno previsto: {new Date(activation.expiresAt).toLocaleTimeString()}</small>}
            <div className="button-row">
              {failed.length > 0 && <>
                <button disabled={!!busy || !valid || !!loadError || activation.version !== scene.version} onClick={() => void action(`prepare-failed:${scene.id}`, () => prepareScene(eventId, scene, failed), 'Verificando nuevamente los destinos pendientes.')}>Preparar pantallas pendientes</button>
                <button disabled={!!busy || !valid || !!loadError || activation.version !== scene.version || !currentPreparation || (policy === 'all' ? failed.some(id => !availableIds.has(id)) : !failed.some(id => availableIds.has(id)))} onClick={() => void action(`retry:${scene.id}`, () => activateScene(eventId, scene, policy, currentPreparation?.id, failed), 'Reintento enviado únicamente a las pantallas indicadas.')}>Reintentar {failed.length} pantallas pendientes</button>
              </>}
              {activation.targets.some(target => ['applied', 'pending', 'timeout', 'error'].includes(target.status)) && <button disabled={!!busy} onClick={() => void action(`restore:${scene.id}`, () => restoreScene(activation.id), 'Retorno solicitado. Las acciones posteriores del operador tienen prioridad.')}>Volver a la configuración anterior</button>}
            </div>
          </>}
        </div>
        {previousActivations.length > 0 && <details><summary>Activaciones anteriores y retornos ({previousActivations.length})</summary>{previousActivations.map(session => <div className="scene-stage" key={session.id}><p>Versión {session.version} · {new Date(session.createdAt).toLocaleTimeString()} · {sceneStatus(session.status)}</p><SessionResults session={session} displays={displays} />{session.targets.some(target => ['applied', 'pending', 'timeout', 'error'].includes(target.status)) && <button disabled={!!busy} onClick={() => void action(`restore:${session.id}`, () => restoreScene(session.id), 'Retorno solicitado para los destinos de esa activación.')}>Restaurar destinos de esta activación</button>}</div>)}</details>}
        <details><summary>Cómo funciona el retorno</summary><p className="workspace-help">Retirar una capa revela el fondo que siguió reproduciéndose. Un fondo reemplazado se restaura desde su posición guardada; si estaba pausado, continúa pausado. El retorno solo afecta a las pantallas de esta activación y respeta decisiones manuales posteriores.</p></details>
      </article>
    })}</div>
    {editor && <SceneEditor eventId={eventId} scene={editor === 'new' ? undefined : editor} displays={displays} groups={groups} media={media} playlists={playlists} onClose={() => setEditor(undefined)} onSaved={scene => { setEditor(undefined); setScenes(items => [...items.filter(item => item.id !== scene.id), scene]); setFeedback(`«${scene.name}» guardada, versión ${scene.version}. La emisión no cambió.`); void refresh() }} />}
    {rename && <NameDialog title="Renombrar escena" initialName={rename.name} onClose={() => setRename(undefined)} onSave={async name => { await saveScene(eventId, { ...rename, name }, rename.id); await refresh() }} />}
    {remove && <Dialog title={`Eliminar ${remove.name}`} busy={!!busy} onClose={() => setRemove(undefined)}><p>Se eliminará la escena guardada. El contenido ya activado seguirá en las pantallas.</p>{error && <p className="workspace-error" role="alert">{error}</p>}<div className="playlist-dialog-footer"><button disabled={!!busy} onClick={() => setRemove(undefined)}>Cancelar</button><button className="danger-button" disabled={!!busy} onClick={() => void action(`delete:${remove.id}`, async () => { await deleteScene(eventId, remove.id); setRemove(undefined) }, 'Escena eliminada.')}>Eliminar escena</button></div></Dialog>}
    {snapshot && <Dialog title="Guardar configuración actual" busy={!!busy} onClose={() => setSnapshot(false)}><p>Guarda lo solicitado a las pantallas, incluidas sus capas. No copia una captura ni modifica su reproducción.</p><label className="workspace-field">Nombre de la nueva escena<input value={snapshotName} maxLength={100} onChange={event => setSnapshotName(event.target.value)} /></label><fieldset className="snapshot-targets"><legend>Pantallas incluidas</legend>{orderedDisplays.map(display => <label key={display.id} className="workspace-check"><input type="checkbox" aria-label={display.name} aria-description={displayPresence(display.status).label} checked={snapshotIds.includes(display.id)} onChange={event => setSnapshotIds(ids => event.target.checked ? [...ids, display.id] : ids.filter(id => id !== display.id))} /><DisplayName display={display} /></label>)}</fieldset>{error && <p className="workspace-error" role="alert">{error}</p>}<div className="playlist-dialog-footer"><button disabled={!!busy} onClick={() => setSnapshot(false)}>Cancelar</button><button disabled={!!busy || !snapshotName.trim() || !snapshotIds.length} onClick={() => void action('snapshot', async () => { await captureScene(eventId, snapshotName, snapshotIds); setSnapshot(false); setSnapshotName(''); setSnapshotIds([]) }, 'Configuración guardada como escena.')}>Guardar {snapshotIds.length} pantallas</button></div></Dialog>}
    {preview && <Dialog title={`Vista previa · ${preview.name}`} onClose={() => setPreview(undefined)}><div className="scene-preview-grid">{sortByConnection(sceneDestinations(preview.assignments, displays, groups).destinations, item => item.display.status).map(({ display, assignment }) => <div key={display.id}><h3><DisplayName display={display} /></h3><ScenePreview assignment={assignment} media={media} playlists={playlists} /></div>)}</div></Dialog>}
  </section>
}
function SessionResults({ session, displays }: { session: SceneSession; displays: Display[] }) {
  const displaysById = new Map(displays.map(display => [display.id, display]))
  return <ul className="scene-results" aria-label={session.kind === 'prepare' ? 'Resultados de preparación' : 'Resultados de activación'}>{sortByConnection(session.targets, target => displaysById.get(target.displayId)?.status).map(target => <li key={target.displayId}><span><strong><DisplayName display={displaysById.get(target.displayId)} fallbackName={target.displayName} /></strong><small>{sceneStatus(target.status, session.kind)}</small></span>{target.detail && <small>{target.detail}</small>}</li>)}</ul>
}
