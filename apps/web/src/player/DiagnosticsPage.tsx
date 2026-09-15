import { useEffect, useState } from 'react'
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
        if (!cancelled) setError('This browser is not paired yet.')
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
          setError(refreshError instanceof Error ? refreshError.message : 'Diagnostics unavailable.')
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
      <h1>Player diagnostics</h1>
      {error && <p className="diagnostics-error">{error}</p>}

      {display && (
        <>
          <section className="diagnostics-grid">
            <Diagnostic label="Display" value={display.name} />
            <Diagnostic label="Status" value={String(display.status)} />
            <Diagnostic label="Playback health" value={display.playbackHealth ?? '—'} />
            <Diagnostic label="Desired" value={display.desiredPlaybackState ?? '—'} />
            <Diagnostic label="Actual" value={display.actualPlaybackState ?? '—'} />
            <Diagnostic label="Position" value={formatSeconds(display.actualPositionSeconds)} />
            <Diagnostic label="Drift" value={formatMs(display.driftMs)} />
            <Diagnostic label="Last playback report" value={formatDate(display.lastPlaybackReportAt)} />
            <Diagnostic label="Clock offset" value={formatMs(display.clockOffsetMs)} />
            <Diagnostic label="Round trip" value={formatMs(display.roundTripMs)} />
            <Diagnostic label="Last clock sync" value={formatDate(display.lastClockSyncAt)} />
            <Diagnostic label="Last seen" value={formatDate(display.lastSeenAt)} />
            <Diagnostic label="Cached media" value={String(cachedMediaCount)} />
            <Diagnostic label="Service Worker" value={'serviceWorker' in navigator && window.isSecureContext ? 'Available' : 'Network fallback'} />
          </section>

          {playback && (
            <section className="diagnostics-history">
              <h2>Playback state</h2>
              <div className="diagnostics-grid">
                <Diagnostic label="Content" value={playback.contentType ?? '—'} />
                <Diagnostic label="Media" value={playback.actualMediaAssetId ?? playback.mediaAssetId ?? '—'} />
                <Diagnostic label="Playlist" value={playback.actualPlaylistId ?? playback.playlistId ?? '—'} />
                <Diagnostic label="Playlist item" value={playback.actualPlaylistIndex === null ? '—' : String(playback.actualPlaylistIndex + 1)} />
                <Diagnostic label="Duration" value={formatSeconds(playback.actualDurationSeconds)} />
                <Diagnostic label="Started at" value={formatDate(playback.startedAt)} />
              </div>
            </section>
          )}

          <section className="diagnostics-history">
            <h2>Recent command acknowledgements</h2>
            {diagnostics.acknowledgements.length === 0 && <p className="muted">No commands acknowledged yet.</p>}
            <div className="diagnostics-table-wrap">
              <table className="diagnostics-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Command</th>
                    <th>Status</th>
                    <th>Detail</th>
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
