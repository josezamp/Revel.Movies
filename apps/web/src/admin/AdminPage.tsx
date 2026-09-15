import { useEffect, useState } from 'react'
import { getDisplays, getPendingPairings, pairDisplay, sendCommand, type Display, type PendingPairing } from '../api/client'

export function AdminPage() {
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [displays, setDisplays] = useState<Display[]>([])

  async function refresh() {
    const [nextPending, nextDisplays] = await Promise.all([getPendingPairings(), getDisplays()])
    setPending(nextPending)
    setDisplays(nextDisplays)
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [])

  async function pair(item: PendingPairing) {
    const name = window.prompt('Display name', 'Living izquierda')
    if (!name) return
    await pairDisplay(item.code, name)
    await refresh()
  }

  return (
    <main className="admin-shell">
      <header>
        <p className="eyebrow">REVEL MOVIES</p>
        <h1>Admin</h1>
      </header>

      <section>
        <h2>Pending pairing</h2>
        {pending.length === 0 && <p className="muted">No new displays waiting.</p>}
        <div className="card-grid">
          {pending.map((item) => (
            <article className="card" key={item.code}>
              <strong>{item.code.slice(0, 3)} {item.code.slice(3)}</strong>
              <button onClick={() => void pair(item)}>Pair display</button>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>Displays</h2>
        <div className="card-grid">
          {displays.map((display) => (
            <article className="card" key={display.id}>
              <div className="display-heading">
                <span className={`status-dot status-${String(display.status).toLowerCase()}`} />
                <strong>{display.name}</strong>
              </div>
              <small>{String(display.status)}</small>
              <div className="button-row">
                <button onClick={() => void sendCommand(display.id, 'display.identify')}>Identify</button>
                <button onClick={() => void sendCommand(display.id, 'display.blackout')}>Blackout</button>
                <button onClick={() => void sendCommand(display.id, 'player.reload')}>Reload</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
