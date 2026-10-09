import { useRef, useState, type FormEvent } from 'react'
import { configurePromotionalBreaks, type Display, type DisplayGroup, type Playlist, type PlaybackTargetType } from '../api/client'
import { displayPresence } from './displayPresence'

export function PromotionalBreaksPanel({ eventId, displays, groups, playlists, loading }: {
  eventId: string; displays: Display[]; groups: DisplayGroup[]; playlists: Playlist[]; loading: boolean
}) {
  const [selectedTarget, setSelectedTarget] = useState('')
  const [playlistId, setPlaylistId] = useState('')
  const [everyVideos, setEveryVideos] = useState('5')
  const [pending, setPending] = useState(false)
  const sending = useRef(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const targets = [
    ...displays.map(display => ({ value: `display:${display.id}`, label: display.name, ids: [display.id] })),
    ...groups.map(group => ({ value: `group:${group.id}`, label: `Grupo: ${group.name}`, ids: group.displayIds })),
  ]
  const target = targets.find(item => item.value === selectedTarget)
  const selectedDisplays = displays.filter(display => target?.ids.includes(display.id))
  const availablePlaylists = playlists.filter(playlist => playlist.items.length > 0 &&
    playlist.items.every(item => item.mediaType === 'Video' || item.mediaType === 1))
  const selectedPlaylist = availablePlaylists.find(playlist => playlist.id === playlistId)
  const offlineCount = selectedDisplays.filter(display => displayPresence(display.status).kind !== 'online').length

  async function apply(enabled: boolean) {
    if (!target?.ids.length || sending.current) return
    const frequency = Number(everyVideos)
    if (enabled && (!selectedPlaylist || !Number.isInteger(frequency) || frequency < 1 || frequency > 100)) {
      setFeedback({ error: true, text: 'Elegí una playlist de videos y una frecuencia entre 1 y 100.' })
      return
    }
    const [targetType, targetId] = target.value.split(':') as [PlaybackTargetType, string]
    sending.current = true
    setPending(true)
    setFeedback(null)
    try {
      await configurePromotionalBreaks(eventId, { targetType, targetId, enabled, playlistId: enabled ? playlistId : undefined, everyVideos: frequency || 5 })
      setFeedback({ error: false, text: enabled
        ? `Configuración guardada para ${target.label}. El contador comienza al recibirla, sin reiniciar el video actual.`
        : `Desactivación guardada para ${target.label}. Si hay una promoción reproduciéndose, terminará antes de volver a la playlist.` })
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : 'No se pudo guardar la configuración. Volvé a intentar.' })
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void apply(true) }

  return (
    <section id="cortes-promocionales" className="promotional-breaks-panel" aria-labelledby="promotional-breaks-heading">
      <div className="section-heading"><div>
        <h2 id="promotional-breaks-heading">Cortes promocionales</h2>
        <p className="muted">Una promoción entre videos, en las pantallas que elijas.</p>
      </div></div>
      <div className="promotion-workspace">
        <form className="announcement-form" onSubmit={submit}>
          <fieldset disabled={pending}>
            <legend className="visually-hidden">Configurar cortes promocionales</legend>
            <label>Dónde aparecen
              <select required value={target?.value ?? ''} onChange={event => { setSelectedTarget(event.target.value); setFeedback(null) }}>
                <option value="">Elegí una pantalla o un grupo</option>
                {targets.map(item => <option key={item.value} value={item.value}>{item.label} ({item.ids.length})</option>)}
              </select>
            </label>
            {target && !target.ids.length && <p className="announcement-notice">Agregá pantallas al grupo antes de configurar los cortes.</p>}
            <label>Playlist de promociones
              <select required value={selectedPlaylist?.id ?? ''} disabled={loading} onChange={event => setPlaylistId(event.target.value)}>
                <option value="">{loading ? 'Cargando playlists…' : 'Elegí una playlist de videos'}</option>
                {availablePlaylists.map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name} ({playlist.items.length} videos)</option>)}
              </select>
              <small>Se reproduce un video por corte, rotando en el orden de esta playlist.</small>
            </label>
            {!loading && !availablePlaylists.length && <p className="announcement-notice">Creá una playlist con los videos que querés promocionar. Debe tener al menos un video y no incluir imágenes.</p>}
            <label>Cada cuántos videos
              <input type="number" min="1" max="100" step="1" required value={everyVideos} onChange={event => setEveryVideos(event.target.value)} />
              <small>Cuenta videos completos del contenido principal. Las imágenes y las promociones no suman.</small>
            </label>
            {offlineCount > 0 && <p className="announcement-notice">{offlineCount} sin conexión. Recibirán la configuración al reconectarse.</p>}
            <div className="button-row">
              <button type="submit" className="announcement-publish" disabled={!eventId || !target?.ids.length || !selectedPlaylist || loading}>
                {pending ? 'Guardando…' : 'Aplicar cortes'}
              </button>
              <button type="button" disabled={!eventId || !target?.ids.length} onClick={() => void apply(false)}>Desactivar cortes</button>
            </div>
          </fieldset>
          {feedback && <p className={feedback.error ? 'diagnostics-error' : 'announcement-feedback'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
        </form>
        <div className="promotion-summary">
          <h3>La playlist sigue donde corresponde</h3>
          <p>Al terminar la promoción, continúa el siguiente video del contenido principal. Cada pantalla lleva su propio contador.</p>
          <p>La configuración se conserva en estas pantallas. Al iniciar otra playlist, el contador vuelve a cero. Los videos reproducidos individualmente no llevan cortes.</p>
          <p>Aplicar nuevamente reemplaza la configuración anterior y reinicia el contador. Si editás las promociones, volvé a aplicar para usar los cambios.</p>
          {selectedDisplays.length > 0 && <div className="announcement-assigned">
            <h3>Configuración guardada por pantalla</h3>
            <ul>{selectedDisplays.map(display => <li key={display.id}>
              <strong>{display.name}</strong>
              <span>{display.promotionPolicy?.enabled
                ? `${display.promotionPolicy.playlistName} · cada ${display.promotionPolicy.everyVideos} videos`
                : 'Sin cortes promocionales'}</span>
            </li>)}</ul>
            <small>Se aplica a los integrantes actuales del grupo. El estado guardado no confirma la recepción en cada pantalla.</small>
          </div>}
        </div>
      </div>
    </section>
  )
}
