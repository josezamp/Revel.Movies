import { useRef, useState } from 'react'
import { playPlaylist, sendCommand, type Display, type MediaAsset, type Playlist } from '../api/client'
import { displayPresence } from './displayPresence'
import { playbackConfirmed } from './liveState'
import { playbackCommandId } from './contentOperations'
import { DisplayMediaPicker, type DisplayContentSelection } from './DisplayMediaPicker'

type Props = { display: Display; media: MediaAsset[]; playlists: Playlist[]; onChanged: () => Promise<void> }

export function DisplayPlaybackControls({ display, media, playlists, onChanged }: Props) {
  const [selection, setSelection] = useState<DisplayContentSelection | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [commandId, setCommandId] = useState<string>()
  const [sentAt, setSentAt] = useState<number>()
  const previousCommandId = useRef<string | null | undefined>(undefined)
  const sending = useRef(false)
  const connected = displayPresence(display.status).connected
  const assigned: DisplayContentSelection | null = display.playbackContentType === 'Playlist' && display.playbackPlaylistId
    ? { kind: 'playlist', id: display.playbackPlaylistId }
    : display.playbackMediaId ? { kind: 'media', id: display.playbackMediaId } : null
  const hasContent = Boolean(display.playbackMediaId || display.playbackPlaylistId)
  const selected = selection?.kind === 'playlist'
    ? playlists.find(item => item.id === selection.id && item.items.length > 0)
    : media.find(item => item.id === selection?.id)
  const validSelection = selected ? selection : null
  const playing = display.desiredPlaybackState === 'Playing' && display.actualPlaybackState !== 'Ended'
  const pause = !selected && playing
  const disabled = !connected || busy

  async function command(type: string, payload?: unknown, playlistId?: string) {
    if (sending.current || !connected) return
    sending.current = true
    setBusy(true)
    setError('')
    setFeedback('Enviando…')
    setSentAt(Date.now())
    previousCommandId.current = display.lastCommandId
    setCommandId(undefined)
    try {
      const result = playlistId ? await playPlaylist(playlistId, 'display', display.id) : await sendCommand(display.id, type, payload)
      setCommandId(playbackCommandId(result))
      if (type === 'media.play' || playlistId) setSelection(null)
      setFeedback('Esperando confirmación del reproductor')
      await onChanged()
    } catch (cause) {
      setFeedback('')
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el comando.')
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  let status = feedback || (selected ? `Selección: ${selected.name}. Pulsá Reproducir para enviarla.` : hasContent ? `Destino: ${display.name}` : 'Elegí contenido para comenzar.')
  if (commandId && display.actualCommandId === commandId && playbackConfirmed(display, Date.now()))
    status = display.actualPlaybackState === 'Error' ? 'El reproductor informó un error'
      : ['Buffering', 'Loading'].includes(display.actualPlaybackState ?? '') ? 'Cargando en la TV…' : 'Acción confirmada por el reproductor'
  else if (commandId && display.lastCommandId && display.lastCommandId !== commandId && display.lastCommandId !== previousCommandId.current) status = 'Hay una acción posterior en esta pantalla'
  else if (sentAt && Date.now() - sentAt > 30000) status = 'Sin confirmación reciente. Revisá el estado de la TV.'
  if (!connected) status = 'TV sin conexión. Puede continuar reproduciendo contenido local.'

  return (
    <div className="display-playback" role="group" aria-label={`Multimedia de ${display.name}`} aria-busy={busy}>
      <DisplayMediaPicker displayName={display.name} media={media} playlists={playlists} selected={validSelection} assigned={assigned} disabled={disabled}
        onSelect={next => { setSelection(next); setFeedback(''); setError(''); setCommandId(undefined); setSentAt(undefined) }} />
      <div className="display-transport">
        <button
          type="button"
          className="display-play-button"
          disabled={disabled || (!selected && !hasContent)}
          onClick={() => void command(selected ? 'media.play' : pause ? 'media.pause' : 'playback.resume', selected && selection?.kind === 'media' ? { mediaId: selected.id } : undefined, selected && selection?.kind === 'playlist' ? selected.id : undefined)}
        >
          <span aria-hidden="true">{pause ? 'Ⅱ' : '▶'}</span> {selected ? `Reproducir en ${display.name}` : pause ? 'Pausar' : 'Reanudar'}
        </button>
        <button
          type="button"
          disabled={disabled || !hasContent || display.desiredPlaybackState === 'Stopped'}
          onClick={() => void command('media.stop')}
        >
          <span aria-hidden="true">■</span> Detener contenido
        </button>
        <button
          type="button"
          className="display-repeat-button"
          aria-pressed={display.playbackLoop ?? false}
          title="Activar o desactivar la reproducción en bucle del contenido asignado"
          disabled={disabled || !hasContent}
          onClick={() => void command('playback.loop', { loop: !display.playbackLoop })}
        >
          <span aria-hidden="true">↻</span> Repetir
          <span className="repeat-state">{display.playbackLoop ? 'Sí' : 'No'}</span>
        </button>
      </div>
      <p className="display-playback-help" role="status">
        {status}
      </p>
      {error && <p className="display-playback-error" role="alert">{error}</p>}
    </div>
  )
}
