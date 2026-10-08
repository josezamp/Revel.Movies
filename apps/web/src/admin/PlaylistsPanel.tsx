import { useEffect, useRef, useState, type FormEvent } from 'react'
import { deletePlaylist, playPlaylist, replacePlaylistItems, sendCommand, sendGroupCommand, updatePlaylist,
  type Display, type DisplayGroup, type MediaAsset, type Playlist, type PlaylistItem } from '../api/client'
import { VideoThumbnail } from './VideoThumbnail'
import { Dialog } from './Dialog'

export function PlaylistsPanel({ eventId, playlists, media, displays, groups, activeId, onActiveId, loading, loadError, onRefresh, onCreate, onAddContent, feedback }: {
  eventId: string; playlists: Playlist[]; media: MediaAsset[]; displays: Display[]; groups: DisplayGroup[]; activeId: string
  onActiveId: (id: string) => void; loading: boolean; loadError: string; onRefresh: () => Promise<void>
  onCreate: () => void; onAddContent: (playlistId: string) => void; feedback: string
}) {
  const active = playlists.find(item => item.id === activeId) ?? playlists[0]
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [rename, setRename] = useState<Playlist>()
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<Playlist>()
  const sending = useRef(false)
  useEffect(() => { setNotice(''); setError('') }, [feedback])
  const targets = [...displays.map(item => ({ value: `display:${item.id}`, label: item.name })),
    ...groups.filter(item => item.displayIds.length > 0).map(item => ({ value: `group:${item.id}`, label: `Grupo: ${item.name}` }))]
  const targetKey = targets.map(item => item.value).join(',')
  useEffect(() => { setTarget(current => targets.some(item => item.value === current) ? current : targets[0]?.value ?? '') }, [targetKey])

  async function run(action: () => Promise<unknown>, message: string, refresh = true) {
    if (sending.current) return
    sending.current = true; setBusy(true); setError(''); setNotice('')
    try { await action(); if (refresh) await onRefresh(); setNotice(message) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el cambio. Volvé a intentar.') }
    finally { sending.current = false; setBusy(false) }
  }

  function saveItems(items: PlaylistItem[], message: string) {
    if (!active) return
    return run(() => replacePlaylistItems(active.id, items.map(item => ({ mediaAssetId: item.mediaAssetId, durationSeconds: item.durationSeconds }))), message)
  }

  function move(index: number, direction: -1 | 1) {
    if (!active || index + direction < 0 || index + direction >= active.items.length) return
    const items = [...active.items]
    ;[items[index], items[index + direction]] = [items[index + direction], items[index]]
    void saveItems(items, 'Orden guardado.')
  }

  function control(command: string) {
    const [kind, id] = target.split(':')
    if (!id) return
    void run(() => kind === 'display' ? sendCommand(id, command) : sendGroupCommand(id, command), 'Comando enviado.', false)
  }

  return (
    <section className="playlists-section" aria-labelledby="playlists-heading">
      <div className="workspace-heading"><div><h2 id="playlists-heading">Playlists</h2><p>Armá el orden del evento, ajustá los tiempos y elegí dónde reproducir.</p></div>
        <button type="button" className="workspace-primary" disabled={!eventId || busy || loading || !!loadError} onClick={onCreate}>+ Nueva playlist</button>
      </div>
      {loading && <p className="workspace-help" role="status">Cargando playlists…</p>}
      {loadError && <div className="workspace-error" role="alert">{loadError} <button onClick={() => void onRefresh()}>Reintentar</button></div>}
      {(notice || feedback) && <p className="workspace-feedback" role="status">{notice || feedback}</p>}
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {!loading && !loadError && !playlists.length && <div className="workspace-empty playlist-empty"><span aria-hidden="true">☷</span><strong>Dale una secuencia a tu evento</strong><p>Seleccioná videos e imágenes en Media Library o creá tu primera playlist.</p><button disabled={!eventId} onClick={onCreate}>Crear primera playlist</button></div>}
      {active && <div className="playlist-workbench">
        <nav className="playlist-browser" aria-label="Tus playlists"><div className="playlist-browser-heading">Tus playlists <span>{playlists.length}</span></div>
          {playlists.map(item => <button type="button" key={item.id} disabled={busy} aria-current={active.id === item.id ? 'true' : undefined}
            onClick={() => { onActiveId(item.id); setNotice(''); setError('') }}>
            <strong>{item.name}</strong><span>{item.items.length} {item.items.length === 1 ? 'archivo' : 'archivos'}{item.isLoop ? ' · En bucle' : ''}</span>
          </button>)}
        </nav>
        <div className="playlist-editor" aria-label={`Editar ${active.name}`}>
          <div className="playlist-editor-heading"><div><h3>{active.name}</h3><p>{active.items.length} archivos en orden de reproducción</p></div>
            <div className="button-row"><button className="quiet-button" disabled={busy} onClick={() => { setRename(active); setName(active.name); setError('') }}>Renombrar</button>
              <button className="quiet-button" disabled={busy} onClick={() => { setRemoving(active); setError('') }}>Eliminar</button></div>
          </div>
          <div className="playlist-editor-settings"><label className="workspace-check"><input type="checkbox" checked={active.isLoop} disabled={busy}
            onChange={event => void run(() => updatePlaylist(active.id, active.name, event.target.checked), 'Repetición guardada.')} /> Repetir en bucle</label>
            <button disabled={busy} onClick={() => onAddContent(active.id)}>+ Agregar contenido</button>
          </div>
          {!active.items.length && <div className="workspace-empty"><p>Esta playlist todavía no tiene contenido.</p><button onClick={() => onAddContent(active.id)}>Seleccionar en Media Library</button></div>}
          <ol className="playlist-sequence">
            {active.items.map((item, index) => {
              const asset = media.find(candidate => candidate.id === item.mediaAssetId)
              return <li key={item.id} className="playlist-sequence-item">
                <span className="sequence-position" aria-label={`Posición ${index + 1}`}>{index + 1}</span>
                <div className="sequence-thumbnail">{asset ? (item.mediaType === 'Image' ? <img src={asset.contentUrl} alt="" loading="lazy" /> : <VideoThumbnail src={asset.contentUrl} />) : <span aria-hidden="true">▧</span>}</div>
                <div className="sequence-title"><strong>{item.mediaName}</strong><small>{item.mediaType === 'Image' ? 'Imagen' : 'Video completo'}</small></div>
                {item.mediaType === 'Image' ? <ImageDuration key={`${item.id}-${item.durationSeconds}`} item={item} busy={busy}
                  onSave={duration => saveItems(active.items.map(candidate => candidate.id === item.id ? { ...candidate, durationSeconds: duration } : candidate), 'Duración guardada.')} /> : <span className="sequence-duration">Hasta el final</span>}
                <div className="sequence-actions">
                  <button type="button" title="Mover hacia arriba" aria-label={`Subir ${item.mediaName}, posición ${index + 1}`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button>
                  <button type="button" title="Mover hacia abajo" aria-label={`Bajar ${item.mediaName}, posición ${index + 1}`} disabled={busy || index === active.items.length - 1} onClick={() => move(index, 1)}>↓</button>
                  <button type="button" title="Quitar de la playlist" aria-label={`Quitar ${item.mediaName}, posición ${index + 1}`} disabled={busy}
                    onClick={() => void saveItems(active.items.filter((_, position) => position !== index), 'Archivo quitado de la playlist.')}>✕</button>
                </div>
              </li>
            })}
          </ol>
          <div className="playlist-playback-strip"><label className="workspace-field">Reproducir en
            <select aria-label="Destino de la playlist" value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
              {!targets.length && <option value="">Sin pantallas o grupos</option>}{targets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select></label>
            <div className="button-row"><button className="workspace-primary" disabled={busy || !target || !active.items.length} onClick={() => {
              const [kind, id] = target.split(':'); void run(() => playPlaylist(active.id, kind as 'display' | 'group', id), `Reproducción enviada a ${targets.find(item => item.value === target)?.label}.`, false)
            }}>▶ Reproducir playlist</button><button disabled={busy || !target} onClick={() => control('playlist.pause')}>Pausar</button><button disabled={busy || !target} onClick={() => control('playlist.stop')}>Detener</button></div>
          </div>
          <p className="playlist-edit-note">Volvé a reproducir la playlist para enviar los cambios a las pantallas.</p>
        </div>
      </div>}
      {rename && <Dialog title="Renombrar playlist" busy={busy} onClose={() => setRename(undefined)}><form onSubmit={(event: FormEvent) => {
        event.preventDefault(); if (!name.trim()) return
        void run(async () => { await updatePlaylist(rename.id, name.trim(), rename.isLoop); setRename(undefined) }, 'Nombre guardado.')
      }}><label className="workspace-field">Nombre de la playlist<input autoFocus required maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        {error && <p role="alert" className="workspace-error">{error}</p>}<div className="playlist-dialog-footer"><button type="button" disabled={busy} onClick={() => setRename(undefined)}>Cancelar</button><button className="workspace-primary" disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Guardar nombre'}</button></div>
      </form></Dialog>}
      {removing && <Dialog title="Eliminar playlist" busy={busy} onClose={() => setRemoving(undefined)}><p>¿Eliminar «{removing.name}»? Sus archivos seguirán en Media Library.</p>
        {error && <p role="alert" className="workspace-error">{error}</p>}<div className="playlist-dialog-footer"><button disabled={busy} onClick={() => setRemoving(undefined)}>Cancelar</button><button className="danger-button" disabled={busy}
          onClick={() => void run(async () => { await deletePlaylist(removing.id); setRemoving(undefined) }, 'Playlist eliminada.')}>{busy ? 'Eliminando…' : 'Eliminar playlist'}</button></div>
      </Dialog>}
    </section>
  )
}

function ImageDuration({ item, busy, onSave }: { item: PlaylistItem; busy: boolean; onSave: (duration: number) => Promise<void> | undefined }) {
  const [value, setValue] = useState(String(item.durationSeconds ?? 10))
  const changed = Number(value) !== (item.durationSeconds ?? 10)
  return <form className="sequence-image-duration" onSubmit={event => { event.preventDefault(); if (changed && Number(value) > 0) void onSave(Number(value)) }}>
    <label><span className="visually-hidden">Duración de {item.mediaName} en segundos</span><input type="number" min="0.5" step="0.5" required disabled={busy} value={value} onChange={event => setValue(event.target.value)} /><span>s</span></label>
    {changed && <button type="submit" disabled={busy}>Guardar</button>}
  </form>
}
