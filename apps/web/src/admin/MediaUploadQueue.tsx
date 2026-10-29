import { useEffect, useRef, useState } from 'react'
import type { MediaAsset } from '../api/client'
import { DuplicateUploadError, uploadMediaWithProgress } from '../api/uploads'
import { Dialog } from './Dialog'

type Upload = {
  id: string; file: File; status: 'queued' | 'uploading' | 'complete' | 'error' | 'cancelled' | 'conflict' | 'skipped'
  loaded: number; total: number | null; asset?: MediaAsset; error?: string; replace?: boolean
}
const nameKey = (name: string) => name.trim().toUpperCase()
const pending = (item: Upload) => ['queued', 'uploading', 'conflict'].includes(item.status)
const concurrency = 3

function validate(file: File) {
  if (!/\.(mp4|jpe?g|png|webp|gif)$/i.test(file.name)) return 'Formato no compatible. Usá MP4, JPG, PNG, WEBP o GIF.'
  if (!file.size) return 'El archivo está vacío.'
  if (file.size > 1024 ** 3) return 'Supera el límite de 1 GB.'
}

export function MediaUploadQueue({ eventId, media, onMediaChanged, onAddUploaded, playlistsLoading, onPreview }: {
  eventId: string; media: MediaAsset[]; onMediaChanged: () => Promise<void>; onAddUploaded: (assets: MediaAsset[]) => void
  playlistsLoading: boolean; onPreview: (file: File) => void
}) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [automatic, setAutomatic] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [applyAll, setApplyAll] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const queue = useRef<Upload[]>([])
  const sequence = useRef(0)
  const active = useRef(new Map<string, AbortController>())
  const known = useRef(new Map<string, MediaAsset>())
  const unrefreshed = useRef(new Map<string, MediaAsset>())
  const mounted = useRef(true)
  const dirty = useRef(false)
  const refresh = useRef(onMediaChanged)
  refresh.current = onMediaChanged
  useEffect(() => {
    known.current = new Map(media.map(item => [nameKey(item.fileName), item]))
    for (const [key, asset] of unrefreshed.current) {
      const refreshed = known.current.get(key)
      if (refreshed?.id === asset.id && refreshed.checksum === asset.checksum) unrefreshed.current.delete(key)
      else known.current.set(key, asset)
    }
  }, [media])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; for (const controller of active.current.values()) controller.abort() }
  }, [])

  function publish(items: Upload[]) { queue.current = items; if (mounted.current) setUploads(items) }
  function update(id: string, patch: Partial<Upload>) { publish(queue.current.map(item => item.id === id ? { ...item, ...patch } : item)) }

  function enqueue(files: File[]) {
    if (!eventId) return
    const names = new Set([...known.current.keys(), ...queue.current.filter(pending).map(item => nameKey(item.file.name))])
    let conflicts = false
    const items = files.map(file => {
      const error = validate(file)
      const duplicate = !error && names.has(nameKey(file.name))
      if (!error) names.add(nameKey(file.name))
      conflicts ||= duplicate
      // These IDs only identify rows in this mounted queue; they need no secure-context API.
      return { id: `upload-${++sequence.current}`, file, loaded: 0, total: null, error,
        status: error ? 'error' : duplicate ? 'conflict' : 'queued' } as Upload
    })
    publish([...queue.current, ...items])
    if (conflicts) { setApplyAll(false); setReviewing(true) }
  }

  async function transfer(item: Upload, controller: AbortController, replaceMediaId?: string) {
    try {
      const asset = await uploadMediaWithProgress(eventId, item.file, controller.signal,
        (loaded, total) => update(item.id, { loaded, total }), replaceMediaId)
      known.current.set(nameKey(asset.fileName), asset)
      unrefreshed.current.set(nameKey(asset.fileName), asset)
      dirty.current = true
      update(item.id, { status: 'complete', asset, loaded: item.file.size, total: item.file.size })
    } catch (cause) {
      if (cause instanceof DuplicateUploadError) {
        known.current.set(nameKey(cause.existing.fileName), cause.existing)
        unrefreshed.current.set(nameKey(cause.existing.fileName), cause.existing)
        update(item.id, { status: 'conflict', replace: false, loaded: 0, total: null })
        if (mounted.current) { setApplyAll(false); setReviewing(true) }
      } else {
        update(item.id, { status: controller.signal.aborted ? 'cancelled' : 'error',
          error: controller.signal.aborted ? undefined : cause instanceof Error ? cause.message : 'Falló la subida.' })
      }
    } finally {
      active.current.delete(item.id)
      // Publish after releasing the slot so the scheduler can start the next file.
      publish([...queue.current])
    }
  }

  useEffect(() => {
    if (automatic) {
      for (let index = 0; index < queue.current.length && active.current.size < concurrency; index++) {
        const item = queue.current[index]
        if (item.status !== 'queued' || active.current.has(item.id)) continue
        const key = nameKey(item.file.name)
        // A later file with the same name must wait for the earlier decision/transfer.
        if (queue.current.slice(0, index).some(prior => nameKey(prior.file.name) === key && pending(prior))) continue
        const existing = known.current.get(key)
        if (existing && !item.replace) {
          update(item.id, { status: 'conflict' }); setReviewing(true); continue
        }
        const controller = new AbortController()
        active.current.set(item.id, controller)
        update(item.id, { status: 'uploading', error: undefined, loaded: 0, total: null })
        void transfer(item, controller, item.replace ? existing?.id : undefined)
      }
    }
    if (!active.current.size) {
      if (dirty.current) {
        dirty.current = false
        void refresh.current().catch(() => { if (mounted.current) setRefreshError('Los archivos se subieron, pero no se pudo actualizar la biblioteca.') })
      }
      if (!queue.current.some(pending)) setAutomatic(false)
    }
  }, [uploads, automatic])

  function cancel(id?: string) {
    if (!id) setAutomatic(false)
    for (const [key, controller] of active.current) if (!id || key === id) controller.abort()
    publish(queue.current.map(item => (!id || item.id === id) && pending(item) && !active.current.has(item.id) ? { ...item, status: 'cancelled' } : item))
  }
  function retry(id?: string) {
    publish(queue.current.map(item => (!id || item.id === id) && !active.current.has(item.id) && ['error', 'cancelled'].includes(item.status) && !validate(item.file)
      ? { ...item, status: 'queued', error: undefined, loaded: 0, total: null } : item))
    setAutomatic(true)
  }
  const conflicts = uploads.filter(item => item.status === 'conflict')
  const conflict = conflicts[0]
  function decide(replace: boolean) {
    publish(queue.current.map(item => item.status === 'conflict' && (applyAll || item.id === conflict?.id)
      ? { ...item, status: replace ? 'queued' : 'skipped', replace } : item))
    if (applyAll || conflicts.length === 1) setReviewing(false)
  }
  const completed = uploads.filter(item => item.status === 'complete')
  const uploaded = [...new Map(completed.flatMap(item => item.asset ? [[item.asset.id, item.asset] as const] : [])).values()]
  const pendingCount = uploads.filter(pending).length
  const skipped = uploads.filter(item => item.status === 'skipped').length
  const failed = uploads.filter(item => item.status === 'error').length
  const settled = uploads.length - pendingCount
  const progress = uploads.length ? uploads.reduce((sum, item) => sum + (!pending(item) ? 1 : item.total ? Math.min(.99, item.loaded / item.total) : 0), 0) / uploads.length : 0
  const retryable = uploads.some(item => ['error', 'cancelled'].includes(item.status) && !validate(item.file))

  return <>
    <div className={`upload-dropzone${dragging ? ' is-dragging' : ''}`}
      onDragOver={event => { event.preventDefault(); setDragging(true) }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={event => { event.preventDefault(); setDragging(false); enqueue(Array.from(event.dataTransfer.files)) }}>
      <div className="upload-dropzone-copy"><span className="upload-eyebrow">ARCHIVOS DEL EVENTO</span><strong>Arrastrá tus archivos acá</strong>
        <p>Podés cargar más de 50 archivos en una sola tanda. Revisá la cola y comenzá cuando quieras.</p></div>
      <label className="upload-picker">Elegir archivos<input className="visually-hidden" type="file" multiple aria-label="Agregar archivos a la cola"
        accept=".mp4,.jpg,.jpeg,.png,.webp,.gif" disabled={!eventId} onChange={event => { enqueue(Array.from(event.target.files ?? [])); event.target.value = '' }} /></label>
      <small>MP4, JPG, PNG, WEBP o GIF · Hasta 1 GB por archivo · Se conserva el orden de selección</small>
    </div>
    {uploads.length > 0 && <div className="upload-queue">
      <div className="workspace-heading"><div><strong role="status">{completed.length} de {uploads.length} archivos subidos</strong>
        <p>{settled} procesados · {pendingCount} pendientes{skipped > 0 ? ` · ${skipped} omitidos` : ''}{failed > 0 ? ` · ${failed} con error` : ''}</p></div>
        <button className="workspace-primary" disabled={!uploads.some(item => item.status === 'queued') || automatic} onClick={() => setAutomatic(true)}>Subir archivos pendientes</button></div>
      <progress className="upload-overall-progress" aria-label="Progreso general de la cola" max={1} value={progress} />
      <div className="upload-toolbar">
        {pendingCount > 0 && <button onClick={() => cancel()}>Cancelar pendientes</button>}
        {retryable && <button onClick={() => retry()}>Reintentar fallidos y cancelados</button>}
        <button disabled={!uploaded.length || pendingCount > 0 || playlistsLoading} onClick={() => onAddUploaded(uploaded)}>Agregar subidos a una playlist</button>
        <button className="quiet-button" disabled={!settled || active.current.size > 0} onClick={() => publish(queue.current.filter(pending))}>Limpiar terminados</button>
      </div>
      {conflicts.length > 0 && <div className="upload-conflict-banner"><span>{conflicts.length} duplicados esperan tu decisión.</span><button onClick={() => setReviewing(true)}>Revisar duplicados</button></div>}
      <ol aria-label="Cola de archivos">{uploads.map((item, index) => <li key={item.id} data-status={item.status}>
        <div className="upload-file"><strong>{item.file.name}</strong><small>{formatBytes(item.file.size)} · {uploadLabel(item)}</small>
          {item.status === 'uploading' && <progress aria-label={`Subida de ${item.file.name}`} value={item.total ? item.loaded : undefined} max={item.total ?? 1} />}
          {item.error && <span className="workspace-error">{item.error}</span>}</div>
        <div className="button-row"><button onClick={() => onPreview(item.file)}>Vista previa</button>
          {pending(item) && <button onClick={() => cancel(item.id)}>Cancelar</button>}
          {['error', 'cancelled'].includes(item.status) && <button disabled={!!validate(item.file)} onClick={() => retry(item.id)}>Reintentar</button>}
          {item.status === 'queued' && !automatic && <button aria-label={`Subir ${item.file.name} en el orden`}
            disabled={index === 0 || nameKey(uploads[index - 1].file.name) === nameKey(item.file.name)} onClick={() => {
              const reordered = [...queue.current]
              ;[reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]]
              publish(reordered)
            }}>↑</button>}
        </div>
      </li>)}</ol>
      <small>Hasta 3 subidas simultáneas. Mantené esta página abierta. Cancelar detiene la transferencia local; un archivo ya recibido puede aparecer en la biblioteca.</small>
    </div>}
    {refreshError && <p className="workspace-error" role="alert">{refreshError}<button onClick={() => { setRefreshError(''); void refresh.current() }}>Actualizar biblioteca</button></p>}
    {reviewing && conflict && <Dialog title="Archivo duplicado" onClose={() => setReviewing(false)}>
      <p>Ya existe <strong className="upload-conflict-name">{conflict.file.name}</strong> en la biblioteca de este evento o en la cola.</p>
      <p className="workspace-help">Se compara el nombre completo, sin distinguir mayúsculas. Reemplazar actualiza el archivo y conserva sus referencias en playlists y escenas. Omitir conserva el existente.</p>
      <label className="workspace-check"><input type="checkbox" checked={applyAll} onChange={event => setApplyAll(event.target.checked)} />Aplicar a todos los duplicados pendientes ({conflicts.length})</label>
      <div className="playlist-dialog-footer"><button onClick={() => decide(false)}>{applyAll ? 'Omitir todos' : 'Omitir'}</button>
        <button className="workspace-primary" onClick={() => decide(true)}>{applyAll ? 'Reemplazar todos' : 'Reemplazar'}</button></div>
    </Dialog>}
  </>
}

function uploadLabel(item: Upload) {
  if (item.status === 'uploading') return item.total && item.loaded >= item.total ? 'Archivo enviado; procesando en el servidor…' : `Subiendo ${formatBytes(item.loaded)}${item.total ? ` de ${formatBytes(item.total)}` : ''}`
  return { queued: item.replace ? 'Pendiente · reemplazará el existente' : 'Pendiente', complete: item.replace ? 'Reemplazado' : 'Subido', error: 'Falló', cancelled: 'Cancelado', conflict: 'Duplicado · elegí reemplazar u omitir', skipped: 'Omitido' }[item.status]
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}
