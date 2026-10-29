import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { deleteMedia, sendCommand, sendGroupCommand, type Display, type DisplayGroup, type MediaAsset } from '../api/client'
import { MediaUploadQueue } from './MediaUploadQueue'
import { useTvOptimization } from './useTvOptimization'
import { TvOptimizationControl } from './TvOptimizationControl'
import { VideoThumbnail } from './VideoThumbnail'
import { Dialog } from './Dialog'
import './content.css'

type Preview = { name: string; type: 'Video' | 'Image'; url?: string; file?: File }

export function MediaLibrary({ libraryRef, eventId, media, displays, groups, onMediaChanged, selecting, selectedIds, onSelectedIds,
  onStartSelection, onCancelSelection, onAdd, onAddUploaded, feedback, playlistsLoading }: {
  libraryRef: RefObject<HTMLElement | null>; eventId: string; media: MediaAsset[]; displays: Display[]; groups: DisplayGroup[]; onMediaChanged: () => Promise<void>
  selecting: boolean; selectedIds: string[]; onSelectedIds: Dispatch<SetStateAction<string[]>>
  onStartSelection: () => void; onCancelSelection: () => void; onAdd: () => void; onAddUploaded: (assets: MediaAsset[]) => void; feedback: string; playlistsLoading: boolean
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<Preview>()
  const [removing, setRemoving] = useState<MediaAsset>()
  const sending = useRef(false)
  const tv = useTvOptimization(eventId, media, onMediaChanged)
  const optimizationByMedia = new Map(tv.jobs.map(job => [job.mediaId, job]))
  const originalByCopy = new Map(tv.jobs.filter(job => job.resultMediaId).map(job => [job.resultMediaId,
    media.find(item => item.id === job.mediaId && item.checksum === job.sourceChecksum)]))
  const mediaById = new Map(media.map(item => [item.id, item]))
  const previewAsset = (item: MediaAsset) => setPreview({ name: item.name, type: item.type === 'Image' ? 'Image' as const : 'Video' as const, url: item.contentUrl })
  const targets = [...displays.map(item => ({ value: `display:${item.id}`, id: item.id, name: item.name, ids: [item.id], kind: 'display' })),
    ...groups.map(item => ({ value: `group:${item.id}`, id: item.id, name: `${item.name} · ${item.displayIds.length} pantallas`, ids: item.displayIds, kind: 'group' }))]
  const target = targets.find(item => item.value === targetId)
  const canOperate = !!target?.ids.length
  useEffect(() => { setNotice(''); setError('') }, [feedback])
  useEffect(() => { if (targetId && !target) setTargetId('') }, [targetId, target])
  const visible = media.filter(item => (filter === 'all' || item.type === filter) && `${item.name} ${item.fileName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()))
  const selected = selectedIds.filter(id => media.some(item => item.id === id))
  const allVisibleSelected = visible.length > 0 && visible.every(item => selected.includes(item.id))
  async function run(action: () => Promise<unknown>, message: string) {
    if (sending.current) return
    sending.current = true; setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(message) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción.') }
    finally { sending.current = false; setBusy(false) }
  }

  function toggle(id: string) {
    onSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  function sendToTarget(type: string, payload?: unknown) {
    if (!target?.ids.length) return Promise.reject(new Error('Elegí un destino con pantallas.'))
    return target.kind === 'group' ? sendGroupCommand(target.id, type, payload) : sendCommand(target.id, type, payload)
  }

  return (
    <section id="media-library" className="library-section" ref={libraryRef} tabIndex={-1} aria-labelledby="library-heading">
      <div className="workspace-heading">
        <div><h2 id="library-heading">Biblioteca</h2><p>Prepará tus archivos y elegí dónde enviarlos. La vista previa se abre solo en este dispositivo.</p></div>
        <button type="button" disabled={!media.length && !selecting} aria-pressed={selecting}
          onClick={selecting ? onCancelSelection : onStartSelection}>{selecting ? 'Volver al editor' : 'Seleccionar'}</button>
      </div>
      <MediaUploadQueue eventId={eventId} media={media} onMediaChanged={onMediaChanged} onAddUploaded={onAddUploaded}
        playlistsLoading={playlistsLoading} onPreview={file => setPreview({ name: file.name, file, type: /\.(jpe?g|png|webp|gif)$/i.test(file.name) ? 'Image' : 'Video' })} />
      <div className="library-tools">
        <label className="workspace-field library-search"><span className="visually-hidden">Buscar archivos</span>
          <input type="search" placeholder="Buscar por nombre…" aria-label="Buscar archivos" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <label className="workspace-field"><span className="visually-hidden">Tipo de archivo</span><select aria-label="Tipo de archivo" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">Todos los archivos</option><option value="Video">Videos</option><option value="Image">Imágenes</option>
        </select></label>
        <span className="workspace-help">{visible.length} de {media.length} archivos</span>
      </div>
      {selecting ? <div className="library-selection-bar">
        <div><strong role="status">{selected.length} {selected.length === 1 ? 'seleccionado' : 'seleccionados'}</strong><small>Se agregarán en el orden que los elijas.</small></div>
        <button type="button" className="quiet-button" disabled={!visible.length} onClick={() => onSelectedIds(current => allVisibleSelected
          ? current.filter(id => !visible.some(item => item.id === id)) : [...current, ...visible.filter(item => !current.includes(item.id)).map(item => item.id)])}>
          {allVisibleSelected ? 'Quitar visibles' : 'Seleccionar visibles'}
        </button>
        <button type="button" className="workspace-primary" disabled={!selected.length || playlistsLoading} onClick={onAdd}>Agregar a playlist</button>
      </div> : <div className="library-play-target">
        <label className="workspace-field">Destino de reproducción
          <select value={target?.value ?? ''} onChange={event => setTargetId(event.target.value)}><option value="">Elegí una pantalla o un grupo</option>
            {targets.map(item => <option key={item.value} value={item.value}>{item.name}</option>)}
          </select>
        </label>
        <button disabled={!canOperate || busy} onClick={() => void run(() => sendToTarget('media.pause'), `Pausa enviada a ${target!.name}. Esperando confirmación.`)}>Pausar</button>
        <button disabled={!canOperate || busy} onClick={() => void run(() => sendToTarget('media.stop'), `Detención enviada a ${target!.name}. Esperando confirmación.`)}>Detener contenido</button>
        {target && <p className="content-target-names">Destino: {displays.filter(display => target.ids.includes(display.id)).map(display => display.name).join(', ') || 'Grupo sin integrantes'}</p>}
      </div>}
      {(feedback || notice) && <p className="workspace-feedback" role="status">{notice || feedback}</p>}
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {tv.error && <p className="workspace-error" role="alert">{tv.error}</p>}
      {tv.available === false && media.some(item => item.type === 'Video') && <p className="workspace-help">Reducir tamaño para TV requiere habilitar FFmpeg en el servidor.</p>}
      {!media.length && <div className="workspace-empty"><strong>Tu biblioteca empieza acá</strong><p>Subí un video o una imagen para reproducirlo o agregarlo a una playlist.</p></div>}
      {media.length > 0 && !visible.length && <div className="workspace-empty"><p>No hay archivos que coincidan con la búsqueda.</p><button onClick={() => { setSearch(''); setFilter('all') }}>Limpiar filtros</button></div>}
      <div className="media-grid library-grid">
        {visible.map(item => <article className={`card media-card library-card${selecting && selected.includes(item.id) ? ' is-selected' : ''}`} key={item.id}>
          <div className="library-preview">
            {item.type === 'Image' ? <img className="media-preview" src={item.contentUrl} alt="" loading="lazy" /> : <VideoThumbnail src={item.contentUrl} />}
            {selecting && <button type="button" className="library-select-overlay" aria-label={`Seleccionar ${item.name}`} aria-pressed={selected.includes(item.id)} onClick={() => toggle(item.id)}>
              <span>{selected.includes(item.id) ? selected.indexOf(item.id) + 1 : '+'}</span>
            </button>}
          </div>
          <div className="library-card-info"><small>Miniatura · {item.type === 'Image' ? 'Imagen' : 'Video'} · {formatBytes(item.fileSize)}</small><strong title={item.name}>{item.name}</strong><span title={item.fileName}>{item.fileName}</span></div>
          <button className="quiet-button" onClick={() => setPreview({ name: item.name, type: item.type === 'Image' ? 'Image' : 'Video', url: item.contentUrl })}>Vista previa local</button>
          <TvOptimizationControl item={item} job={optimizationByMedia.get(item.id)} origin={originalByCopy.get(item.id)}
            result={mediaById.get(optimizationByMedia.get(item.id)?.resultMediaId ?? '')} available={tv.available}
            requesting={tv.requesting} onStart={tv.start} onPreview={previewAsset} />
          {selecting ? <button type="button" className="library-select-text" aria-pressed={selected.includes(item.id)} onClick={() => toggle(item.id)}>{selected.includes(item.id) ? 'Quitar de la selección' : 'Seleccionar archivo'}</button> : <div className="button-row">
            <button disabled={!canOperate || busy} onClick={() => void run(() => sendToTarget('media.play', { mediaId: item.id }), `Reproducción enviada a ${target!.name}. Consultá la confirmación en En vivo.`)}>Reproducir{target ? ` en ${target.name}` : ' · elegí destino'}</button>
            <button className="quiet-button" disabled={busy} onClick={() => { setRemoving(item); setError('') }}>Eliminar</button>
          </div>}
        </article>)}
      </div>
      {preview && <MediaPreview preview={preview} onClose={() => setPreview(undefined)} />}
      {removing && <Dialog title="Eliminar archivo" busy={busy} onClose={() => setRemoving(undefined)}><p>¿Eliminar «{removing.name}» de la biblioteca? Las playlists que lo usen pueden verse afectadas.</p>
        {error && <p role="alert" className="workspace-error">{error}</p>}<div className="playlist-dialog-footer"><button disabled={busy} onClick={() => setRemoving(undefined)}>Cancelar</button>
          <button disabled={busy} className="danger-button" onClick={() => void run(async () => { await deleteMedia(removing.id); setRemoving(undefined); await onMediaChanged() }, 'Archivo eliminado.')}>{busy ? 'Eliminando…' : 'Eliminar archivo'}</button></div>
      </Dialog>}
    </section>
  )
}

function MediaPreview({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  const [url, setUrl] = useState(preview.url ?? '')
  useEffect(() => {
    if (!preview.file) { setUrl(preview.url ?? ''); return }
    const local = URL.createObjectURL(preview.file); setUrl(local)
    return () => URL.revokeObjectURL(local)
  }, [preview])
  return <Dialog title={`Vista previa · ${preview.name}`} onClose={onClose}>
    <p className="workspace-help">Solo en este dispositivo. No modifica ninguna pantalla.</p>
    <div className="local-media-preview">{url && (preview.type === 'Image' ? <img src={url} alt={preview.name} /> : <video src={url} controls playsInline preload="metadata" />)}</div>
  </Dialog>
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}
