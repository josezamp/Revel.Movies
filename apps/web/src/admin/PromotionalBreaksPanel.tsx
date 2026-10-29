import { useEffect, useRef, useState, type FormEvent } from 'react'
import { configurePromotionalBreaks, type Display, type DisplayGroup, type Playlist } from '../api/client'
import { displayPresence, sortByConnection } from './displayPresence'
import { deliveryState, playbackCommandId, type ContentDelivery } from './contentOperations'
import { displayTargets } from './displayTargets'
import { DisplayTargetSelect } from './DisplayTargetSelect'
import { DisplayName, DisplayNames } from './DisplayName'

export function PromotionalBreaksPanel({ eventId, displays, groups, playlists, loading }: {
  eventId: string; displays: Display[]; groups: DisplayGroup[]; playlists: Playlist[]; loading: boolean
}) {
  const [selectedTarget, setSelectedTarget] = useState('')
  const [playlistId, setPlaylistId] = useState('')
  const [everyVideos, setEveryVideos] = useState('5')
  const [pending, setPending] = useState(false)
  const [deliveries, setDeliveries] = useState<ContentDelivery[]>([])
  const [sentSignature, setSentSignature] = useState('')
  const [lastEnabled, setLastEnabled] = useState(true)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(timer) }, [])
  const sending = useRef(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const targets = displayTargets(displays, groups)
  const target = targets.find(item => item.value === selectedTarget)
  useEffect(() => { if (selectedTarget && !target) setSelectedTarget('') }, [selectedTarget, target])
  const selectedDisplays = sortByConnection(displays.filter(display => target?.ids.includes(display.id)), display => display.status)
  const displaysById = new Map(displays.map(display => [display.id, display]))
  const availablePlaylists = playlists.filter(playlist => playlist.items.length > 0 &&
    playlist.items.every(item => item.mediaType === 'Video' || item.mediaType === 1))
  const selectedPlaylist = availablePlaylists.find(playlist => playlist.id === playlistId)
  const offlineCount = selectedDisplays.filter(display => displayPresence(display.status).kind !== 'online').length
  const signature = JSON.stringify({ selectedTarget, ids: target?.ids.slice().sort(), playlistId, everyVideos, version: selectedPlaylist?.updatedAt })

  async function apply(enabled: boolean, retryIds?: string[]) {
    if (!target?.ids.length || sending.current) return
    const frequency = Number(everyVideos)
    if (enabled && (!selectedPlaylist || !Number.isInteger(frequency) || frequency < 1 || frequency > 100)) {
      setFeedback({ error: true, text: 'Elegí una playlist de videos y una frecuencia entre 1 y 100.' })
      return
    }
    sending.current = true
    setPending(true)
    setFeedback(null)
    try {
      const results = await Promise.all(selectedDisplays.filter(display => !retryIds || retryIds.includes(display.id)).map(async display => {
        const sentAt = Date.now()
        try {
          const response = await configurePromotionalBreaks(eventId, { targetType: 'display', targetId: display.id, enabled, playlistId: enabled ? playlistId : undefined, everyVideos: frequency || 5 })
          return { displayId: display.id, name: display.name, sentAt, commandId: playbackCommandId(response), previousCommandId: display.lastCommandId, expected: 'configuration' as const }
        } catch (cause) { return { displayId: display.id, name: display.name, sentAt, error: cause instanceof Error ? cause.message : 'No se pudo aplicar.' } }
      }))
      setDeliveries(previous => retryIds ? [...previous.filter(item => !retryIds.includes(item.displayId)), ...results] : results)
      setSentSignature(signature); setLastEnabled(enabled)
      setFeedback({ error: results.some(result => result.error), text: enabled
        ? `Configuración guardada y enviada a los destinos aceptados de ${target.label}. El contador se reinicia al recibirla, sin reiniciar el video actual.`
        : `Desactivación guardada en los destinos aceptados de ${target.label}. Una promoción en curso termina antes de volver a la playlist.` })
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
              <DisplayTargetSelect targets={targets} required value={target?.value ?? ''} onChange={event => { setSelectedTarget(event.target.value); setFeedback(null); setDeliveries([]) }} />
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
            <p className="content-target-names">{selectedDisplays.length ? <>Destinos: <DisplayNames displays={selectedDisplays} /></> : 'No hay destino elegido.'}</p>
            <p className="content-saved-label">{pending ? 'Aplicación en curso…' : sentSignature === signature ? 'Cambios enviados. Revisá la confirmación por pantalla.' : 'Cambios pendientes de aplicar. La configuración de las pantallas sigue igual.'}</p>
            <div className="button-row">
              <button type="submit" className="announcement-publish" disabled={!eventId || !target?.ids.length || !selectedPlaylist || loading}>
                {pending ? 'Aplicando…' : `Aplicar cambios${target ? ` en ${target.label}` : ''}`}
              </button>
              <button type="button" disabled={!eventId || !target?.ids.length} onClick={() => void apply(false)}>Desactivar cortes</button>
            </div>
          </fieldset>
          {feedback && <p className={feedback.error ? 'diagnostics-error' : 'announcement-feedback'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
          {deliveries.length > 0 && <ul className="content-results">{sortByConnection(deliveries, delivery => displaysById.get(delivery.displayId)?.status).map(delivery => <li key={delivery.displayId}><strong><DisplayName display={displaysById.get(delivery.displayId)} fallbackName={delivery.name} /></strong><span className={delivery.error ? 'content-result-error' : ''}>{deliveryState(delivery, displaysById.get(delivery.displayId), now)}</span>{delivery.error && <button disabled={pending || sentSignature !== signature} onClick={() => void apply(lastEnabled, [delivery.displayId])}>Reintentar</button>}</li>)}</ul>}
        </form>
        <div className="promotion-summary">
          <h3>La playlist sigue donde corresponde</h3>
          <p>Al terminar la promoción, continúa el siguiente video del contenido principal. Cada pantalla lleva su propio contador.</p>
          <p>La configuración se conserva en estas pantallas. Al iniciar otra playlist, el contador vuelve a cero. Los videos reproducidos individualmente no llevan cortes.</p>
          <p>Aplicar nuevamente reemplaza la configuración anterior y reinicia el contador. Si editás las promociones, volvé a aplicar para usar los cambios.</p>
          {selectedDisplays.length > 0 && <div className="announcement-assigned">
            <h3>Configuración guardada por pantalla</h3>
            <ul>{selectedDisplays.map(display => <li key={display.id}>
              <strong><DisplayName display={display} /></strong>
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
