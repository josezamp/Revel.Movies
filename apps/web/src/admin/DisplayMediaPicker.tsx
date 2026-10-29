import { useMemo, useRef, useState } from 'react'
import { isMediaLink, type MediaAsset, type Playlist } from '../api/client'
import { LinkThumbnail } from './LinkThumbnail'
import { Dialog } from './Dialog'
import { VideoThumbnail } from './VideoThumbnail'
import './displayMediaPicker.css'

export type DisplayContentSelection = { kind: 'media' | 'playlist'; id: string }
type Category = 'all' | 'playlist' | 'video' | 'image' | 'link'
type Entry = { selection: DisplayContentSelection; category: Exclude<Category, 'all'>; name: string; detail: string; cover?: MediaAsset; disabled: boolean }

const categories = [
  { id: 'all', label: 'Todo' },
  { id: 'playlist', label: 'Playlists' },
  { id: 'video', label: 'Videos' },
  { id: 'image', label: 'Imágenes' },
  { id: 'link', label: 'Enlaces' },
] as const
const typeLabels = { playlist: 'Playlist', video: 'Video', image: 'Imagen', link: 'Enlace' }
const symbols = { playlist: '▤', video: '▶', image: '▧', link: '↗' }
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
const sameSelection = (left: DisplayContentSelection | null, right: DisplayContentSelection) => left?.kind === right.kind && left.id === right.id

function assetCategory(asset: MediaAsset): 'image' | 'video' | 'link' {
  if (isMediaLink(asset)) return 'link'
  return asset.type === 'Image' || asset.type === 2 ? 'image' : 'video'
}

function assetDetail(asset: MediaAsset) {
  if (isMediaLink(asset)) return asset.contentUrl
  const dimensions = asset.width && asset.height ? `${asset.width} × ${asset.height}` : ''
  const seconds = asset.durationSeconds
  const duration = seconds && Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : ''
  return [assetCategory(asset) === 'image' ? 'Imagen' : duration || 'Video completo', dimensions].filter(Boolean).join(' · ')
}

