import { useEffect, useRef, useState } from 'react'
import { getPlaylists, type Display, type DisplayGroup, type MediaAsset, type Playlist } from '../api/client'
import { MediaLibrary } from './MediaLibrary'
import { PlaylistsPanel } from './PlaylistsPanel'
import { PlaylistModal } from './PlaylistModal'
import { PromotionalBreaksPanel } from './PromotionalBreaksPanel'
import './content.css'

export function MediaWorkspace({ eventId, displays, groups, media, onMediaChanged }: {
  eventId: string; displays: Display[]; groups: DisplayGroup[]; media: MediaAsset[]; onMediaChanged: () => Promise<void>
}) {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [uploadedSelection, setUploadedSelection] = useState<MediaAsset[]>()
  const [preferredPlaylistId, setPreferredPlaylistId] = useState<string>()
  const [modal, setModal] = useState<'create' | 'add'>()
  const [feedback, setFeedback] = useState('')
  const [section, setSection] = useState<'playlists' | 'library' | 'promotions'>('library')
  const libraryRef = useRef<HTMLElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const requestRevision = useRef(0)
  const selectedMedia = uploadedSelection ?? selectedIds.flatMap(id => media.find(item => item.id === id) ?? [])

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

  useEffect(() => { setLoading(true); setPlaylists([]); setActiveId(''); setSelectedIds([]); setSelecting(false); setModal(undefined); setUploadedSelection(undefined); void refresh(); return () => { requestRevision.current++ } }, [eventId])
  useEffect(() => { setSelectedIds(ids => ids.filter(id => media.some(item => item.id === id))) }, [media])

  function startSelection(playlistId?: string) {
    setPreferredPlaylistId(playlistId); setUploadedSelection(undefined)
    setSelecting(true); setSection('library'); setFeedback('')
    window.requestAnimationFrame(() => libraryRef.current?.focus({ preventScroll: true }))
  }

  function returnToEditor() {
    setSelecting(false); setSelectedIds([]); setPreferredPlaylistId(undefined); setSection('playlists')
    window.requestAnimationFrame(() => editorRef.current?.focus({ preventScroll: true }))
  }

  function saved(playlist: Playlist) {
    requestRevision.current++
    setPlaylists(current => [...current.filter(item => item.id !== playlist.id), playlist].sort((a, b) => a.name.localeCompare(b.name)))
    setActiveId(playlist.id)
    setFeedback(modal === 'create' ? `Playlist «${playlist.name}» creada. Guardar no cambia las pantallas.` : `${selectedMedia.length} archivos agregados a «${playlist.name}». Cambios guardados; aplicalos cuando quieras enviarlos.`)
    setSelectedIds([]); setSelecting(false); setModal(undefined); setUploadedSelection(undefined); setSection('playlists')
    window.requestAnimationFrame(() => editorRef.current?.focus({ preventScroll: true }))
  }

  return (
    <div className="media-workspace">
      <nav className="content-tabs" aria-label="Contenido del evento">
        <button aria-current={section === 'library' ? 'page' : undefined} onClick={() => setSection('library')}>Biblioteca <span>{media.length}</span></button>
        <button aria-current={section === 'playlists' ? 'page' : undefined} onClick={() => setSection('playlists')}>Playlists <span>{playlists.length}</span></button>
        <button aria-current={section === 'promotions' ? 'page' : undefined} onClick={() => setSection('promotions')}>Promociones</button>
      </nav>
      <div hidden={section !== 'playlists'} ref={editorRef} tabIndex={-1}>
        <PlaylistsPanel key={eventId} eventId={eventId} playlists={playlists} media={media} displays={displays} groups={groups}
          activeId={activeId} onActiveId={setActiveId} loading={loading} loadError={loadError} onRefresh={refresh}
          onCreate={() => setModal('create')} onAddContent={startSelection} feedback={feedback} />
      </div>
      <div hidden={section !== 'promotions'}><PromotionalBreaksPanel key={eventId} eventId={eventId} displays={displays} groups={groups} playlists={playlists} loading={loading || !!loadError} /></div>
      <div hidden={section !== 'library'}>
        {selecting && preferredPlaylistId && <p className="content-context">Agregando contenido a <strong>{playlists.find(item => item.id === preferredPlaylistId)?.name ?? 'la playlist'}</strong>. Elegí los archivos en el orden deseado.</p>}
        <MediaLibrary key={eventId} libraryRef={libraryRef} eventId={eventId} media={media} displays={displays} groups={groups} onMediaChanged={onMediaChanged}
          selecting={selecting} selectedIds={selectedIds} onSelectedIds={setSelectedIds} onStartSelection={() => startSelection()}
          onCancelSelection={returnToEditor} onAdd={() => { setUploadedSelection(undefined); setModal('add') }}
          onAddUploaded={assets => { setUploadedSelection(assets); setPreferredPlaylistId(activeId || undefined); setModal('add') }} feedback={feedback} playlistsLoading={loading || !!loadError} />
      </div>
      {modal && <PlaylistModal eventId={eventId} playlists={playlists} media={modal === 'create' ? [] : selectedMedia}
        preferredPlaylistId={playlists.some(item => item.id === preferredPlaylistId) ? preferredPlaylistId : undefined}
        createOnly={modal === 'create'} onSaved={saved} onClose={() => setModal(undefined)} />}
    </div>
  )
}
