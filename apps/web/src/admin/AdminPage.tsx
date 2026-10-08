import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createEvent,
  deleteDisplay,
  getDisplays,
  getEvents,
  getMedia,
  getPendingPairings,
  pairDisplay,
  sendCommand,
  updateDisplaySettings,
  type Display,
  type DisplayGroup,
  type EventSummary,
  type MediaAsset,
  type PendingPairing,
} from '../api/client'
import { OrchestrationPanel } from './OrchestrationPanel'
import { MediaWorkspace } from './MediaWorkspace'
import { DisplayPlaybackControls } from './DisplayPlaybackControls'
import { displayPresence } from './displayPresence'

export function AdminPage() {
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [events, setEvents] = useState<EventSummary[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [removingDisplayId, setRemovingDisplayId] = useState<string>()
  const [savingRotations, setSavingRotations] = useState<Record<string, number>>({})
  const savingRotationIds = useRef(new Set<string>())
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  const currentEventId = useRef(selectedEventId)
  currentEventId.current = selectedEventId

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

  async function refreshMedia(eventId = selectedEventId) {
    if (!eventId) {
      setMedia([])
      return
    }

    const nextMedia = await getMedia(eventId)
    if (currentEventId.current === eventId) setMedia(nextMedia)
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    void refreshMedia(selectedEventId)
  }, [selectedEventId])

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

  async function removeDisplay(display: Display) {
    if (removingDisplayId || !window.confirm(
      `Delete display "${display.name}"? It will be removed from its groups and must be paired again to reconnect.`,
    )) return

    try {
      setRemovingDisplayId(display.id)
      await deleteDisplay(display.id)
      setDisplays((current) => current.filter((item) => item.id !== display.id))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not delete display.')
    } finally {
      setRemovingDisplayId(undefined)
    }
  }

  async function changeDisplayRotation(displayId: string, rotation: number) {
    if (savingRotationIds.current.has(displayId)) return

    const normalizedRotation = ((rotation % 360) + 360) % 360
    savingRotationIds.current.add(displayId)
    setSavingRotations((current) => ({ ...current, [displayId]: normalizedRotation }))

    try {
      const updated = await updateDisplaySettings(displayId, normalizedRotation)
      setDisplays((current) => current.map((display) =>
        display.id === updated.id ? { ...display, rotation: updated.rotation } : display,
      ))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not update display rotation.')
    } finally {
      savingRotationIds.current.delete(displayId)
      setSavingRotations((current) => {
        const next = { ...current }
        delete next[displayId]
        return next
      })
    }
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
          <a className="announcement-shortcut" href="#anuncios">Crear anuncio</a>
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
        <div className="card-grid display-grid">
          {visibleDisplays.map((display) => (
            <article className={`card display-card connection-${displayPresence(display.status).kind}`} key={display.id}>
              <div className="display-heading">
                <strong>{display.name}</strong>
                <span className="display-presence" role="status">
                  <span className="status-dot" aria-hidden="true" />
                  {displayPresence(display.status).label}
                </span>
              </div>
              <small className="display-event">{eventName(display.eventId)}</small>
              <DisplayPlaybackControls display={display} media={media} onChanged={refresh} />
              <div className="display-orientation">
                <div className="display-orientation-heading">
                  <span>Orientation</span>
                  {Object.prototype.hasOwnProperty.call(savingRotations, display.id) && (
                    <small role="status" aria-live="polite">Saving…</small>
                  )}
                </div>
                <div className="display-settings-row">
                  <button
                    type="button"
                    className="rotation-step"
                    title="Rotate 90° left"
                    aria-label={`Rotate ${display.name} 90° left`}
                    disabled={Object.prototype.hasOwnProperty.call(savingRotations, display.id)}
                    onClick={() => void changeDisplayRotation(display.id, display.rotation - 90)}
                  >
                    ↶
                  </button>
                  <select
                    aria-label={`Orientation for ${display.name}`}
                    value={savingRotations[display.id] ?? display.rotation}
                    disabled={Object.prototype.hasOwnProperty.call(savingRotations, display.id)}
                    onChange={(event) => void changeDisplayRotation(display.id, Number(event.target.value))}
                  >
                    <option value={0}>0° · Landscape</option>
                    <option value={90}>90° · Portrait right</option>
                    <option value={180}>180° · Landscape inverted</option>
                    <option value={270}>270° · Portrait left</option>
                  </select>
                  <button
                    type="button"
                    className="rotation-step"
                    title="Rotate 90° right"
                    aria-label={`Rotate ${display.name} 90° right`}
                    disabled={Object.prototype.hasOwnProperty.call(savingRotations, display.id)}
                    onClick={() => void changeDisplayRotation(display.id, display.rotation + 90)}
                  >
                    ↷
                  </button>
                  <span className="orientation-badge">
                    {(savingRotations[display.id] ?? display.rotation) % 180 !== 0 ? '9:16' : '16:9'}
                  </span>
                </div>
              </div>
              <div className="playback-health-row">
                <span className={`playback-health health-${(display.playbackHealth ?? 'unknown').toLowerCase()}`}>
                  {display.playbackHealth ?? 'No playback state'}
                </span>
                {display.desiredPlaybackState && <small>Desired: {display.desiredPlaybackState}</small>}
                {display.actualPlaybackState && <small>Actual: {display.actualPlaybackState}</small>}
                {display.driftMs !== null && <small>Drift: {display.driftMs.toFixed(0)} ms</small>}
              </div>
              <div className="button-row">
                <button onClick={() => void sendCommand(display.id, 'display.identify')}>Identify</button>
                <button onClick={() => void sendCommand(display.id, 'display.blackout')}>Blackout</button>
                <button onClick={() => void sendCommand(display.id, 'player.reload')}>Reload</button>
                <button
                  className="danger-button"
                  disabled={removingDisplayId !== undefined}
                  onClick={() => void removeDisplay(display)}
                >
                  {removingDisplayId === display.id ? 'Deleting…' : 'Delete display'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <OrchestrationPanel key={selectedEventId} eventId={selectedEventId} displays={visibleDisplays} media={media.filter(item => item.eventId === selectedEventId)} onGroupsChanged={setGroups} />
      <MediaWorkspace key={selectedEventId + '-media'} eventId={selectedEventId} displays={visibleDisplays}
        groups={groups.filter(item => item.eventId === selectedEventId)} media={media.filter(item => item.eventId === selectedEventId)} onMediaChanged={refreshMedia} />
    </main>
  )
}
