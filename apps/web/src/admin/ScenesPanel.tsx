import { useEffect, useRef, useState } from 'react'
import type { Display, DisplayGroup, MediaAsset, Playlist } from '../api/client'
import { activateScene, captureScene, deleteScene, duplicateScene, getScenes, getSceneSessions, prepareScene, restoreScene, saveScene, type Scene, type SceneAssignment, type SceneSession } from '../api/scenes'
import { Dialog } from './Dialog'
import { NameDialog } from './NameDialog'
import { SceneEditor } from './SceneEditor'
import { ScenePreview } from './ScenePreview'
import { assignmentSummary, returnLabel, sceneDestinations, sceneStatus } from './sceneView'
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
  const [phase, setPhase] = useState('')
  const [offer, setOffer] = useState<{ sceneId: string; preparationId: string; ready: number; missing: string[] }>()
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
  const readyTargets = (session: SceneSession) => session.targets.filter(target => ['ready', 'network'].includes(target.status))
  // One button for the operator: the server needs a current preparation, so verify the screens first and activate as soon as they answer.
  async function activateNow(scene: Scene, reusable: SceneSession | undefined, total: number) {
    if (busy) return
    setBusy(`activate:${scene.id}`); setError(''); setFeedback(''); setOffer(undefined)
    try {
      let preparation = reusable && readyTargets(reusable).length === total ? reusable : undefined
      if (!preparation) {
        setPhase('Preparando pantallas…')
        const started = await prepareScene(eventId, scene)
        preparation = started
        const deadline = Date.now() + 20000
        while (preparation.targets.some(target => target.status === 'pending') && Date.now() < deadline) {
          await new Promise(resolve => window.setTimeout(resolve, 600))
          preparation = (await getSceneSessions(eventId)).find(item => item.id === started.id) ?? preparation
        }
      }
      const ready = readyTargets(preparation)
      if (!ready.length) throw new Error('Ninguna pantalla quedó lista para esta escena. Revisá que estén conectadas y volvé a intentar.')
      if (ready.length < preparation.targets.length) {
        setOffer({ sceneId: scene.id, preparationId: preparation.id, ready: ready.length, missing: preparation.targets.filter(target => !ready.includes(target)).map(target => target.displayName) })
      } else {
        setPhase('Activando…')
        await activateScene(eventId, scene, 'all', preparation.id)
        setFeedback(`«${scene.name}» activada. Confirmá el resultado de cada pantalla en su tarjeta.`)
      }
      await refresh(); await onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo activar la escena.'); await refresh() }
    finally { setBusy(''); setPhase('') }
  }
  const latest = (scene: Scene, kind: SceneSession['kind']) => sessions.filter(item => item.sceneId === scene.id && item.kind === kind).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  return <section className="scenes-panel">
    <div className="workspace-heading"><div><h2>Escenas</h2><p>Cada escena es un momento del evento: qué se ve y en qué pantallas. Activala con un botón.</p></div><div className="button-row"><button disabled={!eventId || displays.length === 0} onClick={() => setSnapshot(true)}>Guardar configuración actual</button><button className="workspace-primary" disabled={!eventId} onClick={() => setEditor('new')}>Crear escena</button></div></div>
    {loading && <p role="status">Cargando escenas…</p>}{loadError && <p className="workspace-error" role="alert">Escenas desactualizadas: {loadError} <button onClick={() => void refresh()}>Reintentar</button></p>}{error && <p className="workspace-error" role="alert">{error}</p>}{feedback && <p className="workspace-feedback" role="status">{feedback}</p>}
    {!loading && !loadError && scenes.length === 0 && <div className="workspace-empty playlist-empty"><span aria-hidden="true">▧</span><strong>Un momento, varias pantallas.</strong><p>Prepará la bienvenida, el sorteo o el cierre del evento con un contenido distinto para cada destino.</p><button disabled={!eventId} onClick={() => setEditor('new')}>Crear primera escena</button></div>}
    <div className="scene-grid">{scenes.map(scene => {
      const resolved = sceneDestinations(scene.assignments, displays, groups)
      const preparation = latest(scene, 'prepare')
      const activation = latest(scene, 'activate')
      const previousActivations = sessions.filter(item => item.sceneId === scene.id && item.kind === 'activate' && item.id !== activation?.id)
      const currentPreparation = preparation?.version === scene.version ? preparation : undefined
      const valid = resolved.destinations.length > 0 && resolved.conflicts.length === 0 && resolved.missing.length === 0
      const readyCount = currentPreparation?.targets.filter(target => target.status === 'ready').length ?? 0
      const networkCount = currentPreparation?.targets.filter(target => target.status === 'network').length ?? 0
      const availableIds = new Set(currentPreparation?.targets.filter(target => ['ready', 'network'].includes(target.status)).map(target => target.displayId))
      const total = resolved.destinations.length
      const failed = activation?.targets.filter(target => ['error', 'timeout', 'offline', 'skipped'].includes(target.status)).map(target => target.displayId) ?? []
      // Activating consumes the preparation: the server marks its targets as superseded.
      // Show the activation result instead of presenting that as a failed preparation.
      const consumed = !!currentPreparation && activation?.version === scene.version && Date.parse(activation.createdAt) >= Date.parse(currentPreparation.createdAt)
      // Another scene or a manual action took over every screen: this one is simply no longer on air.
      const replaced = !!activation && activation.targets.length > 0 && activation.targets.every(target => target.status === 'superseded')
      const status = activation?.version === scene.version && activation.status === 'active' ? 'Activa' : replaced ? 'Guardada' : consumed ? sceneStatus(activation!.status) : currentPreparation ? sceneStatus(currentPreparation.status) : preparation ? 'Cambios pendientes de preparar' : 'Guardada'
      const blocks = new Map<SceneAssignment, Display[]>()
      for (const item of resolved.destinations) blocks.set(item.assignment, [...(blocks.get(item.assignment) ?? []), item.display])
      const activating = busy === `activate:${scene.id}`
      const sceneOffer = offer?.sceneId === scene.id ? offer : undefined
      return <article className="card scene-card" key={scene.id}>
        <div className="scene-card-top">
          {resolved.destinations[0] && <div className="scene-card-thumb" aria-hidden="true"><ScenePreview compact assignment={resolved.destinations[0].assignment} media={media} playlists={playlists} /></div>}
          <div className="scene-card-info">
            <div className="display-heading"><h3>{scene.name}</h3><span className="state-tag">{status}</span></div>
            {blocks.size ? <ul className="scene-summary">{[...blocks].map(([assignment, blockDisplays], index) => <li key={index}><DisplayNames displays={blockDisplays} /><span>{assignmentSummary(assignment, media, playlists)}</span></li>)}</ul>
              : <p className="muted">Borrador sin pantallas. Editala para elegir dónde y qué mostrar.</p>}
            {!!scene.temporaryDurationSeconds && <small className="muted">Vuelve sola a lo anterior a los {returnLabel(scene.temporaryDurationSeconds)}.</small>}
          </div>
        </div>
        {!!resolved.conflicts.length && <p className="workspace-error">Destinos con asignaciones incompatibles: {resolved.conflicts.join(', ')}</p>}{!!resolved.missing.length && <p className="workspace-error">Hay destinos que ya no existen. Editá la escena.</p>}
        <button className="workspace-primary scene-activate" disabled={!!busy || !valid || !!loadError} onClick={() => void activateNow(scene, consumed ? undefined : currentPreparation, total)}>{activating ? phase || 'Activando…' : `Activar ${scene.name} en ${total} ${total === 1 ? 'pantalla' : 'pantallas'}`}</button>
        {sceneOffer && <div className="scene-offer" role="alert"><p><strong>{sceneOffer.ready} de {total} pantallas están listas.</strong> No están disponibles: {sceneOffer.missing.join(', ')}.</p><div className="button-row"><button className="workspace-primary" disabled={!!busy} onClick={() => void action(`activate:${scene.id}`, async () => { await activateScene(eventId, scene, 'available', sceneOffer.preparationId); setOffer(undefined) }, 'Activación enviada a las pantallas listas.')}>Activar solo en {sceneOffer.ready === 1 ? 'la pantalla lista' : `las ${sceneOffer.ready} listas`}</button><button disabled={!!busy} onClick={() => setOffer(undefined)}>Cancelar</button></div></div>}
        {activation && replaced && <p className="scene-stage-title">Última activación · {new Date(activation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · después se mostró otro contenido en sus pantallas.</p>}
        {activation && !replaced && <div className="scene-stage">
          <p className="scene-stage-title">Última activación · {new Date(activation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {sceneStatus(activation.status)}{activation.version !== scene.version ? ` · versión ${activation.version}` : ''}</p>
          <SessionResults session={activation} displays={displays} />
          {activation.expiresAt && <small>Retorno previsto: {new Date(activation.expiresAt).toLocaleTimeString()}</small>}
          <div className="button-row">
            {failed.length > 0 && <>
              <button disabled={!!busy || !valid || !!loadError || activation.version !== scene.version} onClick={() => void action(`prepare-failed:${scene.id}`, () => prepareScene(eventId, scene, failed), 'Verificando nuevamente los destinos pendientes.')}>Preparar pantallas pendientes</button>
              <button disabled={!!busy || !valid || !!loadError || activation.version !== scene.version || !currentPreparation || consumed || !failed.some(id => availableIds.has(id))} onClick={() => void action(`retry:${scene.id}`, () => activateScene(eventId, scene, 'available', currentPreparation?.id, failed), 'Reintento enviado únicamente a las pantallas indicadas.')}>Reintentar {failed.length === 1 ? 'la pantalla pendiente' : `las ${failed.length} pantallas pendientes`}</button>
            </>}
            {activation.targets.some(target => ['applied', 'pending', 'timeout', 'error'].includes(target.status)) && <button disabled={!!busy} onClick={() => void action(`restore:${scene.id}`, () => restoreScene(activation.id), 'Retorno solicitado. Las acciones posteriores del operador tienen prioridad.')}>Volver a la configuración anterior</button>}
          </div>
        </div>}
        <div className="button-row scene-secondary"><button disabled={!!busy} onClick={() => setEditor(scene)}>Editar</button><button disabled={!valid || !!loadError} onClick={() => onSchedule(scene.id)}>Programar por fecha y hora</button><button onClick={() => setPreview(scene)}>Previsualizar por destino</button><button disabled={!!busy || !valid || !!loadError} title="Opcional: descarga el contenido en las pantallas antes del momento, sin cambiar lo que muestran." onClick={() => void action(`prepare:${scene.id}`, () => prepareScene(eventId, scene), 'Preparación enviada. Esperando resultados por pantalla.')}>{busy === `prepare:${scene.id}` ? 'Enviando…' : 'Preparar recursos'}</button></div>
        {currentPreparation && !consumed && <div className="scene-stage"><p className="scene-stage-title">Preparación · {readyCount} de {currentPreparation.targets.length} {currentPreparation.targets.length === 1 ? 'lista' : 'listas'} en caché{networkCount > 0 ? ` · ${networkCount} ${networkCount === 1 ? 'disponible' : 'disponibles'} por red` : ''}</p><SessionResults session={currentPreparation} displays={displays} /></div>}
        <details className="scene-more"><summary>Más · duplicar, renombrar, eliminar e historial</summary>
          <div className="button-row"><button disabled={!!busy} onClick={() => void action(`duplicate:${scene.id}`, () => duplicateScene(eventId, scene.id), 'Copia guardada. Las pantallas siguen igual.')}>Duplicar</button><button disabled={!!busy} onClick={() => setRename(scene)}>Renombrar</button><button className="danger-button" disabled={!!busy} onClick={() => setRemove(scene)}>Eliminar</button></div>
          {previousActivations.length > 0 && <><p className="scene-stage-title">Activaciones anteriores y retornos ({previousActivations.length})</p>{previousActivations.map(session => <div className="scene-stage" key={session.id}><p>Versión {session.version} · {new Date(session.createdAt).toLocaleTimeString()} · {sceneStatus(session.status)}</p><SessionResults session={session} displays={displays} />{session.targets.some(target => ['applied', 'pending', 'timeout', 'error'].includes(target.status)) && <button disabled={!!busy} onClick={() => void action(`restore:${session.id}`, () => restoreScene(session.id), 'Retorno solicitado para los destinos de esa activación.')}>Restaurar destinos de esta activación</button>}</div>)}</>}
          <p className="workspace-help">Activar verifica primero que las pantallas tengan el contenido y lo muestra de forma coordinada, sin garantía cuadro a cuadro. «Preparar recursos» permite adelantar esa verificación; vence a los 15 minutos. {scene.assignments.some(item => item.media.state || item.media.resumePositionSeconds) ? 'La configuración capturada conserva su posición y estado de pausa.' : 'El contenido reemplazado comienza desde el inicio.'} Versión {scene.version}.</p>
          <p className="workspace-help">Al volver de la escena, el contenido anterior se restaura desde su posición guardada; si estaba pausado, continúa pausado. Los anuncios dejan seguir el fondo; una página web detiene la multimedia. El retorno solo afecta a las pantallas de esta activación y respeta decisiones manuales posteriores.</p>
        </details>
      </article>
    })}</div>
    {editor && <SceneEditor eventId={eventId} scene={editor === 'new' ? undefined : editor} displays={displays} groups={groups} media={media} playlists={playlists} onClose={() => setEditor(undefined)} onSaved={scene => { setEditor(undefined); setScenes(items => [...items.filter(item => item.id !== scene.id), scene]); setFeedback(`«${scene.name}» guardada, versión ${scene.version}. La emisión no cambió.`); void refresh() }} />}
    {rename && <NameDialog title="Renombrar escena" initialName={rename.name} onClose={() => setRename(undefined)} onSave={async name => { await saveScene(eventId, { ...rename, name }, rename.id); await refresh() }} />}
    {remove && <Dialog title={`Eliminar ${remove.name}`} busy={!!busy} onClose={() => setRemove(undefined)}><p>Se eliminará la escena y se cancelará su programación pendiente. Las pantallas donde siga activa quedarán limpias; se respetarán los cambios posteriores del operador.</p>{error && <p className="workspace-error" role="alert">{error}</p>}<div className="playlist-dialog-footer"><button disabled={!!busy} onClick={() => setRemove(undefined)}>Cancelar</button><button className="danger-button" disabled={!!busy} onClick={() => void action(`delete:${remove.id}`, async () => { await deleteScene(eventId, remove.id); setRemove(undefined) }, 'Escena eliminada. Se retiró de las pantallas donde seguía activa.')}>Eliminar escena</button></div></Dialog>}
    {snapshot && <Dialog title="Guardar configuración actual" busy={!!busy} onClose={() => setSnapshot(false)}><p>Guarda lo solicitado a las pantallas, incluidas sus capas. No copia una captura ni modifica su reproducción.</p><label className="workspace-field">Nombre de la nueva escena<input value={snapshotName} maxLength={100} onChange={event => setSnapshotName(event.target.value)} /></label><fieldset className="snapshot-targets"><legend>Pantallas incluidas</legend>{orderedDisplays.map(display => <label key={display.id} className="workspace-check"><input type="checkbox" aria-label={display.name} aria-description={displayPresence(display.status).label} checked={snapshotIds.includes(display.id)} onChange={event => setSnapshotIds(ids => event.target.checked ? [...ids, display.id] : ids.filter(id => id !== display.id))} /><DisplayName display={display} /></label>)}</fieldset>{error && <p className="workspace-error" role="alert">{error}</p>}<div className="playlist-dialog-footer"><button disabled={!!busy} onClick={() => setSnapshot(false)}>Cancelar</button><button disabled={!!busy || !snapshotName.trim() || !snapshotIds.length} onClick={() => void action('snapshot', async () => { await captureScene(eventId, snapshotName, snapshotIds); setSnapshot(false); setSnapshotName(''); setSnapshotIds([]) }, 'Configuración guardada como escena.')}>Guardar {snapshotIds.length} pantallas</button></div></Dialog>}
    {preview && <Dialog title={`Vista previa · ${preview.name}`} onClose={() => setPreview(undefined)}><div className="scene-preview-grid">{sortByConnection(sceneDestinations(preview.assignments, displays, groups).destinations, item => item.display.status).map(({ display, assignment }) => <div key={display.id}><h3><DisplayName display={display} /></h3><ScenePreview assignment={assignment} media={media} playlists={playlists} /></div>)}</div></Dialog>}
  </section>
}
function SessionResults({ session, displays }: { session: SceneSession; displays: Display[] }) {
  const displaysById = new Map(displays.map(display => [display.id, display]))
  return <ul className="scene-results" aria-label={session.kind === 'prepare' ? 'Resultados de preparación' : 'Resultados de activación'}>{sortByConnection(session.targets, target => displaysById.get(target.displayId)?.status).map(target => <li key={target.displayId}><span><strong><DisplayName display={displaysById.get(target.displayId)} fallbackName={target.displayName} /></strong><small>{sceneStatus(target.status, session.kind)}</small></span>{target.detail && <small>{target.detail}</small>}</li>)}</ul>
}
