import { useEffect, useRef, useState } from 'react'
import { createPairingSession, getPairingResult } from '../api/client'
import { createPlayerConnection, type PlayerCommand } from '../signalr/playerConnection'

const tokenKey = 'revel-movies.device-token'

export function PlayerPage() {
  const [pairingCode, setPairingCode] = useState<string>()
  const [deviceToken, setDeviceToken] = useState(() => localStorage.getItem(tokenKey) ?? undefined)
  const [blackout, setBlackout] = useState(false)
  const [identify, setIdentify] = useState(false)
  const [mediaUrl, setMediaUrl] = useState<string>()
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (deviceToken) return

    let cancelled = false
    let timer: number | undefined

    async function pair() {
      const session = await createPairingSession()
      if (cancelled) return
      setPairingCode(session.code)

      timer = window.setInterval(async () => {
        const result = await getPairingResult(session.sessionToken)
        if (!result.isPaired || !result.deviceToken) return

        localStorage.setItem(tokenKey, result.deviceToken)
        setDeviceToken(result.deviceToken)
        setPairingCode(undefined)
        if (timer) window.clearInterval(timer)
      }, 1500)
    }

    void pair()
    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
    }
  }, [deviceToken])

  useEffect(() => {
    if (!deviceToken) return

    const onCommand = (command: PlayerCommand) => {
      switch (command.type) {
        case 'display.blackout':
          setBlackout(true)
          break
        case 'display.identify':
          setIdentify(true)
          window.setTimeout(() => setIdentify(false), 5000)
          break
        case 'media.play': {
          const url = command.payload?.url
          if (typeof url === 'string') {
            setBlackout(false)
            setMediaUrl(url)
          }
          break
        }
        case 'media.pause':
          videoRef.current?.pause()
          break
        case 'media.stop':
          videoRef.current?.pause()
          setMediaUrl(undefined)
          break
        case 'player.reload':
        case 'system.refresh':
          window.location.reload()
          break
      }
    }

    const connection = createPlayerConnection(deviceToken, onCommand)
    let heartbeatTimer: number | undefined

    void connection.start().then(() => {
      heartbeatTimer = window.setInterval(() => void connection.invoke('Heartbeat'), 10000)
    })

    return () => {
      if (heartbeatTimer) window.clearInterval(heartbeatTimer)
      void connection.stop()
    }
  }, [deviceToken])

  useEffect(() => {
    if (mediaUrl && videoRef.current) void videoRef.current.play().catch(() => undefined)
  }, [mediaUrl])

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
      {mediaUrl && <video ref={videoRef} className="player-media" src={mediaUrl} autoPlay muted playsInline />}
      {identify && <div className="identify-overlay">REVEL MOVIES<br /><small>DISPLAY IDENTIFY</small></div>}
    </main>
  )
}
