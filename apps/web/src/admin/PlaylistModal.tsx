import { useRef, useState, type FormEvent } from 'react'
import { appendPlaylistItems, createPlaylist, type MediaAsset, type Playlist } from '../api/client'
import { Dialog } from './Dialog'

export function PlaylistModal({ eventId, playlists, media, preferredPlaylistId, createOnly, onSaved, onClose }: {
  eventId: string; playlists: Playlist[]; media: MediaAsset[]; preferredPlaylistId?: string; createOnly: boolean
  onSaved: (playlist: Playlist) => void; onClose: () => void
}) {
  const [mode, setMode] = useState<'existing' | 'new'>(createOnly || !playlists.length ? 'new' : 'existing')
  const [playlistId, setPlaylistId] = useState(preferredPlaylistId ?? playlists[0]?.id ?? '')
  const [name, setName] = useState('')
  const [loop, setLoop] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const destination = playlists.find(item => item.id === playlistId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current) return
    if (mode === 'new' && !name.trim()) { setError('Escribí un nombre para la playlist.'); return }
    if (mode === 'existing' && !destination) { setError('Elegí una playlist.'); return }
    sending.current = true
    setBusy(true)
    setError('')
    try {
      const items = media.map(item => ({ mediaAssetId: item.id, durationSeconds: item.type === 'Image' ? 10 : null }))
      const saved = mode === 'new'
        ? await createPlaylist(eventId, name.trim(), loop, items)
        : await appendPlaylistItems(playlistId, items)
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la playlist. Volvé a intentar.')
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog title={createOnly ? 'Crear playlist' : 'Agregar a una playlist'} busy={busy} onClose={onClose}>
      <form onSubmit={event => void submit(event)}>
        <fieldset disabled={busy} className="playlist-dialog-fields">
          {!createOnly && <div className="playlist-destination" role="group" aria-label="Destino del contenido">
            <button type="button" aria-pressed={mode === 'existing'} disabled={!playlists.length} onClick={() => setMode('existing')}>Playlist existente</button>
            <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>Crear nueva</button>
          </div>}
          {mode === 'existing' ? <label className="workspace-field">
            Playlist de destino
            <select autoFocus value={playlistId} onChange={event => setPlaylistId(event.target.value)} required>
              {playlists.map(item => <option key={item.id} value={item.id}>{item.name} ({item.items.length} archivos)</option>)}
            </select>
            <small>Los archivos se agregan al final, en el orden de selección.</small>
          </label> : <>
            <label className="workspace-field">
              Nombre de la playlist
              <input autoFocus required maxLength={200} value={name} placeholder="Ej. Bienvenida y sponsors" onChange={event => setName(event.target.value)} />
            </label>
            <label className="workspace-check"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} /> Repetir la playlist en bucle</label>
          </>}
          {media.length > 0 ? <div className="playlist-selection-summary">
            <strong>{media.length} {media.length === 1 ? 'archivo seleccionado' : 'archivos seleccionados'}</strong>
            <ol>{media.map(item => <li key={item.id}><span>{item.name}</span><small>{item.type === 'Image' ? 'Imagen · 10 s' : 'Video completo'}</small></li>)}</ol>
            {media.some(item => item.type === 'Image') && <p>Podés ajustar la duración de las imágenes en la playlist.</p>}
          </div> : <p className="workspace-help">Después de crearla, elegí sus archivos desde Media Library.</p>}
        </fieldset>
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <div className="playlist-dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="workspace-primary" type="submit" disabled={busy || (mode === 'existing' && !destination)}>
            {busy ? 'Guardando…' : mode === 'new' ? (media.length ? 'Crear y agregar archivos' : 'Crear playlist') : `Agregar ${media.length} ${media.length === 1 ? 'archivo' : 'archivos'}`}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
