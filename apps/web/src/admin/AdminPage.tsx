import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createEvent,
  deleteMedia,
  getDisplays,
  getEvents,
  getMedia,
  getPendingPairings,
  pairDisplay,
  sendCommand,
  uploadMedia,
  type Display,
  type EventSummary,
  type MediaAsset,
  type PendingPairing,
} from '../api/client'

export function AdminPage() {
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [events, setEvents] = useState<EventSummary[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [targetDisplayId, setTargetDisplayId] = useState('')
  const [selectedFile, setSelectedFile] = useState<File>()
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

    setMedia(await getMedia(eventId))
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

  useEffect(() => {
    setTargetDisplayId((current) =>
      visibleDisplays.some((display) => display.id === current)
        ? current
        : visibleDisplays[0]?.id ?? '',
    )
  }, [visibleDisplays])

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

  async function uploadSelectedMedia() {
    if (!selectedEventId || !selectedFile || uploading) return

    try {
      setUploading(true)
      await uploadMedia(selectedEventId, selectedFile)
      setSelectedFile(undefined)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await refreshMedia(selectedEventId)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Media upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function playMedia(item: MediaAsset) {
    if (!targetDisplayId) {
      window.alert('Select a target display first.')
      return
    }

    await sendCommand(targetDisplayId, 'media.play', { mediaId: item.id })
  }

  async function removeMedia(item: MediaAsset) {
    if (!window.confirm(`Delete ${item.name}?`)) return
    await deleteMedia(item.id)
    await refreshMedia(selectedEventId)
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

      <section>
        <div className="section-heading">
          <div>
            <h2>Media Library</h2>
            <p className="muted">MP4, JPG, PNG, WEBP or GIF. Maximum 1 GB per file.</p>
          </div>
        </div>

        <div className="media-toolbar">
          <label className="file-picker">
            Media file
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,image/jpeg,image/png,image/webp,image/gif"
              disabled={!selectedEventId || uploading}
              onChange={(event) => setSelectedFile(event.target.files?.[0])}
            />
          </label>
          <button disabled={!selectedFile || !selectedEventId || uploading} onClick={() => void uploadSelectedMedia()}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>

          <label>
            Target display
            <select value={targetDisplayId} onChange={(event) => setTargetDisplayId(event.target.value)}>
              {visibleDisplays.length === 0 && <option value="">No displays</option>}
              {visibleDisplays.map((display) => <option key={display.id} value={display.id}>{display.name}</option>)}
            </select>
          </label>
          <button disabled={!targetDisplayId} onClick={() => void sendCommand(targetDisplayId, 'media.pause')}>Pause</button>
          <button disabled={!targetDisplayId} onClick={() => void sendCommand(targetDisplayId, 'media.stop')}>Stop</button>
        </div>

        {selectedEventId && media.length === 0 && <p className="muted">No media uploaded for this event yet.</p>}
        <div className="media-grid">
          {media.map((item) => (
            <article className="card media-card" key={item.id}>
              {item.type === 'Image' && <img className="media-preview" src={item.contentUrl} alt="" />}
              <div className="media-card-heading">
                <span className="media-type">{String(item.type)}</span>
                <strong>{item.name}</strong>
              </div>
              <div className="media-meta">
                <span>{item.fileName}</span>
                <span>{formatBytes(item.fileSize)}</span>
              </div>
              <div className="button-row">
                <button disabled={!targetDisplayId} onClick={() => void playMedia(item)}>▶ Play</button>
                <button className="danger-button" onClick={() => void removeMedia(item)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
