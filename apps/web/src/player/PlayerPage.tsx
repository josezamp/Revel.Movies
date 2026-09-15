import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionState, type HubConnection } from '@microsoft/signalr'
import { createPairingSession, getPairingResult, mediaContentUrl, validateDeviceToken } from '../api/client'
import { createPlayerConnection, type PlayerCommand } from '../signalr/playerConnection'
import { prepareMediaAssets, registerMediaCache, type CacheCandidate } from './mediaCache'

const tokenKey = 'revel-movies.device-token'
const reconnectDelayMs = 3000
const clockSyncIntervalMs = 60_000

type ActiveMedia = {
  id: string
  type: 'Video' | 'Image'
}

type PlaylistPlaybackItem = {
  mediaId: string
  mediaType: 'Video' | 'Image'
  fileSize: number | null
  durationSeconds: number | null
}

type ActivePlaylist = {
  id: string
  loop: boolean
  items: PlaylistPlaybackItem[]
}

export function PlayerPage() {
  const [pairingCode, setPairingCode] = useState<string>()
  const [deviceToken, setDeviceToken] = useState(() => localStorage.getItem(tokenKey) ?? undefined)
  const [blackout, setBlackout] = useState(false)
  const [identify, setIdentify] = useState(false)
  const [media, setMedia] = useState<ActiveMedia>()
  const [playlist, setPlaylist] = useState<ActivePlaylist>()
  const [playlistIndex, setPlaylistIndex] = useState(0)
  const [playlistPaused, setPlaylistPaused] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const clockOffsetMsRef = useRef(0)
  const scheduledStartTimerRef = useRef<number>()

  useEffect(() => {
    void registerMediaCache()
  }, [])

  useEffect(() => {
    if (deviceToken) return

    let cancelled = false
    let timer: number | undefined

    async function pair() {
      try {
        const session = await createPairingSession()
        if (cancelled) return
        setPairingCode(session.code)

        timer = window.setInterval(async () => {
          try {
            const result = await getPairingResult(session.sessionToken)
            if (!result.isPaired || !result.deviceToken) return

            localStorage.setItem(tokenKey, result.deviceToken)
            setDeviceToken(result.deviceToken)
            setPairingCode(undefined)
            if (timer) window.clearInterval(timer)
          } catch (error) {
            if (!cancelled) console.error('Pairing status failed:', error)
          }
        }, 1500)
      } catch (error) {
        if (!cancelled) console.error('Pairing session failed:', error)
      }
    }

    void pair()
    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
    }
  }, [deviceToken])

  useEffect(() => {
    if (!deviceToken) return
    const currentDeviceToken = deviceToken

    let cancelled = false
    let heartbeatTimer: number | undefined
    let clockSyncTimer: number | undefined
    let reconnectTimer: number | undefined
    let connection: HubConnection

    const acknowledge = (command: PlayerCommand, status: string, detail?: string) => {
      if (!connection || connection.state !== HubConnectionState.Connected) return
      void connection.invoke(
        'Acknowledge',
        command.commandId,
        command.type,
        status,
        detail ?? null,
        Date.now(),
      ).catch(() => undefined)
    }

    const clearScheduledStart = () => {
      if (scheduledStartTimerRef.current !== undefined) {
        window.clearTimeout(scheduledStartTimerRef.current)
        scheduledStartTimerRef.current = undefined
      }
    }

    const scheduleAtServerTime = (startAt: unknown, callback: () => void) => {
      clearScheduledStart()
      const startAtMs = typeof startAt === 'string' ? Date.parse(startAt) : Number.NaN
      if (!Number.isFinite(startAtMs)) {
        callback()
        return
      }

      const localTargetMs = startAtMs - clockOffsetMsRef.current
      const delayMs = Math.max(0, localTargetMs - Date.now())
      scheduledStartTimerRef.current = window.setTimeout(() => {
        scheduledStartTimerRef.current = undefined
        callback()
      }, delayMs)
    }

    async function prepareCandidates(command: PlayerCommand, candidates: CacheCandidate[]) {
      try {
        const result = await prepareMediaAssets(candidates)
        const detail = result.supported
          ? `cache ${result.prepared}/${result.requested}; skipped ${result.skipped}`
          : 'cache unavailable; network fallback'
        acknowledge(command, 'ready', detail)
      } catch (error) {
        acknowledge(command, 'error', error instanceof Error ? error.message : 'media preparation failed')
      }
    }

    async function handleCommand(command: PlayerCommand) {
      if (cancelled) return
      acknowledge(command, 'received')

      switch (command.type) {
        case 'display.blackout':
          clearScheduledStart()
          setBlackout(true)
          acknowledge(command, 'executed')
          break
        case 'display.identify':
          setIdentify(true)
          window.setTimeout(() => setIdentify(false), 5000)
          acknowledge(command, 'executed')
          break
        case 'media.prepare': {
          const candidate = parseMediaCandidate(command.payload)
          if (!candidate) {
            acknowledge(command, 'error', 'invalid media.prepare payload')
            break
          }
          await prepareCandidates(command, [candidate])
          break
        }
        case 'playlist.prepare': {
          const items = parsePlaylistItems(command.payload?.items)
          if (items.length === 0) {
            acknowledge(command, 'error', 'invalid playlist.prepare payload')
            break
          }
          await prepareCandidates(command, items.map(item => ({ mediaId: item.mediaId, fileSize: item.fileSize })))
          break
        }
        case 'media.play': {
          const candidate = parseMediaCandidate(command.payload)
          if (!candidate) {
            acknowledge(command, 'error', 'invalid media.play payload')
            break
          }

          void prepareMediaAssets([candidate])
          acknowledge(command, 'ready', `scheduled; offset ${clockOffsetMsRef.current.toFixed(1)}ms`)
          scheduleAtServerTime(command.payload?.startAt, () => {
            setPlaylist(undefined)
            setPlaylistIndex(0)
            setPlaylistPaused(false)
            setBlackout(false)
            setMedia({ id: candidate.mediaId, type: candidate.mediaType })
            acknowledge(command, 'executed')
          })
          break
        }
        case 'media.pause':
          clearScheduledStart()
          videoRef.current?.pause()
          setPlaylistPaused(true)
          acknowledge(command, 'executed')
          break
        case 'media.stop':
          clearScheduledStart()
          videoRef.current?.pause()
          setPlaylist(undefined)
          setPlaylistIndex(0)
          setPlaylistPaused(false)
          setMedia(undefined)
          acknowledge(command, 'executed')
          break
        case 'playlist.play': {
          const playlistId = command.payload?.playlistId
          const items = parsePlaylistItems(command.payload?.items)
          if (typeof playlistId !== 'string' || items.length === 0) {
            acknowledge(command, 'error', 'invalid playlist.play payload')
            break
          }

          void prepareMediaAssets(items.map(item => ({ mediaId: item.mediaId, fileSize: item.fileSize })))
          const nextPlaylist: ActivePlaylist = {
            id: playlistId,
            loop: command.payload?.loop === true,
            items,
          }

          acknowledge(command, 'ready', `scheduled; offset ${clockOffsetMsRef.current.toFixed(1)}ms`)
          scheduleAtServerTime(command.payload?.startAt, () => {
            setPlaylist(nextPlaylist)
            setPlaylistIndex(0)
            setPlaylistPaused(false)
            setBlackout(false)
            setMedia({ id: items[0].mediaId, type: items[0].mediaType })
            acknowledge(command, 'executed')
          })
          break
        }
        case 'playlist.pause':
          clearScheduledStart()
          videoRef.current?.pause()
          setPlaylistPaused(true)
          acknowledge(command, 'executed')
          break
        case 'playlist.stop':
          clearScheduledStart()
          videoRef.current?.pause()
          setPlaylist(undefined)
          setPlaylistIndex(0)
          setPlaylistPaused(false)
          setMedia(undefined)
          acknowledge(command, 'executed')
          break
        case 'player.reload':
        case 'system.refresh':
          acknowledge(command, 'executed')
          window.setTimeout(() => window.location.reload(), 50)
          break
        default:
          acknowledge(command, 'error', 'unsupported command')
          break
      }
    }

    connection = createPlayerConnection(currentDeviceToken, command => void handleCommand(command))

    const scheduleStart = () => {
      if (cancelled || reconnectTimer !== undefined) return
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined
        void start()
      }, reconnectDelayMs)
    }

    async function heartbeat() {
      if (cancelled || connection.state !== HubConnectionState.Connected) return

      try {
        await connection.invoke('Heartbeat')
      } catch (error) {
        if (!cancelled) console.error('Player heartbeat failed:', error)
      }
    }

    async function synchronizeClock(sampleCount = 1) {
      if (cancelled || connection.state !== HubConnectionState.Connected) return

      let best: { offsetMs: number; roundTripMs: number } | undefined
      for (let index = 0; index < sampleCount; index++) {
        const startedAt = Date.now()
        const serverTimeMs = await connection.invoke<number>('GetServerTime')
        const finishedAt = Date.now()
        const roundTripMs = finishedAt - startedAt
        const midpointMs = startedAt + roundTripMs / 2
        const offsetMs = serverTimeMs - midpointMs

        if (!best || roundTripMs < best.roundTripMs)
          best = { offsetMs, roundTripMs }
      }

      if (!best) return
      clockOffsetMsRef.current = best.offsetMs
      localStorage.setItem('revel-movies.clock-offset-ms', String(best.offsetMs))
      localStorage.setItem('revel-movies.round-trip-ms', String(best.roundTripMs))
      await connection.invoke('ReportClockSample', best.offsetMs, best.roundTripMs)
    }

    async function start() {
      if (cancelled || connection.state !== HubConnectionState.Disconnected) return

      try {
        const valid = await validateDeviceToken(currentDeviceToken)
        if (cancelled) return

        if (!valid) {
          localStorage.removeItem(tokenKey)
          setDeviceToken(undefined)
          return
        }

        await connection.start()
        if (cancelled) return

        await synchronizeClock(3)

        if (heartbeatTimer === undefined)
          heartbeatTimer = window.setInterval(() => void heartbeat(), 10000)
        if (clockSyncTimer === undefined)
          clockSyncTimer = window.setInterval(() => void synchronizeClock(), clockSyncIntervalMs)
      } catch (error) {
        if (!cancelled) {
          console.error('Player connection failed to start:', error)
          scheduleStart()
        }
      }
    }

    connection.onclose(() => scheduleStart())

    // Let Strict Mode's setup/cleanup replay finish before starting negotiation.
    const startTimer = window.setTimeout(() => void start(), 0)

    return () => {
      cancelled = true
      window.clearTimeout(startTimer)
      clearScheduledStart()
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer)
      if (clockSyncTimer !== undefined) window.clearInterval(clockSyncTimer)
      void connection.stop().catch(error => console.error('Player connection failed to stop:', error))
    }
  }, [deviceToken])

  const advancePlaylist = useCallback(() => {
    if (!playlist || playlistPaused || playlist.items.length === 0) return

    const nextIndex = playlistIndex + 1
    if (nextIndex >= playlist.items.length) {
      if (!playlist.loop) {
        setPlaylist(undefined)
        setPlaylistIndex(0)
        setMedia(undefined)
        return
      }

      const first = playlist.items[0]
      setPlaylistIndex(0)
      setMedia({ id: first.mediaId, type: first.mediaType })
      return
    }

    const next = playlist.items[nextIndex]
    setPlaylistIndex(nextIndex)
    setMedia({ id: next.mediaId, type: next.mediaType })
  }, [playlist, playlistIndex, playlistPaused])

  useEffect(() => {
    if (media?.type === 'Video' && videoRef.current && !playlistPaused)
      void videoRef.current.play().catch(() => undefined)
  }, [media, playlistPaused])

  useEffect(() => {
    if (!playlist || playlistPaused || media?.type !== 'Image') return

    const current = playlist.items[playlistIndex]
    if (!current) return

    const durationMs = Math.max(0.5, current.durationSeconds ?? 10) * 1000
    const timer = window.setTimeout(advancePlaylist, durationMs)
    return () => window.clearTimeout(timer)
  }, [advancePlaylist, media, playlist, playlistIndex, playlistPaused])

  if (!deviceToken) {
    return (
      <main className="player-shell pairing-screen">
        <p className="eyebrow">REVEL MOVIES</p>
        <h1>Vincular esta pantalla</h1>
        <div className="pairing-code">{pairingCode ? `${pairingCode.slice(0, 3)} ${pairingCode.slice(3)}` : '··· ···'}</div>
        <p>Esperando vinculación…</p>
      </main>
    )
  }

  return (
    <main className={`player-shell ${blackout ? 'is-blackout' : ''}`}>
      {media?.type === 'Video' && (
        <video
          key={media.id}
          ref={videoRef}
          className="player-media"
          src={mediaContentUrl(media.id)}
          autoPlay
          muted
          playsInline
          onEnded={() => {
            if (playlist) advancePlaylist()
          }}
        />
      )}
      {media?.type === 'Image' && (
        <img key={media.id} className="player-media" src={mediaContentUrl(media.id)} alt="" />
      )}
      {identify && <div className="identify-overlay">REVEL MOVIES<br /><small>DISPLAY IDENTIFY</small></div>}
    </main>
  )
}

function parseMediaCandidate(payload: Record<string, unknown> | undefined): (CacheCandidate & { mediaType: 'Video' | 'Image' }) | null {
  const mediaId = payload?.mediaId
  const mediaType = payload?.mediaType
  const fileSize = payload?.fileSize

  if (typeof mediaId !== 'string' || (mediaType !== 'Video' && mediaType !== 'Image')) return null
  return {
    mediaId,
    mediaType,
    fileSize: typeof fileSize === 'number' && fileSize >= 0 ? fileSize : null,
  }
}

function parsePlaylistItems(value: unknown): PlaylistPlaybackItem[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const mediaId = candidate.mediaId
    const mediaType = candidate.mediaType
    const rawFileSize = candidate.fileSize
    const rawDuration = candidate.durationSeconds

    if (typeof mediaId !== 'string' || (mediaType !== 'Video' && mediaType !== 'Image')) return []

    return [{
      mediaId,
      mediaType,
      fileSize: typeof rawFileSize === 'number' && rawFileSize >= 0 ? rawFileSize : null,
      durationSeconds: typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : null,
    }]
  })
}
