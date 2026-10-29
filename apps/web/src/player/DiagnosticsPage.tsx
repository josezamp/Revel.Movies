import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getPlayerDiagnostics, type PlayerDiagnostics } from '../api/client'
import { getCachedMediaCount } from './mediaCache'

const tokenKey = 'revel-movies.device-token'

export function DiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState<PlayerDiagnostics>()
  const [cachedMediaCount, setCachedMediaCount] = useState(0)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      const deviceToken = localStorage.getItem(tokenKey)
      if (!deviceToken) {
        if (!cancelled) setError('Esta pantalla todavía no está vinculada. Abrí el reproductor para obtener su código.')
        return
      }

      try {
        const [nextDiagnostics, nextCachedMediaCount] = await Promise.all([
          getPlayerDiagnostics(deviceToken),
          getCachedMediaCount(),
        ])
        if (cancelled) return
        setDiagnostics(nextDiagnostics)
        setCachedMediaCount(nextCachedMediaCount)
        setError(undefined)
      } catch (refreshError) {
        if (!cancelled)
          setError(refreshError instanceof Error ? refreshError.message : 'No se pudo actualizar el diagnóstico. Se reintentará automáticamente.')
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const display = diagnostics?.display
  const playback = diagnostics?.playback

  return (
    <main className="diagnostics-shell">
      <p className="eyebrow">REVEL MOVIES</p>
      <h1>Diagnóstico de pantalla</h1>
      <nav className="home-actions" aria-label="Navegación del diagnóstico"><Link to="/player">Volver al reproductor</Link><Link to="/">Ir al inicio</Link></nav>
      {!diagnostics && !error && <p role="status">Cargando diagnóstico…</p>}
      {error && <p className="diagnostics-error" role="alert">{error}</p>}

      {display && (
        <>
          <section className="diagnostics-grid">
            <Diagnostic label="Pantalla" value={display.name} />
            <Diagnostic label="Conexión" value={String(display.status)} />
            <Diagnostic label="Estado de reproducción" value={display.playbackHealth ?? '—'} />
            <Diagnostic label="Estado solicitado" value={display.desiredPlaybackState ?? '—'} />
            <Diagnostic label="Estado reportado" value={display.actualPlaybackState ?? '—'} />
            <Diagnostic label="Posición" value={formatSeconds(display.actualPositionSeconds)} />
            <Diagnostic label="Desfase de reproducción" value={formatMs(display.driftMs)} />
            <Diagnostic label="Último reporte de reproducción" value={formatDate(display.lastPlaybackReportAt)} />
            <Diagnostic label="Diferencia de reloj" value={formatMs(display.clockOffsetMs)} />
            <Diagnostic label="Latencia de ida y vuelta" value={formatMs(display.roundTripMs)} />
            <Diagnostic label="Última sincronización" value={formatDate(display.lastClockSyncAt)} />
            <Diagnostic label="Última conexión" value={formatDate(display.lastSeenAt)} />
            <Diagnostic label="Archivos en caché" value={String(cachedMediaCount)} />
            <Diagnostic label="Service Worker" value={'serviceWorker' in navigator && window.isSecureContext ? 'Disponible' : 'Reproducción por red'} />
          </section>

          {playback && (
            <section className="diagnostics-history">
              <h2>Estado de reproducción</h2>
              <div className="diagnostics-grid">
                <Diagnostic label="Contenido" value={playback.contentType ?? '—'} />
                <Diagnostic label="Archivo" value={playback.actualMediaAssetId ?? playback.mediaAssetId ?? '—'} />
                <Diagnostic label="Playlist" value={playback.actualPlaylistId ?? playback.playlistId ?? '—'} />
                <Diagnostic label="Posición en la playlist" value={playback.actualPlaylistIndex === null ? '—' : String(playback.actualPlaylistIndex + 1)} />
                <Diagnostic label="Duración" value={formatSeconds(playback.actualDurationSeconds)} />
                <Diagnostic label="Inicio de reproducción" value={formatDate(playback.startedAt)} />
              </div>
            </section>
          )}

          <section className="diagnostics-history">
            <h2>Últimas confirmaciones de comandos</h2>
            {diagnostics.acknowledgements.length === 0 && <p className="muted">Todavía no se recibieron confirmaciones de comandos.</p>}
            <div className="diagnostics-table-wrap">
              <table className="diagnostics-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Comando</th>
                    <th>Estado</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.acknowledgements.map((ack, index) => (
                    <tr key={`${ack.commandId}-${ack.status}-${index}`}>
                      <td>{new Date(ack.serverReceivedAt).toLocaleTimeString()}</td>
                      <td>{ack.commandType}</td>
                      <td><span className={`ack-status ack-${ack.status}`}>{ack.status}</span></td>
                      <td>{ack.detail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <article className="diagnostic-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function formatMs(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)} ms`
}

function formatSeconds(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)} s`
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}
