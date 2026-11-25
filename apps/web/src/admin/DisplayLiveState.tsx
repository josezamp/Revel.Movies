import type { Display, MediaAsset, Playlist } from '../api/client'
import { mediaContentUrl } from '../api/client'
import { ageLabel, playbackConfirmed, playbackLabel, reportAge, REPORT_FRESHNESS_MS, timeLabel } from './liveState'
import { VideoThumbnail } from './VideoThumbnail'
import { countdownSeconds, formatCountdown } from '../announcements/announcement'

export function DisplayLiveState({ display, media, playlists, now }: { display: Display; media: MediaAsset[]; playlists: Playlist[]; now: number }) {
  const age = reportAge(display, now)
  const stale = age !== null && age > REPORT_FRESHNESS_MS
  const asset = media.find(item => item.id === display.actualMediaAssetId)
  const playlist = playlists.find(item => item.id === display.actualPlaylistId)
  const assigned = media.find(item => item.id === display.playbackMediaId)?.name ?? playlists.find(item => item.id === display.playbackPlaylistId)?.name
  const announcement = display.actualAnnouncement
  const web = display.actualWebPage
  const blackout = display.actualBlackout === true || display.actualPlaybackState === 'Blackout'
  const confirmed = playbackConfirmed(display, now)
  const background = asset?.name ?? (display.actualMediaAssetId ? 'Archivo no disponible en la biblioteca' : playbackLabel(display.actualPlaybackState))
  const countdownFinished = announcement?.kind === 'countdown' && announcement.endsAt && display.lastPlaybackReportAt && Date.parse(announcement.endsAt) <= Date.parse(display.lastPlaybackReportAt)
  const visible = blackout ? 'Pantalla negra' : announcement ? countdownFinished ? announcement.completedText ?? announcement.text : announcement.text : web ? 'Página web asignada al iframe' : background
  const stateLabel = playbackLabel(display.actualPlaybackState)
  const hasDuration = !!display.actualDurationSeconds
  const pending = display.lastCommandId && display.actualCommandId !== display.lastCommandId
  const portrait = display.rotation % 180 !== 0
  const total = display.actualCommandId === display.lastCommandId && display.actualPlaylistId === display.playbackPlaylistId
    ? display.playbackPlaylistItemCount ?? (display.playbackPlaylistUpdatedAt === playlist?.updatedAt ? playlist?.items.length : undefined) : undefined

  return <div className={`live-state${stale ? ' is-stale' : ''}`}>
    <figure className="live-preview-figure" aria-label={`TV ${portrait ? 'vertical · 9:16' : 'horizontal · 16:9'}`} title={asset && !blackout && !announcement && !web ? 'Miniatura del archivo · no es una captura en vivo' : 'Representación del último reporte'}>
      <div className="live-preview-stage">
        <div className={`live-preview image-fit-${display.imageFit ?? 'contain'}${portrait ? ' is-portrait' : ''}${blackout ? ' is-blackout' : ''}`}>
          {!blackout && !announcement && !web && asset && (asset.type === 'Image' || asset.type === 2
            ? <img loading="lazy" src={mediaContentUrl(asset.id)} alt={`Miniatura de ${asset.name}`} />
            : <VideoThumbnail src={mediaContentUrl(asset.id)} />)}
          {(blackout || announcement || web || !asset) && <span className="live-symbol" aria-hidden="true">{blackout ? '■' : announcement?.kind === 'countdown' ? '◷' : announcement ? 'Aa' : web ? '↗' : '▶'}</span>}
        </div>
      </div>
      <figcaption className="preview-caption visually-hidden">{portrait ? 'Vertical · 9:16' : 'Horizontal · 16:9'}<br />{asset && !blackout && !announcement && !web ? 'Miniatura · no es una captura en vivo' : 'Representación del último reporte'}</figcaption>
    </figure>
    <div className="live-content">
      <strong>{visible}</strong>
      {announcement?.kind === 'countdown' && <small>Cuenta regresiva · {announcement.endsAt && display.lastPlaybackReportAt ? `${formatCountdown(countdownSeconds(announcement.endsAt, Date.parse(display.lastPlaybackReportAt)))} al último reporte` : 'sin tiempo confirmado'}</small>}
      {web && <small className="muted">{web.url} · la carga externa no se puede verificar</small>}
      {(blackout || announcement || web) && display.actualMediaAssetId && <small>De fondo: {background}</small>}
      {playlist && <small>{playlist.name}{display.actualPlaylistIndex != null ? ` · ${display.actualPlaylistIndex + 1}${total ? ` de ${total}` : ''}` : ''}{display.playbackPlaylistUpdatedAt && display.playbackPlaylistUpdatedAt !== playlist.updatedAt ? ' · versión anterior al aire' : ''}</small>}
      {display.actualPromotion && <small className="state-tag">Corte promocional</small>}
      {(stateLabel !== visible || hasDuration) && <div className="live-timing">{stateLabel !== visible && <span>{stateLabel}</span>}{hasDuration && <span>{timeLabel(display.actualPositionSeconds)} / {timeLabel(display.actualDurationSeconds)}</span>}</div>}
      {!!display.actualDurationSeconds && <progress aria-label="Posición confirmada" value={Math.max(0, display.actualPositionSeconds ?? 0)} max={display.actualDurationSeconds} />}
      <small className={stale ? 'stale-label' : 'muted'}>{display.actualLoop ? 'En bucle · ' : ''}{age === null ? 'Sin reporte de la TV' : `${stale ? 'Último reporte' : 'Reportado'} ${ageLabel(age).toLowerCase()}`}{stale ? ' · Información desactualizada' : ''}</small>
      {pending && <p className="pending-command">Esperando confirmación de la última acción{assigned ? ` · ${assigned}` : ''}</p>}
      {confirmed && display.actualPlaybackState === 'Loading' && <small>Cargando en la TV…</small>}
      {!pending && assigned && display.actualMediaAssetId !== display.playbackMediaId && display.playbackContentType !== 'Playlist' && <small>Solicitado: {assigned}</small>}
    </div>
  </div>
}
