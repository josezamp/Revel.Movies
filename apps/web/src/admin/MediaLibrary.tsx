import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { deleteMedia, sendCommand, uploadMedia, type Display, type MediaAsset } from '../api/client'
import { VideoThumbnail } from './VideoThumbnail'

export function MediaLibrary({ libraryRef, eventId, media, displays, onMediaChanged, selecting, selectedIds, onSelectedIds,
  onStartSelection, onCancelSelection, onAdd, feedback, playlistsLoading }: {
  libraryRef: RefObject<HTMLElement | null>; eventId: string; media: MediaAsset[]; displays: Display[]; onMediaChanged: () => Promise<void>
  selecting: boolean; selectedIds: string[]; onSelectedIds: Dispatch<SetStateAction<string[]>>
  onStartSelection: () => void; onCancelSelection: () => void; onAdd: () => void; feedback: string; playlistsLoading: boolean
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [target, setTarget] = useState('')
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const sending = useRef(false)
  useEffect(() => { setNotice(''); setError('') }, [feedback])
  const visible = media.filter(item => (filter === 'all' || item.type === filter) && `${item.name} ${item.fileName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()))
  const selected = selectedIds.filter(id => media.some(item => item.id === id))
  const allVisibleSelected = visible.length > 0 && visible.every(item => selected.includes(item.id))

  useEffect(() => { setTarget(current => displays.some(item => item.id === current) ? current : displays[0]?.id ?? '') }, [displays])

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

  return (
    <section id="media-library" className="library-section" ref={libraryRef} tabIndex={-1} aria-labelledby="library-heading">
      <div className="workspace-heading">
        <div><h2 id="library-heading">Media Library</h2><p>Elegí tus archivos y armá la secuencia de cada pantalla.</p></div>
        <button type="button" disabled={!media.length && !selecting} aria-pressed={selecting}
          onClick={selecting ? onCancelSelection : onStartSelection}>{selecting ? 'Cancelar selección' : 'Seleccionar'}</button>
      </div>
      <div className="library-upload">
        <label className="workspace-field">Subir contenido
          <input ref={fileInput} type="file" accept="video/mp4,image/jpeg,image/png,image/webp,image/gif" disabled={!eventId || busy}
            onChange={event => setFile(event.target.files?.[0])} />
        </label>
        <button disabled={!file || !eventId || busy} onClick={() => void run(async () => {
          await uploadMedia(eventId, file!); setFile(undefined); if (fileInput.current) fileInput.current.value = ''; await onMediaChanged()
        }, 'Archivo subido a Media Library.')}>{busy ? 'Procesando…' : 'Subir archivo'}</button>
        <small>MP4, JPG, PNG, WEBP o GIF. Hasta 1 GB por archivo.</small>
      </div>
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
        <label className="workspace-field">Reproducir un archivo en
          <select value={target} onChange={event => setTarget(event.target.value)}>{!displays.length && <option value="">Sin pantallas</option>}
            {displays.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <button disabled={!target || busy} onClick={() => void run(() => sendCommand(target, 'media.pause'), 'Pausa enviada.')}>Pausar</button>
        <button disabled={!target || busy} onClick={() => void run(() => sendCommand(target, 'media.stop'), 'Detener enviado.')}>Detener</button>
      </div>}
      {(feedback || notice) && <p className="workspace-feedback" role="status">{notice || feedback}</p>}
      {error && <p className="workspace-error" role="alert">{error}</p>}
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
          <div className="library-card-info"><small>{item.type === 'Image' ? 'Imagen' : 'Video'} · {formatBytes(item.fileSize)}</small><strong title={item.name}>{item.name}</strong><span title={item.fileName}>{item.fileName}</span></div>
          {selecting ? <button type="button" className="library-select-text" aria-pressed={selected.includes(item.id)} onClick={() => toggle(item.id)}>{selected.includes(item.id) ? 'Quitar de la selección' : 'Seleccionar archivo'}</button> : <div className="button-row">
            <button disabled={!target || busy} onClick={() => void run(() => sendCommand(target, 'media.play', { mediaId: item.id }), `Reproducción enviada a ${displays.find(display => display.id === target)?.name}.`)}>▶ Reproducir</button>
            <button className="quiet-button" disabled={busy} onClick={() => {
              if (window.confirm(`¿Eliminar «${item.name}» de la biblioteca?`)) void run(async () => { await deleteMedia(item.id); await onMediaChanged() }, 'Archivo eliminado.')
            }}>Eliminar</button>
          </div>}
        </article>)}
      </div>
    </section>
  )
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
