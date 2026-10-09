import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionState, type HubConnection } from '@microsoft/signalr'
import { createPairingSession, getPairingResult, getPlayerIdentity, mediaContentUrl } from '../api/client'
import { createPlayerConnection, type PlayerCommand } from '../signalr/playerConnection'
import { prepareMediaAssets, registerMediaCache, type CacheCandidate } from './mediaCache'
import { bufferVideoPlayback, canCorrectPlayback } from './videoBuffer'
import { parseAnnouncement, type Announcement } from '../announcements/announcement'
import { AnnouncementSurface } from '../announcements/AnnouncementSurface'
import { VideoRotationCanvas } from './VideoRotationCanvas'
import { needsVideoCanvas } from './videoCanvas'
import {
  configurePromotions, finishPlaylistItem, parsePromotionPolicy, parsePromotionProgress,
  playlistCheckpointKey, preferLocalCheckpoint, readPlaylistCheckpoint, startPromotionProgress,
  type PlaybackItem, type PromotionPolicy, type PromotionProgress,
} from './promotionalBreaks'

const tokenKey = 'revel-movies.device-token'
const processedCommandsKey = 'revel-movies.processed-command-ids'
const reconnectDelayMs = 3000
const clockSyncIntervalMs = 60_000
const playbackReportIntervalMs = 3000

type DisplayRotation = 0 | 90 | 180 | 270

type ActiveMedia = {
  id: string
  type: 'Video' | 'Image'
  instance?: number
}

type PlaylistPlaybackItem = PlaybackItem

type ActivePlaylist = {
  id: string
  playbackId: string
  loop: boolean
  items: PlaylistPlaybackItem[]
}

type PlaybackRecoveryState = {
  announcement: unknown
  promotionPolicy: unknown
  promotionProgress: unknown
  desiredState: string
  contentType: string | null
  payload: Record<string, unknown> | null
  resumePositionSeconds: number | null
  resumePlaylistIndex: number | null
  health: string
  driftMs: number | null
  updatedAt: string
}

type PlaybackReportResult = {
  seekToSeconds: number | null
  driftMs: number | null
  health: string
}

