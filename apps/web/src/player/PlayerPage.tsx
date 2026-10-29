import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionState, type HubConnection } from '@microsoft/signalr'
import { createPairingSession, getPairingResult, getPlayerIdentity, mediaContentUrl } from '../api/client'
import { createPlayerConnection, type PlayerCommand } from '../signalr/playerConnection'
import { prepareMediaAssets, registerMediaCache, type CacheCandidate } from './mediaCache'
import { bufferVideoPlayback, canCorrectPlayback, recoverVideoPlayback } from './videoBuffer'
import { parseAnnouncement, type Announcement } from '../announcements/announcement'
import { AnnouncementSurface } from '../announcements/AnnouncementSurface'
import { parseWebPage, type WebPage } from '../webpages/webPage'
import { WebPageSurface } from '../webpages/WebPageSurface'
import { VideoRotationCanvas } from './VideoRotationCanvas'
import { needsVideoCanvas } from './videoCanvas'
import { isSceneExpired, PlayerOperationGuard, resolveSceneReturn, type SceneComposition } from './preparationStatus'
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
  commandId?: string | null
  revision?: number
  blackout?: boolean
  sceneExpiresAt?: string | null
  sceneSessionId?: string | null
  scenePrevious?: PlaybackRecoveryState | null
  sceneComposition?: SceneComposition | null
  webPage: unknown
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
  const [displayIdentity, setDisplayIdentity] = useState({ id: '', name: 'Pantalla Revel' })
  const [webPage, setWebPage] = useState<WebPage | null>(null)
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [rotation, setRotation] = useState<DisplayRotation>(0)
  const [useVideoCanvas] = useState(() => needsVideoCanvas(navigator.userAgent))
  const [media, setMedia] = useState<ActiveMedia>()
  const [mediaLoadStatus, setMediaLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const mediaRef = useRef<ActiveMedia | undefined>(undefined)
  const mediaInstanceRef = useRef(0)
  const stopVideoPlaybackRef = useRef<(() => void) | undefined>(undefined)
  const setCurrentMedia = useCallback((next: ActiveMedia | undefined) => {
    stopVideoPlaybackRef.current?.()
    const current = next ? { ...next, instance: ++mediaInstanceRef.current } : undefined
    mediaRef.current = current
    setMediaLoadStatus('loading')
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
  const [playlistPaused, setPlaylistPausedState] = useState(false)
  const setPlaylistPaused = useCallback((paused: boolean) => {
    // Cancel before React commits; metadata/timers must not undo an operator pause.
    if (paused) stopVideoPlaybackRef.current?.()
    setPlaylistPausedState(paused)
  }, [])
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
  const appliedCommandRef = useRef<{ commandId: string | null; revision: number | null }>({ commandId: null, revision: null })
  const operationGuardRef = useRef(new PlayerOperationGuard())
  const activeSceneRecoveryRef = useRef<Pick<PlaybackRecoveryState, 'sceneSessionId' | 'sceneExpiresAt' | 'scenePrevious' | 'sceneComposition'> | null>(null)
  const currentSnapshotRef = useRef<PlaybackRecoveryState | null>(null)
  currentSnapshotRef.current = {
    commandId: appliedCommandRef.current.commandId, revision: appliedCommandRef.current.revision ?? undefined,
    blackout, webPage, announcement, promotionPolicy, promotionProgress: promotionProgressRef.current,
    desiredState: playbackEnded ? 'Stopped' : playlistPaused ? 'Paused' : media ? 'Playing' : 'Stopped',
    contentType: playlist ? 'Playlist' : media ? 'Media' : null,
    payload: playlist ? { playlistId: playlist.id, playbackId: playlist.playbackId, items: playlist.items, loop: playlist.loop }
      : media ? { mediaId: media.id, mediaType: media.type, loop: mediaLoop } : null,
    resumePositionSeconds: 0, resumePlaylistIndex: playlist ? playlistIndex : null,
    health: 'Unknown', driftMs: null, updatedAt: new Date(getServerNow()).toISOString(),
  }

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
    let identifyTimer: number | undefined
    let sceneExpiryTimer: number | undefined
    let connection: HubConnection
    let webPageRevision = 0
    let announcementRevision = 0
    let promotionRevision = 0
    let reconcileAfterScheduled = false
    let scheduledSceneSessionId: string | null = null
    const guard = operationGuardRef.current

    function applyPromotionPolicy(policy: PromotionPolicy | null) {
      promotionPolicyRef.current = policy
      setPromotionPolicy(policy)
      if (promotionProgressRef.current)
        promotionProgressRef.current = configurePromotions(promotionProgressRef.current, policy)
      if (policy?.enabled) void prepareMediaAssets(policy.items).catch(error => console.error('Promotion preparation failed:', error))
    }

    const acknowledge = (command: PlayerCommand, status: string, detail?: string) => {
      if ((status === 'executed' || status === 'applied') && isVisualCommand(command.type)) {
        const recovery = command.payload?.recovery as PlaybackRecoveryState | undefined
        appliedCommandRef.current = { commandId: command.commandId,
          revision: command.revision ?? recovery?.revision ?? (typeof command.payload?.revision === 'number' ? command.payload.revision : null) }
      }
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
      scheduledSceneSessionId = null
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
      appliedCommandRef.current = { commandId: null, revision: null }
      operationGuardRef.current = new PlayerOperationGuard()
      activeSceneRecoveryRef.current = null
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
      setWebPage(null)
      setBlackout(false)
      setIdentify(false)
      setRotation(0)
      setPairingCode(undefined)
      setDeviceToken(undefined)
    }

    const scheduleAtServerTime = (startAt: unknown, callback: () => void, sceneSessionId?: string) => {
      clearScheduledStart()
      scheduledSceneSessionId = sceneSessionId ?? null
      const startAtMs = typeof startAt === 'string' ? Date.parse(startAt) : Number.NaN
      if (!Number.isFinite(startAtMs)) {
        scheduledSceneSessionId = null
        callback()
        flushPendingReconciliation()
        return
      }

      const localTargetMs = startAtMs - clockOffsetMsRef.current
      const delayMs = Math.max(0, localTargetMs - Date.now())
      scheduledStartTimerRef.current = window.setTimeout(() => {
        scheduledStartTimerRef.current = undefined
        scheduledSceneSessionId = null
        callback()
        flushPendingReconciliation()
      }, delayMs)
    }

    function flushPendingReconciliation() {
      if (!reconcileAfterScheduled || scheduledStartTimerRef.current !== undefined) return
      reconcileAfterScheduled = false
      if (!cancelled && connection.state === HubConnectionState.Connected) void recoverDesiredPlayback(true)
    }

    async function prepareCandidates(command: PlayerCommand, candidates: CacheCandidate[], networkRequired = false) {
      const generation = guard.beginPreparation()
      try {
        const result = await prepareMediaAssets(candidates, networkRequired)
        if (!guard.isCurrentPreparation(generation) || cancelled) return
        acknowledge(command, result.status, result.detail)
      } catch (error) {
        if (!guard.isCurrentPreparation(generation) || cancelled) return
        acknowledge(command, 'error', error instanceof Error ? error.message : 'media preparation failed')
      }
    }

    function applyRecovery(recovery: PlaybackRecoveryState | null, recoveredAnnouncementRevision: number, recoveredPromotionRevision: number, recoveredWebPageRevision = -1, keepMedia = false) {
      if (!recovery) return
      if (isSceneExpired(recovery.sceneExpiresAt, getServerNow())) return
      clearScheduledStart()
      if (sceneExpiryTimer !== undefined) window.clearTimeout(sceneExpiryTimer)
      sceneExpiryTimer = undefined
      appliedCommandRef.current = { commandId: recovery.commandId ?? null, revision: recovery.revision ?? null }
      activeSceneRecoveryRef.current = recovery.sceneSessionId ? {
        sceneSessionId: recovery.sceneSessionId, sceneExpiresAt: recovery.sceneExpiresAt,
        scenePrevious: recovery.scenePrevious, sceneComposition: recovery.sceneComposition,
      } : null
      if (recovery.sceneSessionId) {
        const sessionId = recovery.sceneSessionId
        guard.activateSession(sessionId)
        if (recovery.sceneExpiresAt) {
          sceneExpiryTimer = window.setTimeout(() => {
            sceneExpiryTimer = undefined
            if (cancelled || !guard.isActiveSession(sessionId)) return
            const previous = resolveSceneReturn(recovery, getServerNow())
            if (previous) {
              applyRecovery(previous.recovery,
                previous.composition.announcement === 'keep' ? -1 : announcementRevision,
                previous.composition.promotions === 'keep' ? -1 : promotionRevision,
                previous.composition.webPage === 'keep' ? -1 : webPageRevision,
                previous.composition.media === 'keep')
              appliedCommandRef.current = { commandId: null, revision: null }
            }
            if (connection.state === HubConnectionState.Connected) void recoverDesiredPlayback()
          }, Math.max(0, Math.min(Date.parse(recovery.sceneExpiresAt) - getServerNow(), 2_147_483_647)))
        }
      } else guard.clearActiveSession()
      // A live command received during recovery takes precedence over the older snapshot.
      if (webPageRevision === recoveredWebPageRevision)
        setWebPage(parseWebPage(recovery.webPage, window.location.href))
      if (announcementRevision === recoveredAnnouncementRevision)
        setAnnouncement(parseAnnouncement(recovery.announcement))
      if (promotionRevision === recoveredPromotionRevision)
        applyPromotionPolicy(parsePromotionPolicy(recovery.promotionPolicy))

      setBlackout(recovery.blackout === true || recovery.desiredState === 'Blackout')
      if (keepMedia) return

      if (recovery.desiredState === 'Stopped') {
        clearPromotionProgress()
        videoRef.current?.pause()
        setPlaybackEnded(false)
        setPlaylist(undefined)
        setPlaylistIndex(0)
        setPlaylistPaused(false)
        setCurrentMedia(undefined)
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
      // Restore belongs to the activation that captured the previous state. A later
      // manual decision must never be replaced by its delayed automatic return.
      if (command.type === 'scene.restore' && typeof command.payload?.sessionId === 'string' &&
        !guard.isActiveSession(command.payload.sessionId) && scheduledSceneSessionId !== command.payload.sessionId) {
        acknowledge(command, 'superseded', 'Una acción posterior reemplazó esta escena')
        return
      }
      let decision: number | null = null
      if (isVisualCommand(command.type)) {
        decision = guard.nextDecision(command.revision)
        if (decision === null) {
          acknowledge(command, 'superseded', 'Versión anterior a la decisión vigente')
          return
        }
        // The API composes desired layers immediately. If a newer control arrives
        // before a scheduled scene, recover that current composition after the new
        // decision; never run the canceled scene payload over the newer command.
        if (scheduledStartTimerRef.current !== undefined) reconcileAfterScheduled = true
        clearScheduledStart()
        if (sceneExpiryTimer !== undefined) window.clearTimeout(sceneExpiryTimer)
        sceneExpiryTimer = undefined
        if (command.type !== 'scene.apply') activeSceneRecoveryRef.current = null
        playbackControlRevisionRef.current++
      }
      markCommandProcessed(command.commandId)
      acknowledge(command, 'received')

      switch (command.type) {
        case 'scene.prepare': {
          const resources = command.payload?.resources
          if (!Array.isArray(resources) || typeof command.payload?.sessionId !== 'string') {
            acknowledge(command, 'error', 'La preparación no tiene recursos o sesión válida')
            break
          }
          const candidates = resources.map(item => parseMediaCandidate(item as Record<string, unknown>)).filter(item => item !== null)
          if (candidates.length !== resources.length) {
            acknowledge(command, 'error', 'Hay recursos inválidos en la escena')
            break
          }
          await prepareCandidates(command, candidates, command.payload?.networkRequired === true)
          break
        }
        case 'scene.apply':
        case 'scene.restore': {
          const recovery = command.payload?.recovery as PlaybackRecoveryState | undefined
          const composition = parseSceneComposition(command.payload?.composition)
          const sessionId = command.payload?.sessionId
          const expiresAt = command.payload?.expiresAt
          if (!recovery || !composition || typeof sessionId !== 'string' || decision === null) {
            acknowledge(command, 'error', 'Configuración de escena inválida')
            break
          }
          if (command.type === 'scene.apply' && isSceneExpired(expiresAt, getServerNow())) {
            acknowledge(command, 'expired', 'La escena temporal venció antes de llegar a esta pantalla')
            void recoverDesiredPlayback()
            break
          }
          const generation = decision
          scheduleAtServerTime(command.payload?.startAt, () => {
            if (cancelled || !guard.isCurrentDecision(generation)) return
            if (command.type === 'scene.apply' && isSceneExpired(expiresAt, getServerNow())) {
              acknowledge(command, 'expired', 'La escena temporal ya venció')
              void recoverDesiredPlayback()
              return
            }
            let appliedRecovery = recovery
            if (command.type === 'scene.apply') {
              const snapshot = currentSnapshotRef.current
              const previous = snapshot ? { ...snapshot, ...activeSceneRecoveryRef.current, promotionProgress: promotionProgressRef.current,
                resumePositionSeconds: snapshot.desiredState === 'Paused' ? pausedPositionSecondsRef.current
                  : mediaRef.current?.type === 'Video' ? pendingSeekSecondsRef.current ?? videoRef.current?.currentTime ?? 0
                    : Math.max(0, (Date.now() - itemStartedAtRef.current) / 1000),
              } : null
              appliedRecovery = { ...recovery, sceneSessionId: sessionId,
                sceneExpiresAt: typeof expiresAt === 'string' ? expiresAt : null,
                scenePrevious: previous ?? recovery.scenePrevious, sceneComposition: composition }
            }
            // The recovery payload already contains the resolved keep/replace/remove
            // layers. Keeping media avoids remounting the video under an overlay.
            if (composition.webPage !== 'keep') webPageRevision++
            if (composition.announcement !== 'keep') announcementRevision++
            if (composition.promotions !== 'keep') promotionRevision++
            applyRecovery(appliedRecovery,
              composition.announcement === 'keep' ? -1 : announcementRevision,
              composition.promotions === 'keep' ? -1 : promotionRevision,
              composition.webPage === 'keep' ? -1 : webPageRevision,
              composition.media === 'keep')
            acknowledge(command, 'applied', 'Capas aplicadas; la reproducción se confirma por telemetría')
          }, command.type === 'scene.apply' ? sessionId : undefined)
          break
        }
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
        case 'webpage.show': {
          const next = parseWebPage(command.payload, window.location.href)
          if (!next) {
            acknowledge(command, 'error', 'invalid or unsafe webpage URL for this player origin')
            break
          }
          webPageRevision++
          setWebPage(next)
          acknowledge(command, 'executed', 'iframe assigned; remote loading is controlled by the website')
          break
        }
        case 'webpage.clear':
          webPageRevision++
          setWebPage(null)
          acknowledge(command, 'executed')
          break
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
          if (nextRotation === null && typeof command.payload?.name !== 'string') {
            acknowledge(command, 'error', 'invalid display.settings rotation')
            break
          }
          if (nextRotation !== null) setRotation(nextRotation)
          if (typeof command.payload?.name === 'string') setDisplayIdentity(current => ({ ...current, name: command.payload!.name as string }))
          acknowledge(command, 'executed')
          break
        }
        case 'display.blackout':
          clearScheduledStart()
          setBlackout(true)
          acknowledge(command, 'executed')
          break
        case 'display.restore':
          setBlackout(false)
          acknowledge(command, 'executed', 'Imagen restaurada; el contenido de fondo continúa')
          break
        case 'display.identify': {
          const name = command.payload?.name
          const id = command.payload?.displayId
          if (typeof name === 'string' || typeof id === 'string')
            setDisplayIdentity(current => ({ name: typeof name === 'string' ? name : current.name, id: typeof id === 'string' ? id : current.id }))
          setIdentify(true)
          if (identifyTimer !== undefined) window.clearTimeout(identifyTimer)
          identifyTimer = window.setTimeout(() => { setIdentify(false); identifyTimer = undefined }, 5000)
          acknowledge(command, 'executed')
          break
        }
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
          pausedPositionSecondsRef.current = mediaRef.current?.type === 'Video'
            ? pendingSeekSecondsRef.current ?? videoRef.current?.currentTime ?? 0
            : Math.max(0, (Date.now() - itemStartedAtRef.current) / 1000)
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
      flushPendingReconciliation()
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
      setDisplayIdentity({ id: identity.id, name: identity.name })
      return true
    }

    async function recoverDesiredPlayback(preserveMatchingBackground = false) {
      if (recoveryRetryTimer !== undefined) window.clearTimeout(recoveryRetryTimer)
      recoveryRetryTimer = undefined
      recoveryPendingRef.current = true
      try {
        if (!await refreshDisplaySettings()) return
        await synchronizeClock(3)
        if (cancelled) return
        const recoveredWebPageRevision = webPageRevision
        const recoveredAnnouncementRevision = announcementRevision
        const recoveredPromotionRevision = promotionRevision
        const recoveredPlaybackRevision = playbackControlRevisionRef.current
        const recovery = await connection.invoke<PlaybackRecoveryState | null>('GetDesiredPlaybackState')
        if (cancelled) return
        if (recoveredPlaybackRevision === playbackControlRevisionRef.current) {
          const unchanged = recovery?.commandId === appliedCommandRef.current.commandId
          const accepted = unchanged || recovery?.revision === undefined || guard.nextDecision(recovery.revision) !== null
          if (accepted) applyRecovery(recovery, recoveredAnnouncementRevision, recoveredPromotionRevision, recoveredWebPageRevision,
            preserveMatchingBackground && hasSameBackground(recovery, currentSnapshotRef.current))
        }
        else if (recovery) {
          // A newer play command does not invalidate independently saved settings.
          if (webPageRevision === recoveredWebPageRevision) setWebPage(parseWebPage(recovery.webPage, window.location.href))
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
        setDisplayIdentity({ id: identity.id, name: identity.name })
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

    connection.onreconnecting(() => {
      guard.invalidatePreparation()
      clearScheduledStart()
      recoveryPendingRef.current = true
    })
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
      guard.invalidatePreparation()
      if (identifyTimer !== undefined) window.clearTimeout(identifyTimer)
      if (sceneExpiryTimer !== undefined) window.clearTimeout(sceneExpiryTimer)
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
      if (mediaRef.current !== media) return
      const seek = pendingSeekSecondsRef.current
      if (seek !== undefined && video.readyState >= 1) {
        const maxSeek = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : seek
        video.currentTime = Math.min(Math.max(0, seek), maxSeek)
        pendingSeekSecondsRef.current = undefined
      }
    }

    video.addEventListener('loadedmetadata', applyPendingSeek)
    const onPlaying = () => {
      if (mediaRef.current === media) setMediaLoadStatus('loaded')
    }
    video.addEventListener('playing', onPlaying)
    applyPendingSeek()
    if (playlistPaused) video.pause()
    const onBuffering = (buffering: boolean) => {
      bufferingRef.current = buffering
    }
    const stopPlayback = playlistPaused ? undefined
      : promotionProgressRef.current?.activeMediaId === media.id ? bufferVideoPlayback(video, onBuffering)
        : recoverVideoPlayback(video, onBuffering, {
          getPosition: () => pendingSeekSecondsRef.current ?? video.currentTime,
          reload: position => {
            pendingSeekSecondsRef.current = position
            setMediaLoadStatus('loading')
            console.warn('Reloading stalled video at its checkpoint:', media.id, position)
            video.load()
          },
          onFailure: error => {
            console.error('Video playback recovery failed:', media.id, error)
            setMediaLoadStatus('error')
          },
        })
    stopVideoPlaybackRef.current = stopPlayback

    return () => {
      video.removeEventListener('loadedmetadata', applyPendingSeek)
      video.removeEventListener('playing', onPlaying)
      stopPlayback?.()
      if (stopVideoPlaybackRef.current === stopPlayback) stopVideoPlaybackRef.current = undefined
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
        : playlist?.items[playlistIndex]?.durationSeconds ?? null
      const buffering = media?.type === 'Video' &&
        (bufferingRef.current || !video || video.paused || video.seeking || video.readyState < 3)
      const actualState = blackout ? 'Blackout' : playbackEnded ? 'Ended' : !media ? 'Idle'
        : playlistPaused ? 'Paused' : mediaLoadStatus === 'error' ? 'Error'
          : buffering || (media.type === 'Image' && mediaLoadStatus !== 'loaded') ? 'Buffering' : 'Playing'

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
        const report = {
          state: actualState, mediaAssetId: media?.id ?? null, playlistId: playlist?.id ?? null,
          playlistIndex: playlist ? playlistIndex : null, positionSeconds, durationSeconds,
          ...appliedCommandRef.current,
          visible: { blackout, announcement, webPage, webPageStatus: webPage ? 'assigned' : null,
            loop: playlist?.loop ?? mediaLoop, promotion: progress?.activeMediaId ?? null },
        }
        const result = progress ? await connection.invoke<PlaybackReportResult | null>(
          'ReportPlaylistPlayback', report, progress,
        ) : await connection.invoke<PlaybackReportResult | null>(
          'ReportPlaybackV2', report,
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
  }, [blackout, deviceToken, media, mediaLoadStatus, mediaLoop, playlist, playlistIndex, playlistPaused, playbackEnded, promotionPolicy, announcement, webPage, getServerNow])

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
              setMediaLoadStatus('error')
              if (promotionProgressRef.current?.activeMediaId === media.id) advancePlaylist()
            }}
          />
        )}
        {useVideoCanvas && rotation !== 0 && media?.type === 'Video' && !blackout && !(playbackEnded && playlist) && (
          <VideoRotationCanvas key={`rotation-${media.instance}`} videoRef={videoRef} />
        )}
        {media?.type === 'Image' && (
          <img key={media.instance} className="player-media" hidden={playbackEnded && !!playlist} src={mediaContentUrl(media.id)} alt=""
            onLoad={() => setMediaLoadStatus('loaded')} onError={() => setMediaLoadStatus('error')} />
        )}
        {webPage && <WebPageSurface key={webPage.url} page={webPage} hidden={blackout} />}
        {identify && <div className="identify-overlay"><span>{displayIdentity.name}</span><small>Pantalla {displayIdentity.id.slice(0, 8).toUpperCase()}</small></div>}
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

function isVisualCommand(type: string): boolean {
  return ['playback.resume', 'playback.loop', 'media.play', 'playlist.play', 'media.pause', 'playlist.pause',
    'media.stop', 'playlist.stop', 'display.blackout', 'display.restore', 'webpage.show', 'webpage.clear',
    'announcement.show', 'announcement.clear', 'promotions.configure', 'scene.apply', 'scene.restore'].includes(type)
}

function hasSameBackground(next: PlaybackRecoveryState | null, current: PlaybackRecoveryState | null): boolean {
  if (!next || !current || next.desiredState !== current.desiredState || next.contentType !== current.contentType) return false
  if (next.contentType === 'Media') return next.payload?.mediaId === current.payload?.mediaId
  if (next.contentType === 'Playlist') return typeof next.payload?.playbackId === 'string' && next.payload.playbackId === current.payload?.playbackId
  return next.contentType === null
}

function parseSceneComposition(value: unknown): SceneComposition | null {
  if (!value || typeof value !== 'object') return null
  const composition = value as SceneComposition
  const actions = ['keep', 'replace', 'remove']
  return actions.includes(composition.media) && actions.includes(composition.webPage) && actions.includes(composition.announcement)
    && ['keep', 'on', 'off'].includes(composition.blackout) && ['keep', 'suspend'].includes(composition.promotions) ? composition : null
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
  try { localStorage.setItem(processedCommandsKey, JSON.stringify(ids.slice(-100))) }
  catch { /* Restricted storage must not prevent live controls. */ }
}

function readProcessedCommandIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(processedCommandsKey) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
