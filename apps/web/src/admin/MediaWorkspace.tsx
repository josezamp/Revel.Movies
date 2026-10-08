import { useEffect, useRef, useState } from 'react'
import { getPlaylists, type Display, type DisplayGroup, type MediaAsset, type Playlist } from '../api/client'
import { MediaLibrary } from './MediaLibrary'
import { PlaylistsPanel } from './PlaylistsPanel'
import { PlaylistModal } from './PlaylistModal'

export function MediaWorkspace({ eventId, displays, groups, media, onMediaChanged }: {
  eventId: string; displays: Display[]; groups: DisplayGroup[]; media: MediaAsset[]; onMediaChanged: () => Promise<void>
}) {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [preferredPlaylistId, setPreferredPlaylistId] = useState<string>()
  const [modal, setModal] = useState<'create' | 'add'>()
  const [feedback, setFeedback] = useState('')
  const libraryRef = useRef<HTMLElement>(null)
  const requestRevision = useRef(0)
  const selectedMedia = selectedIds.flatMap(id => media.find(item => item.id === id) ?? [])

  async function refresh() {
    const revision = ++requestRevision.current
    setLoadError('')
    try {
      const items = eventId ? await getPlaylists(eventId) : []
      if (revision === requestRevision.current) setPlaylists(items)
    } catch (cause) {
      if (revision === requestRevision.current) setLoadError(cause instanceof Error ? cause.message : 'No se pudieron cargar las playlists.')
    } finally {
      if (revision === requestRevision.current) setLoading(false)
    }
  }

  useEffect(() => { void refresh(); return () => { requestRevision.current++ } }, [eventId])
  useEffect(() => {
    setSelectedIds(ids => ids.filter(id => media.some(item => item.id === id)))
  }, [media])

  function startSelection(playlistId?: string) {
    setPreferredPlaylistId(playlistId)
    setSelecting(true)
    setFeedback('')
    libraryRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
    libraryRef.current?.focus({ preventScroll: true })
  }

  function saved(playlist: Playlist) {
    requestRevision.current++
    setPlaylists(current => [...current.filter(item => item.id !== playlist.id), playlist].sort((a, b) => a.name.localeCompare(b.name)))
    setActiveId(playlist.id)
    setFeedback(modal === 'create' ? `Playlist «${playlist.name}» creada.` : `${selectedMedia.length} archivos agregados a «${playlist.name}».`)
    setSelectedIds([])
    setSelecting(false)
    setModal(undefined)
    if (modal === 'add') window.requestAnimationFrame(() => libraryRef.current?.focus({ preventScroll: true }))
  }

  return (
    <div className="media-workspace">
      <PlaylistsPanel eventId={eventId} playlists={playlists} media={media} displays={displays} groups={groups}
        activeId={activeId} onActiveId={setActiveId} loading={loading} loadError={loadError} onRefresh={refresh}
        onCreate={() => setModal('create')} onAddContent={startSelection} feedback={feedback} />
      <MediaLibrary libraryRef={libraryRef} eventId={eventId} media={media} displays={displays} onMediaChanged={async () => { await onMediaChanged(); await refresh() }}
        selecting={selecting} selectedIds={selectedIds} onSelectedIds={setSelectedIds} onStartSelection={() => startSelection()}
        onCancelSelection={() => { setSelecting(false); setSelectedIds([]); setPreferredPlaylistId(undefined) }}
        onAdd={() => setModal('add')} feedback={feedback} playlistsLoading={loading || !!loadError} />
      {modal && <PlaylistModal eventId={eventId} playlists={playlists} media={modal === 'create' ? [] : selectedMedia}
        preferredPlaylistId={playlists.some(item => item.id === preferredPlaylistId) ? preferredPlaylistId : undefined}
        createOnly={modal === 'create'} onSaved={saved} onClose={() => setModal(undefined)} />}
    </div>
  )
}