export function PlayerPage() {
  const [pairingCode, setPairingCode] = useState<string>()
  const [deviceToken, setDeviceToken] = useState(() => localStorage.getItem(tokenKey) ?? undefined)
  const [blackout, setBlackout] = useState(false)
  const [identify, setIdentify] = useState(false)
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [rotation, setRotation] = useState<DisplayRotation>(0)
  const [useVideoCanvas] = useState(() => needsVideoCanvas(navigator.userAgent))
  const [media, setMedia] = useState<ActiveMedia>()
  const mediaRef = useRef<ActiveMedia | undefined>(undefined)
  const mediaInstanceRef = useRef(0)
  const setCurrentMedia = useCallback((next: ActiveMedia | undefined) => {
    const current = next ? { ...next, instance: ++mediaInstanceRef.current } : undefined
    mediaRef.current = current
    setMedia(current)
  }, [])
  const [promotionPolicy, setPromotionPolicy] = useState<PromotionPolicy | null>(null)
  const promotionPolicyRef = useRef<PromotionPolicy | null>(null)
  const promotionProgressRef = useRef<PromotionProgress | null>(null)
  const playbackControlRevisionRef = useRef(0)
  const recoveryPendingRef = useRef(true)
  const clearPromotionProgress = useCallback(() => {
    promotionProgressRef.current = null
    try { localStorage.removeItem(playlistCheckpointKey) } catch { /* Storage is optional. */ }
  }, [])
  const [playlist, setPlaylist] = useState<ActivePlaylist>()
  const [playlistIndex, setPlaylistIndex] = useState(0)
  const [playlistPaused, setPlaylistPaused] = useState(false)
  const [mediaLoop, setMediaLoop] = useState(false)
  const [playbackEnded, setPlaybackEnded] = useState(false)
  const loopRef = useRef(false)
  const pausedPositionSecondsRef = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const bufferingRef = useRef(false)
  const connectionRef = useRef<HubConnection | null>(null)
  const clockOffsetMsRef = useRef(0)
  const getServerNow = useCallback(() => Date.now() + clockOffsetMsRef.current, [])
  const scheduledStartTimerRef = useRef<number | undefined>(undefined)
  const pendingSeekSecondsRef = useRef<number | undefined>(undefined)
  const itemStartedAtRef = useRef(Date.now())

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
            if (cancelled || !result.isPaired || !result.deviceToken) return

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
    let recoveryRetryTimer: number | undefined
    let connection: HubConnection
    let announcementRevision = 0
    let promotionRevision = 0

    function applyPromotionPolicy(policy: PromotionPolicy | null) {
      promotionPolicyRef.current = policy
      setPromotionPolicy(policy)
      if (promotionProgressRef.current)
        promotionProgressRef.current = configurePromotions(promotionProgressRef.current, policy)
      if (policy?.enabled) void prepareMediaAssets(policy.items).catch(error => console.error('Promotion preparation failed:', error))
    }

    const acknowledge = (command: PlayerCommand, status: string, detail?: string) => {
      if (cancelled || !connection || connection.state !== HubConnectionState.Connected) return
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

    const resetPairing = () => {
      if (cancelled) return
      cancelled = true
      clearScheduledStart()
      videoRef.current?.pause()
      pendingSeekSecondsRef.current = undefined
      clockOffsetMsRef.current = 0
      localStorage.removeItem(tokenKey)
      localStorage.removeItem(processedCommandsKey)
      clearPromotionProgress()
      applyPromotionPolicy(null)
      setCurrentMedia(undefined)
      setPlaylist(undefined)
      setPlaylistIndex(0)
      setPlaylistPaused(false)
      setPlaybackEnded(false)
      setAnnouncement(null)
      setBlackout(false)
      setIdentify(false)
      setRotation(0)
      setPairingCode(undefined)
      setDeviceToken(undefined)
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

    function applyRecovery(recovery: PlaybackRecoveryState | null, recoveredAnnouncementRevision: number, recoveredPromotionRevision: number) {
      if (!recovery) return
      clearScheduledStart()
      // A live command received during recovery takes precedence over the older snapshot.
      if (announcementRevision === recoveredAnnouncementRevision)
        setAnnouncement(parseAnnouncement(recovery.announcement))
      if (promotionRevision === recoveredPromotionRevision)
        applyPromotionPolicy(parsePromotionPolicy(recovery.promotionPolicy))

      if (recovery.desiredState === 'Blackout') {
        setBlackout(true)
        return
      }

      if (recovery.desiredState === 'Stopped') {
        clearPromotionProgress()
        videoRef.current?.pause()
        setPlaybackEnded(false)
        setPlaylist(undefined)
        setPlaylistIndex(0)
        setPlaylistPaused(false)
        setCurrentMedia(undefined)
        setBlackout(false)
        return
      }

      const payload = recovery.payload ?? undefined
      const resumePosition = Math.max(0, recovery.resumePositionSeconds ?? 0)
      loopRef.current = payload?.loop === true
      setMediaLoop(loopRef.current)
      setPlaybackEnded(false)
      pausedPositionSecondsRef.current = resumePosition
      pendingSeekSecondsRef.current = resumePosition
      itemStartedAtRef.current = Date.now() - resumePosition * 1000
      setBlackout(false)
      setPlaylistPaused(recovery.desiredState === 'Paused')

      if (recovery.contentType === 'Media') {
        const candidate = parseMediaCandidate(payload)
        if (!candidate) return
        clearPromotionProgress()
        setPlaylist(undefined)
        setPlaylistIndex(0)
        setCurrentMedia({ id: candidate.mediaId, type: candidate.mediaType })
        return
      }

      if (recovery.contentType === 'Playlist') {
        const playlistId = payload?.playlistId
        const items = parsePlaylistItems(payload?.items)
        if (typeof playlistId !== 'string' || items.length === 0) return

        const playbackId = typeof payload?.playbackId === 'string' ? payload.playbackId : playlistId
        let index = Math.min(Math.max(0, recovery.resumePlaylistIndex ?? 0), items.length - 1)
        let progress = parsePromotionProgress(recovery.promotionProgress)
        if (progress?.playbackId !== playbackId) progress = null
        const local = readPlaylistCheckpoint(localStorage)
        if (preferLocalCheckpoint(local, playbackId, progress, Date.parse(recovery.updatedAt), items.length)) {
          progress = local.progress
          index = local.playlistIndex
          pendingSeekSecondsRef.current = local.positionSeconds
          pausedPositionSecondsRef.current = local.positionSeconds
          itemStartedAtRef.current = Date.now() - local.positionSeconds * 1000
          setPlaybackEnded(local.ended)
          if (local.ended) setPlaylistPaused(true)
        }
        progress = configurePromotions(progress ?? startPromotionProgress(playbackId, promotionPolicyRef.current), promotionPolicyRef.current)
        promotionProgressRef.current = progress
        setPlaylist({ id: playlistId, playbackId, loop: payload?.loop === true, items })
        setPlaylistIndex(index)
        setCurrentMedia(progress.activeMediaId ? { id: progress.activeMediaId, type: 'Video' }
          : { id: items[index].mediaId, type: items[index].mediaType })
      }
    }

    async function handleCommand(command: PlayerCommand) {
      if (cancelled || wasCommandProcessed(command.commandId)) return
      if (command.type === 'display.unpaired') {
        resetPairing()
        return
      }
      markCommandProcessed(command.commandId)
      acknowledge(command, 'received')
      if (['playback.resume', 'playback.loop', 'media.play', 'playlist.play', 'media.pause', 'playlist.pause',
        'media.stop', 'playlist.stop', 'display.blackout'].includes(command.type)) playbackControlRevisionRef.current++

      switch (command.type) {
        case 'playback.resume': {
          const recovery = command.payload
          if (recovery?.desiredState !== 'Playing' || !recovery.payload ||
            (recovery.contentType !== 'Media' && recovery.contentType !== 'Playlist')) {
            acknowledge(command, 'error', 'invalid playback.resume payload')
            break
          }
          // Playback controls leave the independent announcement untouched.
          applyRecovery(recovery as PlaybackRecoveryState, -1, promotionRevision)
          acknowledge(command, 'executed')
          break
        }
        case 'playback.loop': {
          const loop = command.payload?.loop
          if (typeof loop !== 'boolean') {
            acknowledge(command, 'error', 'invalid playback.loop payload')
            break
          }
          loopRef.current = loop
          setMediaLoop(loop)
          setPlaylist(current => current ? { ...current, loop } : current)
          acknowledge(command, 'executed')
          break
        }
        case 'announcement.show': {
          const next = parseAnnouncement(command.payload)
          if (!next) {
            acknowledge(command, 'error', 'invalid announcement.show payload')
            break
          }
          announcementRevision++
          setAnnouncement(next)
          acknowledge(command, 'executed')
          break
        }
        case 'announcement.clear':
          announcementRevision++
          setAnnouncement(null)
          acknowledge(command, 'executed')
          break
        case 'promotions.configure': {
          const policy = parsePromotionPolicy(command.payload)
          if (!policy) {
            acknowledge(command, 'error', 'invalid promotions.configure payload')
            break
          }
          promotionRevision++
          applyPromotionPolicy(policy)
          acknowledge(command, 'executed')
          break
        }
        case 'display.settings': {
          const nextRotation = parseRotation(command.payload?.rotation)
          if (nextRotation === null) {
            acknowledge(command, 'error', 'invalid display.settings rotation')
            break
          }
          setRotation(nextRotation)
          acknowledge(command, 'executed')
          break
        }
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

          loopRef.current = command.payload?.loop === true
          setMediaLoop(loopRef.current)
          acknowledge(command, 'ready', `scheduled; offset ${clockOffsetMsRef.current.toFixed(1)}ms`)
          scheduleAtServerTime(command.payload?.startAt, () => {
            clearPromotionProgress()
            pendingSeekSecondsRef.current = 0
            itemStartedAtRef.current = Date.now()
            setPlaylist(undefined)
            setPlaylistIndex(0)
            setPlaylistPaused(false)
            setPlaybackEnded(false)
            setBlackout(false)
            setCurrentMedia({ id: candidate.mediaId, type: candidate.mediaType })
            acknowledge(command, 'executed')
          })
          break
        }
        case 'media.pause':
        case 'playlist.pause':
          clearScheduledStart()
          pausedPositionSecondsRef.current = videoRef.current?.currentTime ?? Math.max(0, (Date.now() - itemStartedAtRef.current) / 1000)
          videoRef.current?.pause()
          setPlaylistPaused(true)
          acknowledge(command, 'executed')
          break
        case 'media.stop':
        case 'playlist.stop':
          clearPromotionProgress()
          clearScheduledStart()
          videoRef.current?.pause()
          setPlaylist(undefined)
          setPlaylistIndex(0)
          setPlaylistPaused(false)
          setPlaybackEnded(false)
          setCurrentMedia(undefined)
          setBlackout(false)
          acknowledge(command, 'executed')
          break
        case 'playlist.play': {
          const playlistId = command.payload?.playlistId
          const items = parsePlaylistItems(command.payload?.items)
          if (typeof playlistId !== 'string' || items.length === 0) {
            acknowledge(command, 'error', 'invalid playlist.play payload')
            break
          }

          const nextPlaylist: ActivePlaylist = {
            id: playlistId,
            playbackId: typeof command.payload?.playbackId === 'string' ? command.payload.playbackId : playlistId,
            loop: command.payload?.loop === true,
            items,
          }
          loopRef.current = nextPlaylist.loop
          setMediaLoop(false)

          acknowledge(command, 'ready', `scheduled; offset ${clockOffsetMsRef.current.toFixed(1)}ms`)
          scheduleAtServerTime(command.payload?.startAt, () => {
            clearPromotionProgress()
            promotionProgressRef.current = startPromotionProgress(nextPlaylist.playbackId, promotionPolicyRef.current)
            pendingSeekSecondsRef.current = 0
            itemStartedAtRef.current = Date.now()
            setPlaylist({ ...nextPlaylist, loop: loopRef.current })
            setPlaylistIndex(0)
            setPlaylistPaused(false)
            setPlaybackEnded(false)
            setBlackout(false)
            setCurrentMedia({ id: items[0].mediaId, type: items[0].mediaType })
            acknowledge(command, 'executed')
          })
          break
        }
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
    connectionRef.current = connection

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

    async function refreshDisplaySettings() {
      const identity = await getPlayerIdentity(currentDeviceToken)
      if (cancelled) return false
      if (!identity) {
        resetPairing()
        return false
      }

      setRotation(parseRotation(identity.rotation) ?? 0)
      return true
    }

    async function recoverDesiredPlayback() {
      if (recoveryRetryTimer !== undefined) window.clearTimeout(recoveryRetryTimer)
      recoveryRetryTimer = undefined
      recoveryPendingRef.current = true
      try {
        if (!await refreshDisplaySettings()) return
        await synchronizeClock(3)
        if (cancelled) return
        const recoveredAnnouncementRevision = announcementRevision
        const recoveredPromotionRevision = promotionRevision
        const recoveredPlaybackRevision = playbackControlRevisionRef.current
        const recovery = await connection.invoke<PlaybackRecoveryState | null>('GetDesiredPlaybackState')
        if (cancelled) return
        if (recoveredPlaybackRevision === playbackControlRevisionRef.current)
          applyRecovery(recovery, recoveredAnnouncementRevision, recoveredPromotionRevision)
        else if (recovery) {
          // A newer play command does not invalidate independently saved settings.
          if (announcementRevision === recoveredAnnouncementRevision) setAnnouncement(parseAnnouncement(recovery.announcement))
          if (promotionRevision === recoveredPromotionRevision) applyPromotionPolicy(parsePromotionPolicy(recovery.promotionPolicy))
        }
        recoveryPendingRef.current = false
      } catch (error) {
        // Do not publish an empty/old cursor when recovery failed.
        if (!cancelled) {
          console.error('Playback recovery failed; retrying:', error)
          recoveryRetryTimer = window.setTimeout(() => {
            recoveryRetryTimer = undefined
            if (connection.state === HubConnectionState.Connected) void recoverDesiredPlayback()
          }, reconnectDelayMs)
        }
      }
    }

    async function start() {
      if (cancelled || connection.state !== HubConnectionState.Disconnected) return

      try {
        const identity = await getPlayerIdentity(currentDeviceToken)
        if (cancelled) return

        if (!identity) {
          resetPairing()
          return
        }

        setRotation(parseRotation(identity.rotation) ?? 0)
        await connection.start()
        if (cancelled) return

        await recoverDesiredPlayback()
        if (cancelled) return

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

    connection.onreconnected(() => {
      void recoverDesiredPlayback().catch(error => {
        if (!cancelled) console.error('Player recovery after reconnect failed:', error)
      })
    })
    connection.onclose(() => scheduleStart())

    const startTimer = window.setTimeout(() => void start(), 0)

    return () => {
      cancelled = true
      window.clearTimeout(startTimer)
      clearScheduledStart()
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      if (recoveryRetryTimer !== undefined) window.clearTimeout(recoveryRetryTimer)
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer)
      if (clockSyncTimer !== undefined) window.clearInterval(clockSyncTimer)
      connectionRef.current = null
      void connection.stop().catch(error => console.error('Player connection failed to stop:', error))
    }
  }, [deviceToken])

  const advancePlaylist = useCallback(() => {
    if (!playlist || playlistPaused || playlist.items.length === 0 || mediaRef.current !== media) return
    const next = finishPlaylistItem(
      promotionProgressRef.current ?? startPromotionProgress(playlist.playbackId, promotionPolicyRef.current),
      promotionPolicyRef.current, playlist, playlistIndex,
    )
    promotionProgressRef.current = next.progress
    if (next.ended) {
      // Leave a checkpoint for the final main item, including after a final promotion.
      pendingSeekSecondsRef.current = 0
      pausedPositionSecondsRef.current = 0
      setCurrentMedia({ id: next.mediaId, type: next.mediaType })
      setPlaylistPaused(true)
      setPlaybackEnded(true)
      return
    }
    pendingSeekSecondsRef.current = 0
    itemStartedAtRef.current = Date.now()
    setPlaylistIndex(next.playlistIndex)
    setCurrentMedia({ id: next.mediaId, type: next.mediaType })
  }, [playlist, playlistIndex, playlistPaused, media, setCurrentMedia])

  useEffect(() => {
    if (!media || promotionProgressRef.current?.activeMediaId !== media.id || playlistPaused) return
    let lastPosition = videoRef.current?.currentTime ?? 0
    let lastProgressAt = Date.now()
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (video && video.currentTime !== lastPosition) {
        lastPosition = video.currentTime
        lastProgressAt = Date.now()
      }
      if (Date.now() - lastProgressAt >= 30_000) {
        console.warn('Skipping promotion after 30 seconds without playback progress:', media.id)
        advancePlaylist()
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [media, playlistPaused, advancePlaylist])

  useEffect(() => {
    bufferingRef.current = false
    if (media?.type !== 'Video' || !videoRef.current) return

    const video = videoRef.current
    const applyPendingSeek = () => {
      const seek = pendingSeekSecondsRef.current
      if (seek !== undefined && video.readyState >= 1) {
        const maxSeek = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : seek
        video.currentTime = Math.min(Math.max(0, seek), maxSeek)
        pendingSeekSecondsRef.current = undefined
      }
    }

    video.addEventListener('loadedmetadata', applyPendingSeek)
    applyPendingSeek()
    if (playlistPaused) video.pause()
    const stopBuffering = playlistPaused ? undefined : bufferVideoPlayback(video, buffering => {
      bufferingRef.current = buffering
    })

    return () => {
      video.removeEventListener('loadedmetadata', applyPendingSeek)
      stopBuffering?.()
    }
  }, [media, playlistPaused])

  useEffect(() => {
    if (!playlist || playlistPaused || media?.type !== 'Image') return

    const current = playlist.items[playlistIndex]
    if (!current) return

    const durationMs = Math.max(0.5, current.durationSeconds ?? 10) * 1000
    const elapsedMs = Math.max(0, Date.now() - itemStartedAtRef.current)
    const timer = window.setTimeout(advancePlaylist, Math.max(100, durationMs - elapsedMs))
    return () => window.clearTimeout(timer)
  }, [advancePlaylist, media, playlist, playlistIndex, playlistPaused])

  useEffect(() => {
    if (!deviceToken) return
    let cancelled = false

    async function reportPlayback() {
      if (mediaRef.current !== media && !playbackEnded) return
      const video = videoRef.current

      const positionSeconds = media?.type === 'Video'
        ? Math.max(0, pendingSeekSecondsRef.current ?? videoRef.current?.currentTime ?? 0)
        : playlistPaused ? pausedPositionSecondsRef.current : Math.max(0, (Date.now() - itemStartedAtRef.current) / 1000)
      const durationSeconds = media?.type === 'Video' && Number.isFinite(videoRef.current?.duration)
        ? videoRef.current?.duration ?? null
        : null
      const buffering = media?.type === 'Video' &&
        (bufferingRef.current || !video || video.paused || video.seeking || video.readyState < 3)
      const actualState = blackout ? 'Blackout' : playbackEnded ? 'Ended' : !media ? 'Idle'
        : playlistPaused ? 'Paused' : buffering ? 'Buffering' : 'Playing'

      const progress = playlist && promotionProgressRef.current
        ? { ...promotionProgressRef.current, sequence: promotionProgressRef.current.sequence + 1 } : null
      if (progress) {
        promotionProgressRef.current = progress
        try {
          localStorage.setItem(playlistCheckpointKey, JSON.stringify({
            progress, playlistIndex, positionSeconds, capturedAt: getServerNow(), ended: playbackEnded,
          }))
        } catch { /* SQL recovery remains available when browser storage is full or disabled. */ }
      }

      const connection = connectionRef.current
      if (!connection || connection.state !== HubConnectionState.Connected || recoveryPendingRef.current) return

      try {
        const result = progress ? await connection.invoke<PlaybackReportResult | null>(
          'ReportPlaylistPlayback', {
            state: actualState, mediaAssetId: media?.id ?? null, playlistId: playlist?.id ?? null,
            playlistIndex, positionSeconds, durationSeconds,
          }, progress,
        ) : await connection.invoke<PlaybackReportResult | null>(
          'ReportPlayback',
          actualState,
          media?.id ?? null,
          playlist?.id ?? null,
          playlist ? playlistIndex : null,
          positionSeconds,
          durationSeconds,
        )

        if (!cancelled && result?.seekToSeconds !== null && result?.seekToSeconds !== undefined &&
          media?.type === 'Video' && video && videoRef.current === video && !playlistPaused && !bufferingRef.current) {
          const maxSeek = Number.isFinite(video.duration)
            ? Math.max(0, video.duration - 0.05)
            : result.seekToSeconds
          const target = Math.min(Math.max(0, result.seekToSeconds), maxSeek)
          if (canCorrectPlayback(video, target)) video.currentTime = target
        }
      } catch (error) {
        console.error('Playback telemetry failed:', error)
      }
    }

    void reportPlayback()
    const timer = window.setInterval(() => void reportPlayback(), playbackReportIntervalMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [blackout, deviceToken, media, playlist, playlistIndex, playlistPaused, playbackEnded, promotionPolicy, getServerNow])

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
      <div className={`player-viewport rotation-${rotation}`}>
        {media?.type === 'Video' && (
          <video
            key={media.instance}
            ref={videoRef}
            className="player-media"
            hidden={playbackEnded && !!playlist}
            src={mediaContentUrl(media.id)}
            preload="auto"
            loop={!playlist && mediaLoop}
            muted
            playsInline
            onEnded={() => {
              if (playlist) advancePlaylist()
              else setPlaybackEnded(true)
            }}
            onError={() => {
              if (promotionProgressRef.current?.activeMediaId === media.id) advancePlaylist()
            }}
          />
        )}
        {useVideoCanvas && rotation !== 0 && media?.type === 'Video' && !blackout && !(playbackEnded && playlist) && (
          <VideoRotationCanvas key={`rotation-${media.instance}`} videoRef={videoRef} />
        )}
        {media?.type === 'Image' && (
          <img key={media.id} className="player-media" hidden={playbackEnded && !!playlist} src={mediaContentUrl(media.id)} alt="" />
        )}
        {identify && <div className="identify-overlay">REVEL MOVIES<br /><small>DISPLAY IDENTIFY</small></div>}
        {announcement && !blackout && <AnnouncementSurface announcement={announcement} getNow={getServerNow} />}
      </div>
    </main>
  )
}

function parseRotation(value: unknown): DisplayRotation | null {
  if (value === 0 || value === 90 || value === 180 || value === 270)
    return value

  return null
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

function wasCommandProcessed(commandId: string) {
  return readProcessedCommandIds().includes(commandId)
}

function markCommandProcessed(commandId: string) {
  const ids = readProcessedCommandIds().filter(id => id !== commandId)
  ids.push(commandId)
  localStorage.setItem(processedCommandsKey, JSON.stringify(ids.slice(-100)))
}

function readProcessedCommandIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(processedCommandsKey) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
