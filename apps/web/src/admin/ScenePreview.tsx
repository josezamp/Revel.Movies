import type { MediaAsset, Playlist } from '../api/client'
import { mediaContentUrl } from '../api/client'
import type { SceneAssignment } from '../api/scenes'
import { AnnouncementSurface } from '../announcements/AnnouncementSurface'
import { VideoThumbnail } from './VideoThumbnail'

export function ScenePreview({ assignment, media, playlists }: { assignment: SceneAssignment; media: MediaAsset[]; playlists: Playlist[] }) {
  const asset = media.find(item => item.id === assignment.media.mediaId)
  const playlist = playlists.find(item => item.id === assignment.media.playlistId)
  const announcement = assignment.announcement.action === 'replace' ? assignment.announcement.payload : undefined
  return <div className="scene-preview">
    <div className={`scene-preview-surface ${assignment.blackout === 'on' ? 'is-blackout' : ''}`}>
      {assignment.blackout === 'on' ? <span>Pantalla negra</span> : announcement ? <AnnouncementSurface announcement={{ ...announcement, endsAt: announcement.endsAt ?? null, completedText: announcement.completedText ?? null }} previewSeconds={announcement.durationSeconds} />
        : assignment.webPage.action === 'replace' ? <span>↗ Página web<br /><small>{assignment.webPage.payload?.url}</small></span>
        : assignment.media.action === 'replace' && asset ? asset.type === 'Image' || asset.type === 2 ? <img src={mediaContentUrl(asset.id)} alt={asset.name} /> : <VideoThumbnail src={mediaContentUrl(asset.id)} />
        : <span>{playlist ? `▶ ${playlist.name}` : assignment.media.action === 'remove' ? 'Sin multimedia de fondo' : 'Mantener el fondo actual'}</span>}
    </div>
    <small>Vista previa de configuración · no está al aire</small>
    <p>Fondo: {assignment.media.action === 'keep' ? 'mantener' : assignment.media.action === 'remove' ? 'retirar' : asset?.name ?? playlist?.name ?? 'elegir contenido'} · Web: {actionLabel(assignment.webPage.action)} · Anuncio: {actionLabel(assignment.announcement.action)}</p>
  </div>
}
function actionLabel(value: string) { return value === 'keep' ? 'mantener' : value === 'remove' ? 'retirar' : 'reemplazar' }
