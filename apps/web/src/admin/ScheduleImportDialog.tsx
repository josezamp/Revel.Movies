import { useEffect, useRef, useState } from 'react'
import type { Display, DisplayGroup, MediaAsset, Playlist } from '../api/client'
import { importSchedule, previewScheduleImport, type ScheduleImportPreview, type ScheduleImportResult } from '../api/schedules'
import { Dialog } from './Dialog'
import { ScenePreview } from './ScenePreview'
import { importLocalDate, MAX_SCHEDULE_IMPORT_BYTES, scheduleImportJson } from './scheduleImport'

type Props = {
  eventId: string; displays: Display[]; groups: DisplayGroup[]; media: MediaAsset[]; playlists: Playlist[]
  onClose: () => void; onImported: (result: ScheduleImportResult) => void
}
type ValidatedImport = { json: string; preview: ScheduleImportPreview }

export function ScheduleImportDialog({ eventId, displays, groups, media, playlists, onClose, onImported }: Props) {
  const [source, setSource] = useState('')
  const [sourceOpen, setSourceOpen] = useState(true)
  const [fileName, setFileName] = useState('')
  const [validated, setValidated] = useState<ValidatedImport>()
  const [busy, setBusy] = useState<'file' | 'preview' | 'import'>()
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(() => new Set())
  const active = useRef(true)
  const revision = useRef(0)
  const locked = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { active.current = true; return () => { active.current = false; revision.current++ } }, [eventId])
  useEffect(() => { if (validated) previewHeading.current?.focus() }, [validated])

  function edit(value: string) {
    if (locked.current) return
    revision.current++
    setSource(value); setFileName(''); setError('')
    if (validated) setChanged(true)
    setValidated(undefined); setExpandedScenes(new Set())
  }

  async function readFile(file?: File) {
    if (!file || locked.current) return
    const request = ++revision.current
    setValidated(undefined); setExpandedScenes(new Set()); setChanged(false); setError('')
    if (file.size > MAX_SCHEDULE_IMPORT_BYTES) { setError('El archivo supera el límite de 1 MB. Dividí la programación en archivos más pequeños.'); return }
    locked.current = true; setBusy('file')
    try {
      const value = await file.text()
      if (active.current && request === revision.current) { setSource(value); setFileName(file.name) }
    } catch { if (active.current && request === revision.current) setError('No se pudo leer el archivo. Elegilo de nuevo o pegá su contenido.') }
    finally { locked.current = false; if (active.current && request === revision.current) setBusy(undefined) }
  }

  async function validate() {
    if (locked.current) return
    const request = ++revision.current
    setError(''); setValidated(undefined); setExpandedScenes(new Set()); setChanged(false)
    let json: string
    try { json = scheduleImportJson(source) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisá el JSON.'); return }
    locked.current = true; setBusy('preview')
    try {
      const preview = await previewScheduleImport(eventId, json)
      if (active.current && request === revision.current) { setValidated({ json, preview }); setSourceOpen(false) }
    } catch (cause) {
      if (active.current && request === revision.current) setError(cause instanceof Error ? cause.message : 'No se pudo validar la programación. Tu JSON sigue acá para reintentar.')
    } finally { locked.current = false; if (active.current && request === revision.current) setBusy(undefined) }
  }

  async function confirm() {
    if (locked.current || !validated) return
    const request = ++revision.current
    locked.current = true; setBusy('import'); setError('')
    try {
      const result = await importSchedule(eventId, validated.json, validated.preview.previewToken)
      if (active.current && request === revision.current) onImported(result)
    } catch (cause) {
      if (active.current && request === revision.current)
        setError(`${cause instanceof Error ? cause.message : 'No se pudo confirmar la importación.'} Tu JSON se conserva. Podés reintentar sin duplicar la misma importación; si cambió el evento, volvé a validar.`)
    } finally { locked.current = false; if (active.current && request === revision.current) setBusy(undefined) }
  }

  const preview = validated?.preview
  const names = new Map(displays.map(display => [display.id, display.name]))
  for (const entry of preview?.schedule ?? []) for (const target of entry.targets) names.set(target.displayId, target.displayName)
  const groupNames = new Map(groups.map(group => [group.id, group.name]))
  return <Dialog title="Importar escenas y programación" busy={!!busy} onClose={onClose} initialFocusRef={input}>
    <div className="schedule-import">
      <p>{preview ? 'Revisá los horarios, las pantallas y el contenido antes de importar.' : 'Pegá la respuesta de ChatGPT o elegí un archivo JSON. Primero revisá las escenas, las pantallas y las fechas; después confirmá la importación.'}</p>
      <details className="schedule-import-source-disclosure" open={sourceOpen} onToggle={event => setSourceOpen(event.currentTarget.open)}>
      <summary>Ver o editar JSON</summary>
      <div className="schedule-import-source">
        <label className="workspace-field schedule-import-file">Archivo JSON <span className="muted">Hasta 1 MB</span><input type="file" accept=".json,application/json" disabled={!!busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readFile(file) }} /></label>
        <label className="workspace-field">JSON de programación<textarea ref={input} className="schedule-json-input" value={source} rows={preview ? 5 : 10} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={!!busy} onChange={event => edit(event.target.value)} placeholder={'{\n  "schemaVersion": 1,\n  "eventId": "…",\n  "scenes": [],\n  "schedule": []\n}'} /></label>
        {fileName && <p className="workspace-help">Archivo cargado: {fileName}</p>}
        <div className="schedule-import-validation"><p className="workspace-help">Se crean escenas nuevas y se agregan sus horarios a la agenda del evento. Cada horario activa una escena; el final de una franja necesita otro cambio o un retorno temporal.</p><button disabled={!!busy || !source.trim()} onClick={() => void validate()}>{busy === 'preview' ? 'Validando…' : 'Validar y previsualizar'}</button></div>
      </div></details>
      {busy === 'file' && <p role="status">Leyendo archivo…</p>}
      {busy === 'preview' && <p role="status">Revisando el formato, los recursos, los destinos y los horarios…</p>}
      {busy === 'import' && <p role="status">Guardando las escenas y la programación…</p>}
      {changed && <p role="status" className="workspace-help">El JSON cambió. Validalo de nuevo para actualizar la vista previa.</p>}
      {error && <p role="alert" className="workspace-error">{error}</p>}
      {preview && <section className="schedule-import-preview" aria-label="Vista previa de importación">
        <div className="schedule-import-summary"><div><p className="eyebrow">ANTES DE GUARDAR</p><h3 ref={previewHeading} tabIndex={-1}>Revisá la programación</h3></div><p>{preview.scenes.length} {preview.scenes.length === 1 ? 'escena' : 'escenas'}<span aria-hidden="true"> · </span>{preview.schedule.length} {preview.schedule.length === 1 ? 'horario' : 'horarios'}</p></div>
        {preview.alreadyImported && <p role="status" className="workspace-feedback">Este JSON ya fue importado. Podés volver a la agenda; se conservará la importación existente.</p>}
        {preview.warnings.length > 0 && <ul className="schedule-import-warnings" aria-label="Observaciones de la programación">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <ol className="schedule-import-timeline">{preview.schedule.map((entry, index) => <li key={`${entry.sceneKey}:${entry.localStartsAt}:${index}`}>
          <div className="schedule-when"><time dateTime={entry.localStartsAt}>{entry.localStartsAt.slice(11)}</time><span>{importLocalDate(entry.localStartsAt)}</span><small>{entry.timeZone}</small></div>
          <div className="schedule-import-moment"><h4>{entry.sceneName}</h4><p>{entry.targets.map(target => target.displayName).join(' · ')}</p><small>{entry.policy === 'all' ? 'Requiere todas las pantallas disponibles' : 'Activar las pantallas disponibles'}</small></div>
        </li>)}</ol>
        <div className="schedule-import-scenes">{preview.scenes.map(scene => <details key={scene.key} onToggle={event => {
          const open = event.currentTarget.open
          setExpandedScenes(current => {
            if (current.has(scene.key) === open) return current
            const next = new Set(current)
            if (open) next.add(scene.key); else next.delete(scene.key)
            return next
          })
        }}>
          <summary>Contenido de {scene.name}</summary>
          {expandedScenes.has(scene.key) && <>
          <p className="workspace-help">{scene.temporaryDurationSeconds ? `Retorno a la configuración anterior después de ${scene.temporaryDurationSeconds} segundos.` : 'Permanece hasta el próximo cambio de escena o una acción manual.'}</p>
          <div className="scene-preview-grid">{scene.assignments.map((assignment, index) => <article key={index}>
            <h4>{[...assignment.displayIds.map(id => names.get(id) ?? 'Pantalla del evento'), ...assignment.groupIds.map(id => groupNames.get(id) ?? 'Grupo del evento')].join(' · ')}</h4>
            <ScenePreview assignment={assignment} media={media} playlists={playlists} />
            <p className="workspace-help">Pantalla negra: {assignment.blackout === 'on' ? 'activar' : assignment.blackout === 'off' ? 'retirar' : 'mantener'} · Cortes promocionales: {assignment.promotions === 'suspend' ? 'suspender' : 'mantener'}</p>
          </article>)}</div></>}
        </details>)}</div>
      </section>}
      <div className="playlist-dialog-footer"><button disabled={!!busy} onClick={onClose}>Volver</button>{preview && <button className="workspace-primary" disabled={!!busy} onClick={() => void confirm()}>{busy === 'import' ? 'Importando…' : preview.alreadyImported ? 'Ver programación importada' : 'Importar programación'}</button>}</div>
    </div>
  </Dialog>
}