function ContentCover({ entry, compact = false }: { entry: Entry; compact?: boolean }) {
  const [failed, setFailed] = useState(false)
  const cover = entry.cover
  return <span className={`content-picker-cover is-${entry.category}${compact ? ' is-compact' : ''}`} aria-hidden="true">
    {cover && !failed ? isMediaLink(cover) ? <LinkThumbnail url={cover.contentUrl} /> : assetCategory(cover) === 'image'
      ? <img key={cover.contentUrl} src={cover.contentUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      : <VideoThumbnail key={cover.contentUrl} src={cover.contentUrl} />
      : <span className="content-picker-placeholder">{symbols[entry.category]}</span>}
    {!compact && <span className="content-picker-type">{symbols[entry.category]} {typeLabels[entry.category]}</span>}
  </span>
}

export function DisplayMediaPicker({ displayName, media, playlists, selected, assigned, disabled, onSelect }: {
  displayName: string; media: MediaAsset[]; playlists: Playlist[]; selected: DisplayContentSelection | null
  assigned: DisplayContentSelection | null; disabled: boolean; onSelect: (selection: DisplayContentSelection | null) => void
}) {
  const [open, setOpen] = useState(false)
  const entries = useMemo<Entry[]>(() => {
    const assets = new Map(media.map(asset => [asset.id, asset]))
    return [
      ...playlists.map(playlist => ({
        selection: { kind: 'playlist' as const, id: playlist.id }, category: 'playlist' as const, name: playlist.name,
        detail: playlist.items.length ? `${playlist.items.length} ${playlist.items.length === 1 ? 'archivo' : 'archivos'} · ${playlist.isLoop ? 'En bucle' : 'Una vez'}` : 'Vacía · agregá contenido primero',
        cover: assets.get(playlist.items[0]?.mediaAssetId), disabled: playlist.items.length === 0,
      })),
      ...media.map(asset => ({ selection: { kind: 'media' as const, id: asset.id }, category: assetCategory(asset), name: asset.name, detail: assetDetail(asset), cover: asset, disabled: false })),
    ]
  }, [media, playlists])
  const current = entries.find(entry => sameSelection(selected ?? assigned, entry.selection))

  return <div className="display-media-picker">
    <div className="content-picker-label"><span>Contenido</span>{selected && <span className="content-picker-pending">Listo para enviar</span>}</div>
    <button type="button" className="content-picker-trigger" aria-label={`Contenido para ${displayName}`}
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      {current ? <ContentCover key={`${current.selection.kind}:${current.selection.id}`} entry={current} compact /> : <span className="content-picker-empty-icon" aria-hidden="true">▤</span>}
      <span className="content-picker-trigger-text"><strong>{current?.name ?? (assigned ? 'Contenido asignado' : 'Seleccionar contenido')}</strong><small>{current ? `${typeLabels[current.category]} · Cambiar` : 'Playlists, videos, imágenes y enlaces'}</small></span>
      <span className="content-picker-chevron" aria-hidden="true">›</span>
    </button>
    {selected && <button type="button" className="content-picker-reset" disabled={disabled} onClick={() => onSelect(null)}>Descartar selección</button>}
    {open && <ContentBrowser displayName={displayName} entries={entries} selected={selected} assigned={assigned} disabled={disabled}
      onClose={() => setOpen(false)} onSelect={selection => { onSelect(selection); setOpen(false) }} />}
  </div>
}

function ContentBrowser({ displayName, entries, selected, assigned, disabled, onClose, onSelect }: {
  displayName: string; entries: Entry[]; selected: DisplayContentSelection | null; assigned: DisplayContentSelection | null
  disabled: boolean; onClose: () => void; onSelect: (selection: DisplayContentSelection) => void
}) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<Category>('all')
  const [limit, setLimit] = useState(24)
  const search = normalize(query)
  const matching = entries.filter(entry => normalize(`${entry.name} ${entry.category === 'link' ? entry.detail : ''}`).includes(search))
  const filtered = matching.filter(entry => category === 'all' || entry.category === category)
  const visible = filtered.slice(0, limit)

  return <Dialog title="Elegir contenido" onClose={onClose} initialFocusRef={searchRef}>
    <div className="content-browser">
      <p className="content-picker-destination">Destino <strong>{displayName}</strong></p>
      <div className="content-picker-search">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <input ref={searchRef} type="search" aria-label="Buscar contenido" placeholder="Buscar por nombre…" value={query}
          onChange={event => { setQuery(event.target.value); setLimit(24) }} />
        {query && <button type="button" aria-label="Limpiar búsqueda" onClick={() => { setQuery(''); setLimit(24) }}>✕</button>}
      </div>
      <div className="content-picker-filters" role="group" aria-label="Tipo de contenido">
        {categories.map(item => <button key={item.id} type="button" aria-pressed={category === item.id}
          onClick={() => { setCategory(item.id); setLimit(24) }}>{item.label}<span>{matching.filter(entry => item.id === 'all' || entry.category === item.id).length}</span></button>)}
      </div>
      <p className="content-picker-results" role="status">{filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}{search ? ` para “${query.trim()}”` : ' disponibles'}</p>
      {disabled && <p className="content-picker-unavailable" role="alert">La pantalla no está disponible para recibir contenido.</p>}
      {filtered.length === 0 ? <div className="content-picker-empty">
        <span aria-hidden="true">{search ? '⌕' : '▤'}</span>
        <strong>{search ? 'No encontramos ese contenido' : 'Todavía no hay contenido en esta categoría'}</strong>
        <p>{search ? 'Probá con otro nombre o cambiá el tipo de contenido.' : 'Agregá archivos o creá una playlist desde Contenido.'}</p>
        {query && <button type="button" onClick={() => { setQuery(''); setLimit(24) }}>Limpiar búsqueda</button>}
      </div> : categories.filter(item => item.id !== 'all').map(group => {
        const items = visible.filter(entry => entry.category === group.id)
        if (!items.length) return null
        return <div className="content-picker-section" key={group.id}>
          <h3>{group.label}<span>{filtered.filter(entry => entry.category === group.id).length}</span></h3>
          <div className="content-picker-grid">
            {items.map(entry => <button key={`${entry.selection.kind}:${entry.selection.id}`} type="button" className="content-picker-option"
              aria-label={`Seleccionar ${typeLabels[entry.category].toLocaleLowerCase('es')}: ${entry.name}`}
              aria-pressed={sameSelection(selected, entry.selection)} disabled={disabled || entry.disabled} onClick={() => onSelect(entry.selection)}>
              <ContentCover entry={entry} />
              <span className="content-picker-option-text"><strong>{entry.name}</strong><small>{entry.detail}</small>
                {sameSelection(selected, entry.selection) ? <span className="content-picker-marker">✓ Seleccionado</span>
                  : sameSelection(assigned, entry.selection) ? <span className="content-picker-marker is-assigned">Asignado a esta pantalla</span> : null}
              </span>
            </button>)}
          </div>
        </div>
      })}
      {filtered.length > visible.length && <button type="button" className="content-picker-more" onClick={() => setLimit(value => value + 24)}>Mostrar más ({filtered.length - visible.length} restantes)</button>}
    </div>
    <div className="playlist-dialog-footer content-picker-footer"><p>Elegí el contenido y confirmá el envío desde la tarjeta de la pantalla.</p><button type="button" onClick={onClose}>Cancelar</button></div>
  </Dialog>
}
