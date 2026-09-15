import { useEffect, useMemo, useState } from 'react'
import {
  createEvent,
  getDisplays,
  getEvents,
  getPendingPairings,
  pairDisplay,
  sendCommand,
  type Display,
  type EventSummary,
  type PendingPairing,
} from '../api/client'

export function AdminPage() {
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [events, setEvents] = useState<EventSummary[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')

  async function refresh() {
    const [nextEvents, nextPending, nextDisplays] = await Promise.all([
      getEvents(),
      getPendingPairings(),
      getDisplays(),
    ])

    setEvents(nextEvents)
    setPending(nextPending)
    setDisplays(nextDisplays)
    setSelectedEventId((current) => current || nextEvents[0]?.id || '')
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [])

  const visibleDisplays = useMemo(
    () => selectedEventId ? displays.filter((display) => display.eventId === selectedEventId) : displays,
    [displays, selectedEventId],
  )

  async function createNewEvent() {
    const name = window.prompt('Event name', 'Fiesta 2026')
    if (!name) return

    const item = await createEvent(name)
    setSelectedEventId(item.id)
    await refresh()
  }

  async function pair(item: PendingPairing) {
    if (!selectedEventId) {
      window.alert('Create or select an event before pairing a display.')
      return
    }

    const name = window.prompt('Display name', 'Living izquierda')
    if (!name) return
    await pairDisplay(item.code, name, selectedEventId)
    await refresh()
  }

  const eventName = (eventId: string) => events.find((item) => item.id === eventId)?.name ?? 'Unknown event'

  return (
    <main className="admin-shell">
      <header>
        <p className="eyebrow">REVEL MOVIES</p>
        <h1>Admin</h1>
        <div className="admin-toolbar">
          <label>
            Event
            <select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)}>
              {events.length === 0 && <option value="">No events</option>}
              {events.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button onClick={() => void createNewEvent()}>New event</button>
        </div>
      </header>

      <section>
        <h2>Pending pairing</h2>
        {pending.length === 0 && <p className="muted">No new displays waiting.</p>}
        {events.length === 0 && pending.length > 0 && (
          <p className="muted">Create an event before pairing the waiting displays.</p>
        )}
        <div className="card-grid">
          {pending.map((item) => (
            <article className="card" key={item.code}>
              <strong>{item.code.slice(0, 3)} {item.code.slice(3)}</strong>
              <button disabled={!selectedEventId} onClick={() => void pair(item)}>Pair display</button>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>Displays</h2>
        {visibleDisplays.length === 0 && <p className="muted">No displays for this event yet.</p>}
        <div className="card-grid">
          {visibleDisplays.map((display) => (
            <article className="card" key={display.id}>
              <div className="display-heading">
                <span className={`status-dot status-${String(display.status).toLowerCase()}`} />
                <strong>{display.name}</strong>
              </div>
              <small>{eventName(display.eventId)} · {String(display.status)}</small>
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
