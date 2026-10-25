import { useState } from 'react'
import { deleteDisplay, renameDisplay, sendCommand, updateDisplaySettings, type Display, type MediaAsset, type Playlist } from '../api/client'
import { Dialog } from './Dialog'
import { NameDialog } from './NameDialog'
import { DisplayPlaybackControls } from './DisplayPlaybackControls'
import { DisplayLiveState } from './DisplayLiveState'
import { displayPresence } from './displayPresence'

export function DisplayCard({ display, media, playlists, prepared, now, onChanged, onUpdated }: { display: Display; media: MediaAsset[]; playlists: Playlist[]; prepared: string[]; now: number; onChanged: () => Promise<void>; onUpdated: (display: Display) => void }) {
  const [rename, setRename] = useState(false)
  const [remove, setRemove] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const presence = displayPresence(display.status)
  async function act(label: string, action: () => Promise<unknown>) {
    if (busy) return
    setBusy(label); setError(''); setFeedback('Enviando…')
    try { await action(); setFeedback('Enviado. El estado se actualiza con los reportes de la TV.'); await onChanged() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo aplicar la acción.'); setFeedback('') }
    finally { setBusy('') }
  }
  const blackout = display.blackout ?? display.desiredPlaybackState === 'Blackout'
  return <article className={`card display-card connection-${presence.kind}`}>
    <div className="display-heading"><h3>{display.name}</h3><span className="display-presence"><span className="status-dot" aria-hidden="true" />{presence.label}</span></div>
    <DisplayLiveState display={display} media={media} playlists={playlists} now={now} />
    {prepared.length > 0 && <div className="prepared-summary"><small>PREPARADO · SIN MODIFICAR LA EMISIÓN</small>{prepared.map(label => <p key={label}>{label}</p>)}</div>}
    <DisplayPlaybackControls display={display} media={media} onChanged={onChanged} />
    <div className="button-row display-quick-actions"><button disabled={!!busy || !presence.connected} onClick={() => void act('blackout', () => sendCommand(display.id, blackout ? 'display.restore' : 'display.blackout'))}>{blackout ? 'Restaurar imagen' : 'Oscurecer pantalla'}</button><button disabled={!!busy || !presence.connected} onClick={() => void act('identify', () => sendCommand(display.id, 'display.identify'))}>{busy === 'identify' ? 'Enviando…' : 'Identificar'}</button><button onClick={() => setRename(true)}>Renombrar</button></div>
    {feedback && <small role="status">{feedback}</small>}{error && <p role="alert" className="workspace-error">{error}</p>}
    <details className="display-details"><summary>Detalles · orientación y diagnóstico</summary>
      <div className="display-orientation"><div className="display-orientation-heading"><span>Orientación física</span>{busy === 'rotation' && <small role="status">Guardando…</small>}</div><div className="display-settings-row">
        <button className="rotation-step" aria-label={`Rotar ${display.name} 90° a la izquierda`} disabled={!!busy} onClick={() => void act('rotation', async () => onUpdated(await updateDisplaySettings(display.id, (display.rotation + 270) % 360)))}>↶</button>
        <select aria-label={`Orientación de ${display.name}`} value={display.rotation} disabled={!!busy} onChange={event => void act('rotation', async () => onUpdated(await updateDisplaySettings(display.id, Number(event.target.value))))}><option value={0}>0° · Horizontal</option><option value={90}>90° · Vertical derecha</option><option value={180}>180° · Horizontal invertida</option><option value={270}>270° · Vertical izquierda</option></select>
        <button className="rotation-step" aria-label={`Rotar ${display.name} 90° a la derecha`} disabled={!!busy} onClick={() => void act('rotation', async () => onUpdated(await updateDisplaySettings(display.id, (display.rotation + 90) % 360)))}>↷</button><span className="orientation-badge">{display.rotation % 180 ? '9:16' : '16:9'}</span>
      </div></div>
      <details className="diagnostic-details"><summary>Diagnóstico técnico</summary><dl><dt>Identificador</dt><dd>{display.id.slice(0, 8)}</dd><dt>Estado solicitado</dt><dd>{display.desiredPlaybackState ?? 'Sin estado'}</dd><dt>Estado reportado</dt><dd>{display.actualPlaybackState ?? 'Sin reporte'}</dd><dt>Salud</dt><dd>{display.playbackHealth ?? 'Sin reporte'}</dd><dt>Desfase de reproducción</dt><dd>{display.driftMs?.toFixed(0) ?? '—'} ms</dd><dt>Desfase del reloj</dt><dd>{display.clockOffsetMs?.toFixed(0) ?? '—'} ms</dd><dt>Tiempo de ida y vuelta</dt><dd>{display.roundTripMs?.toFixed(0) ?? '—'} ms</dd></dl><p className="muted">El desfase compara la posición con el inicio coordinado. La conexión no garantiza reproducción.</p></details>
      <div className="button-row">{display.announcement && <button disabled={!!busy} onClick={() => void act('announcement', () => sendCommand(display.id, 'announcement.clear'))}>Retirar anuncio</button>}{display.webPage && <button disabled={!!busy} onClick={() => void act('webpage', () => sendCommand(display.id, 'webpage.clear'))}>Retirar página</button>}</div>
      <div className="maintenance"><p className="muted">Mantenimiento · recargar interrumpe brevemente la emisión.</p><div className="button-row"><button disabled={!!busy || !presence.connected} onClick={() => void act('reload', () => sendCommand(display.id, 'player.reload'))}>Recargar reproductor</button><button className="danger-button" onClick={() => setRemove(true)}>Desvincular pantalla</button></div></div>
    </details>
    {rename && <NameDialog title="Renombrar pantalla" initialName={display.name} onClose={() => setRename(false)} onSave={async name => { onUpdated(await renameDisplay(display.id, name)); await onChanged() }} />}
    {remove && <Dialog title={`Desvincular ${display.name}`} busy={!!busy} onClose={() => setRemove(false)}><p>Se eliminará su vinculación y pertenencia a grupos. Para volver a usarla, tendrás que vincularla de nuevo.</p>{error && <p className="workspace-error" role="alert">{error}</p>}<div className="playlist-dialog-footer"><button disabled={!!busy} onClick={() => setRemove(false)}>Cancelar</button><button className="danger-button" disabled={!!busy} onClick={() => void act('remove', async () => { await deleteDisplay(display.id); setRemove(false) })}>{busy ? 'Desvinculando…' : 'Desvincular pantalla'}</button></div></Dialog>}
  </article>
}
