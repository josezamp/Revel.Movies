import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionState } from '@microsoft/signalr'
import { createPairingSession, getPairingResult, mediaContentUrl, validateDeviceToken } from '../api/client'
import { createPlayerConnection, type PlayerCommand } from '../signalr/playerConnection'

const tokenKey = 'revel-movies.device-token'
const reconnectDelayMs = 3000

type ActiveMedia = {
  id: string
  type: 'Video' | 'Image'
}

type PlaylistPlaybackItem = {
  mediaId: string
  mediaType: 'Video' | 'Image'
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

    let cancelled = false
    let heartbeatTimer: number | undefined
    let reconnectTimer: number | undefined

    const onCommand = (command: PlayerCommand) => {
      if (cancelled) return

      switch (command.type) {
        case 'display.blackout':
          setBlackout(true)
          break
        case 'display.identify':
          setIdentify(true)
          window.setTimeout(() => setIdentify(false), 5000)
          break
        case 'media.play': {
          const mediaId = command.payload?.mediaId
          const mediaType = command.payload?.mediaType
          if (typeof mediaId === 'string' && (mediaType === 'Video' || mediaType === 'Image')) {
            setPlaylist(undefined)
            setPlaylistIndex(0)
            setPlaylistPaused(false)
            setBlackout(false)
            setMedia({ id: mediaId, type: mediaType })
          }
          break
        }
        case 'media.pause':
          videoRef.current?.pause()
          setPlaylistPaused(true)
          break
        case 'media.stop':
          videoRef.current?.pause()
          setPlaylist(undefined)
          setPlaylistIndex(0)
          setPlaylistPaused(false)
          setMedia(undefined)
          break
        case 'playlist.play': {
          const playlistId = command.payload?.playlistId
          const items = parsePlaylistItems(command.payload?.items)
          if (typeof playlistId === 'string' && items.length > 0) {
            const nextPlaylist: ActivePlaylist = {
              id: playlistId,
              loop: command.payload?.loop === true,
              items,
            }
            setPlaylist(nextPlaylist)
            setPlaylistIndex(0)
            setPlaylistPaused(false)
            setBlackout(false)
            setMedia({ id: items[0].mediaId, type: items[0].mediaType })
          }
          break
        }
        case 'playlist.pause':
          videoRef.current?.pause()
          setPlaylistPaused(true)
          break
        case 'playlist.stop':
          videoRef.current?.pause()
          setPlaylist(undefined)
          setPlaylistIndex(0)
          setPlaylistPaused(false)
          setMedia(undefined)
          break
        case 'player.reload':
        case 'system.refresh':
          window.location.reload()
          break
      }
    }

    const connection = createPlayerConnection(deviceToken, onCommand)

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

    async function start() {
      if (cancelled || connection.state !== HubConnectionState.Disconnected) return

      try {
        const valid = await validateDeviceToken(deviceToken)
        if (cancelled) return

        if (!valid) {
          localStorage.removeItem(tokenKey)
          setDeviceToken(undefined)
          return
        }

        await connection.start()
        if (cancelled) return

        if (heartbeatTimer === undefined)
          heartbeatTimer = window.setInterval(() => void heartbeat(), 10000)
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
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer)
      connection.off('command', onCommand)
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

function parsePlaylistItems(value: unknown): PlaylistPlaybackItem[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const mediaId = candidate.mediaId
    const mediaType = candidate.mediaType
    const rawDuration = candidate.durationSeconds

    if (typeof mediaId !== 'string' || (mediaType !== 'Video' && mediaType !== 'Image')) return []

    return [{
      mediaId,
      mediaType,
      durationSeconds: typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : null,
    }]
  })
}
