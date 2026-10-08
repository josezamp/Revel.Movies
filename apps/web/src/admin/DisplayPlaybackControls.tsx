import { useRef, useState } from 'react'
import { sendCommand, type Display, type MediaAsset } from '../api/client'
import { displayPresence } from './displayPresence'

type Props = { display: Display; media: MediaAsset[]; onChanged: () => Promise<void> }

export function DisplayPlaybackControls({ display, media, onChanged }: Props) {
  const [selectedMediaId, setSelectedMediaId] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const sending = useRef(false)
  const connected = displayPresence(display.status).connected
  const assigned = display.playbackContentType === 'Playlist'
    ? 'Playlist asignada'
    : media.find(item => item.id === display.playbackMediaId)?.name
  const hasContent = Boolean(display.playbackMediaId || display.playbackPlaylistId)
  const selected = media.find(item => item.id === selectedMediaId)
  const playing = display.desiredPlaybackState === 'Playing' && display.actualPlaybackState !== 'Ended'
  const pause = !selected && playing
  const disabled = !connected || busy

  async function command(type: string, payload?: unknown) {
    if (sending.current || !connected) return
    sending.current = true
    setBusy(true)
    setError('')
    setFeedback('Enviando…')
    try {
      await sendCommand(display.id, type, payload)
      if (type === 'media.play') setSelectedMediaId('')
      setFeedback('Comando enviado')
      await onChanged()
    } catch (cause) {
      setFeedback('')
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el comando.')
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="display-playback" role="group" aria-label={`Multimedia de ${display.name}`} aria-busy={busy}>
      <label className="display-media-picker">
        Contenido
        <select
          aria-label={`Contenido para ${display.name}`}
          value={selected?.id ?? ''}
          disabled={disabled}
          onChange={event => { setSelectedMediaId(event.target.value); setFeedback(''); setError('') }}
        >
          <option value="">{hasContent ? assigned ?? 'Contenido asignado' : 'Seleccionar contenido…'}</option>
          {media.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="display-transport">
        <button
          type="button"
          className="display-play-button"
          disabled={disabled || (!selected && !hasContent)}
          onClick={() => void command(selected ? 'media.play' : pause ? 'media.pause' : 'playback.resume', selected ? { mediaId: selected.id } : undefined)}
        >
          <span aria-hidden="true">{pause ? 'Ⅱ' : '▶'}</span> {pause ? 'Pausar' : 'Reproducir'}
        </button>
        <button
          type="button"
          disabled={disabled || !hasContent || display.desiredPlaybackState === 'Stopped'}
          onClick={() => void command('media.stop')}
        >
          <span aria-hidden="true">■</span> Detener
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
        {!connected ? 'TV sin conexión. Controles no disponibles.' : feedback || (hasContent ? 'Controlá el contenido de esta TV.' : 'Elegí un archivo para comenzar.')}
      </p>
      {error && <p className="display-playback-error" role="alert">{error}</p>}
    </div>
  )
}
