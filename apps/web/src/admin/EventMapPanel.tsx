import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Display, MediaAsset, Playlist } from '../api/client'
import { getEventMap, saveEventMap, MapRequestError, type EventMap, type MapNode, type MapKind, type MapColor } from '../api/eventMap'
import { DisplayCard } from './DisplayCard'
import { Dialog } from './Dialog'
import { displayPresence, sortByConnection } from './displayPresence'
import { ConnectionDot } from './DisplayName'
import { playbackLabel, reportAge, REPORT_FRESHNESS_MS } from './liveState'
import { createMapNodeId, fitMapNode, resizeMapNode, MAP_WIDTH, MAP_HEIGHT, type ResizeHandle } from './eventMapGeometry'
import './eventMap.css'

const kinds: { kind: Exclude<MapKind, 'display'>; label: string; symbol: string }[] = [
  { kind: 'rectangle', label: 'Sector', symbol: '▭' }, { kind: 'ellipse', label: 'Círculo', symbol: '○' },
  { kind: 'wall', label: 'Pared', symbol: '━' }, { kind: 'label', label: 'Etiqueta', symbol: 'T' },
]
const colors: [MapColor, string][] = [['slate', 'Gris'], ['blue', 'Azul'], ['amber', 'Ámbar'], ['rose', 'Rosa'], ['green', 'Verde']]
const resizeHandles: { handle: ResizeHandle; label: string; x: number; y: number }[] = [
  { handle: 'nw', label: 'esquina superior izquierda', x: 0, y: 0 },
  { handle: 'n', label: 'borde superior', x: .5, y: 0 },
  { handle: 'ne', label: 'esquina superior derecha', x: 1, y: 0 },
  { handle: 'w', label: 'borde izquierdo', x: 0, y: .5 },
  { handle: 'e', label: 'borde derecho', x: 1, y: .5 },
  { handle: 'sw', label: 'esquina inferior izquierda', x: 0, y: 1 },
  { handle: 's', label: 'borde inferior', x: .5, y: 1 },
  { handle: 'se', label: 'esquina inferior derecha', x: 1, y: 1 },
]
const arrowSteps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

function readDraft(key: string, eventId: string): EventMap | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as EventMap | null
    if (value?.eventId !== eventId || !Number.isInteger(value.version) || !Array.isArray(value.nodes) || value.nodes.length > 300) return null
    if (!value.nodes.every(node => node && typeof node.id === 'string' && typeof node.label === 'string' &&
      ['rectangle', 'ellipse', 'wall', 'label', 'display'].includes(node.kind) && colors.some(([color]) => color === node.color) &&
      [node.x, node.y, node.width, node.height].every(Number.isFinite) && node.width >= 8 && node.height >= 8 &&
      node.x >= 0 && node.y >= 0 && node.x + node.width <= MAP_WIDTH && node.y + node.height <= MAP_HEIGHT)) return null
    return value
  } catch { return null }
}

type Props = {
  eventId: string; displays: Display[]; media: MediaAsset[]; playlists: Playlist[]; prepared: Record<string, string[]>; now: number
  onChanged: () => Promise<void>; onUpdated: (display: Display) => void
}

export function EventMapPanel({ eventId, displays, media, playlists, prepared, now, onChanged, onUpdated }: Props) {
  const [saved, setSaved] = useState<EventMap>()
  const [draft, setDraft] = useState<EventMap>()
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [selectedDisplayId, setSelectedDisplayId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const [discard, setDiscard] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(1)
  const canvas = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; pointerId: number; startX: number; startY: number; node: MapNode; handle?: ResizeHandle; target: HTMLButtonElement } | null>(null)
  const cancelledClick = useRef(false)
  const storageKey = `revel-event-map-draft-v1:${eventId}`
  const nodes = draft?.nodes ?? []
  const dirty = !!draft && !!saved && JSON.stringify(draft.nodes) !== JSON.stringify(saved.nodes)
  const selected = nodes.find(node => node.id === selectedId)
  const selectedDisplay = displays.find(display => display.id === (selected?.displayId ?? selectedDisplayId))
  const unplaced = sortByConnection(displays.filter(display => !nodes.some(node => node.displayId === display.id)), display => display.status)
    .map(display => ({ display, presence: displayPresence(display.status) }))
  const nodeOptions = sortByConnection(nodes.map((node, index) => ({ node, index, display: displays.find(display => display.id === node.displayId) })), item => item.display?.status)
  const editable = editing && !saving && !loading

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    void getEventMap(eventId).then(value => {
      if (cancelled) return
      const local = readDraft(storageKey, eventId)
      const recovered = local && JSON.stringify(local.nodes) !== JSON.stringify(value.nodes)
      setSaved(value); setDraft(recovered ? local : value)
      setConflict(!!recovered && local.version !== value.version)
      setEditing(!!recovered)
      setNotice(recovered ? 'Borrador recuperado en esta pestaña. Todavía no está guardado en el evento.' : '')
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'No se pudo cargar el croquis.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [eventId, storageKey, attempt])

  useEffect(() => {
    if (!draft || loading) return
    try { if (dirty) sessionStorage.setItem(storageKey, JSON.stringify(draft)); else sessionStorage.removeItem(storageKey) } catch { /* Server save remains available if browser storage is full. */ }
  }, [draft, dirty, loading, storageKey])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function change(id: string, changes: Partial<MapNode>) {
    if (!editable) return
    setDraft(current => current && ({ ...current, nodes: current.nodes.map(node => node.id === id ? fitMapNode(node, changes) : node) }))
    setNotice('')
  }

  function add(kind: MapKind, display?: Display) {
    if (!editable || nodes.length >= 300) return
    const offset = (nodes.length % 8) * 24
    const node: MapNode = { id: createMapNodeId(), kind, x: 120 + offset, y: 120 + offset,
      width: kind === 'wall' ? 320 : kind === 'display' ? 180 : kind === 'ellipse' ? 140 : 240,
      height: kind === 'wall' ? 12 : kind === 'label' ? 50 : kind === 'display' ? 90 : 140,
      label: display?.name.slice(0, 100) ?? kinds.find(item => item.kind === kind)!.label,
      color: kind === 'display' ? 'blue' : 'slate', displayId: display?.id ?? null }
    setDraft(current => current && ({ ...current, nodes: [...current.nodes, node] }))
    setSelectedId(node.id); setSelectedDisplayId(''); setNotice('')
  }

  function removeSelected() {
    if (!editable || !selected) return
    setDraft(current => current && ({ ...current, nodes: current.nodes.filter(node => node.id !== selected.id) }))
    setSelectedId(''); setSelectedDisplayId(''); setNotice('')
  }

  async function save(operate = false) {
    if (!draft || saving || loading || conflict) return
    if (!dirty) { if (operate) setEditing(false); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await saveEventMap(draft)
      setSaved(result); setDraft(result); setNotice('Croquis guardado en el evento.')
      if (operate) setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el croquis. Tu borrador se conserva.')
      setConflict(cause instanceof MapRequestError && cause.conflict)
    } finally { setSaving(false) }
  }

  async function reloadSaved() {
    setSaving(true); setError('')
    try {
      const value = await getEventMap(eventId)
      setSaved(value); setDraft(value); setConflict(false); setSelectedId(''); setSelectedDisplayId('')
      setDiscard(false); setNotice('Se cargó el croquis guardado.'); setEditing(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el croquis.') }
    finally { setSaving(false) }
  }

  function select(node: MapNode) { setSelectedId(node.id); setSelectedDisplayId('') }

  function startDrag(event: PointerEvent<HTMLButtonElement>, node: MapNode, handle?: ResizeHandle) {
    if (!editable || event.button !== 0 || drag.current) return
    event.preventDefault()
    event.stopPropagation()
    select(node)
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: node.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, node, handle, target: event.currentTarget }
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId || !canvas.current || !editable) return
    const rect = canvas.current.getBoundingClientRect()
    const dx = (event.clientX - active.startX) * MAP_WIDTH / rect.width
    const dy = (event.clientY - active.startY) * MAP_HEIGHT / rect.height
    change(active.id, active.handle ? resizeMapNode(active.node, active.handle, dx, dy)
      : { x: active.node.x + dx, y: active.node.y + dy })
  }

  function endDrag(pointerId: number, cancel = false) {
    const active = drag.current
    if (!active || active.pointerId !== pointerId) return
    if (cancel) {
      change(active.id, { x: active.node.x, y: active.node.y, width: active.node.width, height: active.node.height })
      cancelledClick.current = true
    }
    drag.current = null
    if (active.target.hasPointerCapture(pointerId)) active.target.releasePointerCapture(pointerId)
  }

  function keyMove(event: KeyboardEvent<HTMLButtonElement>, node: MapNode, handle?: ResizeHandle) {
    if (!editable) return
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); endDrag(drag.current.pointerId, true); return }
    if (drag.current) return
    const step = arrowSteps[event.key]
    if (!step) return
    event.preventDefault()
    const dx = step[0] * (event.shiftKey ? 20 : 5), dy = step[1] * (event.shiftKey ? 20 : 5)
    change(node.id, handle ? resizeMapNode(node, handle, dx, dy) : { x: node.x + dx, y: node.y + dy })
  }

  if (loading) return <p role="status" className="workspace-loading">Cargando croquis…</p>
  if (!draft) return <div role="alert" className="workspace-error">{error}<button onClick={() => setAttempt(value => value + 1)}>Reintentar carga del croquis</button></div>

  return <div className={`event-map${editing ? ' is-editing' : ''}`}>
    <div className="map-toolbar">
      <div><span className="eyebrow">CROQUIS DEL EVENTO</span><p>{editing ? 'Dibujá el lugar y ubicá cada pantalla.' : 'Elegí una pantalla para ver su estado y controlarla.'}</p></div>
      <div className="map-mode" role="group" aria-label="Modo del mapa">
        <button aria-pressed={!editing} disabled={saving || (editing && conflict)} onClick={() => void save(true)}>Operar</button>
        <button aria-pressed={editing} disabled={saving} onClick={() => { setEditing(true); setError('') }}>Editar croquis</button>
      </div>
    </div>
    <div className="map-save-bar">
      <span role="status">{saving ? 'Guardando…' : dirty ? 'Cambios sin guardar' : notice || (draft.version ? 'Croquis guardado en el evento' : 'Todavía no hay un croquis guardado')}</span>
      {editing && <div className="button-row"><button disabled={saving || (!dirty && !conflict)} onClick={() => setDiscard(true)}>Descartar cambios</button><button className="workspace-primary" disabled={!dirty || saving || conflict} onClick={() => void save()}>Guardar croquis</button></div>}
    </div>
    {notice && dirty && <p className="map-hint">{notice}</p>}
    {error && <p role="alert" className="workspace-error">{error}</p>}
    {conflict && <div className="map-conflict" role="alert">Hay una versión más reciente. Tu borrador sigue visible.<button disabled={saving} onClick={() => setDiscard(true)}>Cargar versión guardada</button></div>}
    <div className="map-workspace">
      <div className="map-drawing">
        <div className="map-tools">
          {editing ? <div className="map-shapes" role="group" aria-label="Agregar al croquis">{kinds.map(item => <button key={item.kind} disabled={saving || nodes.length >= 300} onClick={() => add(item.kind)}><span aria-hidden="true">{item.symbol}</span>{item.label}</button>)}</div>
            : <span className="map-lock">Posiciones bloqueadas · Operar</span>}
          <div className="map-zoom" role="group" aria-label="Zoom del mapa"><button aria-label="Alejar mapa" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(.5, value - .25))}>−</button><button aria-label="Restablecer zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="Acercar mapa" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}>+</button></div>
        </div>
        <div className="map-viewport" tabIndex={0} role="region" aria-label="Lienzo del croquis">
          <div ref={canvas} className="map-canvas" style={{ width: `${zoom * 100}%`, minWidth: 600 * zoom }}
            onPointerDownCapture={() => { cancelledClick.current = false }}
            onClickCapture={event => {
              // Releasing capture on Escape can synthesize a click on the canvas
              // after the handle moves back. Keep the cancelled element selected.
              if (cancelledClick.current) { cancelledClick.current = false; if (event.detail > 0) { event.preventDefault(); event.stopPropagation() } }
            }}
            onClick={event => { if (event.target === event.currentTarget) { setSelectedId(''); setSelectedDisplayId('') } }}>
            <span className="map-north" aria-hidden="true">↑<br />PLANO</span>
            {!nodes.length && <div className="map-empty"><span aria-hidden="true">▧</span><strong>Tu evento, visto desde arriba.</strong><p>{editing ? 'Agregá un sector, una pared o una etiqueta. Después ubicá las pantallas desde el panel.' : 'Entrá en Editar croquis para empezar a dibujar el lugar.'}</p></div>}
            {nodes.map(node => {
              const display = displays.find(item => item.id === node.displayId)
              const presence = display ? displayPresence(display.status) : null
              const age = display ? reportAge(display, now) : null
              const stale = age === null || age > REPORT_FRESHNESS_MS
              const label = display?.name ?? (node.kind === 'display' ? `${node.label} · desvinculada` : node.label)
              return <button key={node.id} type="button" data-node-id={node.id} data-kind={node.kind}
                className={`map-node map-node-${node.kind} map-color-${node.color}${selectedId === node.id ? ' is-selected' : ''}${presence ? ` connection-${presence.kind}` : ''}`}
                style={{ left: `${node.x / MAP_WIDTH * 100}%`, top: `${node.y / MAP_HEIGHT * 100}%`, width: `${node.width / MAP_WIDTH * 100}%`, height: `${node.height / MAP_HEIGHT * 100}%` }}
                aria-label={`${node.kind === 'display' ? 'Pantalla' : kinds.find(item => item.kind === node.kind)?.label}: ${label || 'Sin etiqueta'}`}
                aria-pressed={selectedId === node.id} aria-describedby={editing ? 'map-edit-help' : undefined}
                tabIndex={editing || node.kind === 'display' ? 0 : -1} disabled={saving}
                onClick={() => select(node)} onPointerDown={event => startDrag(event, node)} onPointerMove={moveDrag}
                onPointerUp={event => endDrag(event.pointerId)} onPointerCancel={event => endDrag(event.pointerId, true)} onLostPointerCapture={event => endDrag(event.pointerId, true)} onKeyDown={event => keyMove(event, node)}>
                {node.kind === 'display' ? <><strong><span className="map-screen-symbol" aria-hidden="true">▣</span>{label}</strong><small>{presence?.label ?? 'Desvinculada'}</small><small>{display ? stale ? 'Sin reporte reciente' : playbackLabel(display.actualPlaybackState) : 'Quitala del croquis'}</small></> : <span>{node.label}</span>}
              </button>
            })}
            {editing && selected && <div className="map-resize-controls" role="group" aria-label="Cambiar tamaño del elemento seleccionado">
              <div className="map-resize-box" aria-hidden="true" style={{ left: `${selected.x / MAP_WIDTH * 100}%`, top: `${selected.y / MAP_HEIGHT * 100}%`, width: `${selected.width / MAP_WIDTH * 100}%`, height: `${selected.height / MAP_HEIGHT * 100}%` }} />
              {resizeHandles.filter(item => selected.kind !== 'wall' || item.handle.length === 1).map(item => <button key={item.handle} type="button"
                className={`map-resize-handle map-resize-${item.handle}`} disabled={saving}
                aria-label={`Cambiar tamaño desde ${item.label}`} aria-describedby="map-edit-help" title={`Arrastrá para cambiar tamaño desde ${item.label}`}
                style={{ left: `clamp(12px, calc(${(selected.x + selected.width * item.x) / MAP_WIDTH * 100}% + ${(item.x - .5) * 24}px), calc(100% - 12px))`,
                  top: `clamp(12px, calc(${(selected.y + selected.height * item.y) / MAP_HEIGHT * 100}% + ${(item.y - .5) * 24}px), calc(100% - 12px))` }}
                onPointerDown={event => startDrag(event, selected, item.handle)} onPointerMove={moveDrag}
                onPointerUp={event => endDrag(event.pointerId)} onPointerCancel={event => endDrag(event.pointerId, true)} onLostPointerCapture={event => endDrag(event.pointerId, true)}
                onKeyDown={event => keyMove(event, selected, item.handle)} />)}
            </div>}
          </div>
        </div>
        <div className="map-caption"><span id="map-edit-help">{editing ? 'Arrastrá el elemento para mover o sus tiradores para cambiar tamaño. Flechas: 5 unidades · Mayús + flechas: 20 · Esc: cancelar arrastre.' : 'El estado corresponde al último reporte de cada pantalla.'}</span><span>Croquis orientativo · Sin escala</span></div>
      </div>
      <aside className="map-inspector" aria-label={editing ? 'Herramientas del croquis' : 'Pantalla seleccionada'}>
        {editing ? <>
          {nodes.length > 0 && <label className="workspace-field">Seleccionar elemento<select value={selectedId} disabled={saving} onChange={event => { setSelectedId(event.target.value); setSelectedDisplayId('') }}><option value="">Elegí un elemento</option>{nodeOptions.map(({ node, index, display }) => <option key={node.id} value={node.id}>{node.kind === 'display' && (displayPresence(display?.status).connected ? '🟢 ' : '🔴 ')}{index + 1}. {display?.name ?? (node.label || 'Sin etiqueta')}{node.kind === 'display' && ` · ${display ? displayPresence(display.status).label : 'Desvinculada'}`}</option>)}</select></label>}
          {selected ? <div className="map-properties"><p className="eyebrow">ELEMENTO SELECCIONADO</p><h3>{selected.kind === 'display' ? selectedDisplay?.name ?? selected.label : 'Editar elemento'}</h3>
            {selected.kind !== 'display' && <label className="workspace-field">Etiqueta<input maxLength={100} value={selected.label} disabled={saving} onChange={event => change(selected.id, { label: event.target.value })} /></label>}
            <div className="map-coordinates">{(['x', 'y', 'width', 'height'] as const).map(field => <label className="workspace-field" key={field}>{({ x: 'Posición X', y: 'Posición Y', width: 'Ancho', height: 'Alto' })[field]}<input type="number" step="1" min={field === 'width' || field === 'height' ? 8 : 0} max={field === 'x' || field === 'width' ? MAP_WIDTH : MAP_HEIGHT} value={selected[field]} disabled={saving} onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) change(selected.id, { [field]: event.target.valueAsNumber }) }} /></label>)}</div>
            {selected.kind !== 'display' && <label className="workspace-field">Color<select aria-label="Color del elemento" value={selected.color} disabled={saving} onChange={event => change(selected.id, { color: event.target.value as MapColor })}>{colors.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            <button disabled={saving} onClick={removeSelected}>{selected.kind === 'display' ? 'Quitar del croquis' : 'Eliminar elemento'}</button>
            {selected.kind === 'display' && <p className="map-hint">Quitarla del croquis conserva su vinculación al evento.</p>}
          </div> : <div className="map-inspector-intro"><p className="eyebrow">DISEÑÁ EL ESPACIO</p><h3>Todo en su lugar.</h3><p>Agregá figuras desde la barra. Seleccionalas para cambiar su nombre, tamaño y color.</p></div>}
          <div className="map-display-list"><h3>Pantallas sin ubicar <span>{unplaced.length}</span></h3>{!unplaced.length && <p className="map-hint">{displays.length ? 'Todas las pantallas están en el croquis.' : 'Vinculá una pantalla desde Configuración para ubicarla acá.'}</p>}{unplaced.map(({ display, presence }) => <button key={display.id} className={`connection-${presence.kind}`} disabled={saving || nodes.length >= 300} onClick={() => add('display', display)} aria-label={`Ubicar ${display.name}`} aria-description={presence.label}><span>{display.name}<small><ConnectionDot connected={presence.connected} label={presence.label} />{presence.label}</small></span><span aria-hidden="true">+</span></button>)}</div>
          {nodes.length >= 300 && <p className="map-hint">Llegaste al límite de 300 elementos.</p>}
        </> : <>
          {selectedDisplay ? <DisplayCard key={selectedDisplay.id} display={selectedDisplay} media={media} playlists={playlists} prepared={prepared[selectedDisplay.id] ?? []} now={now} onChanged={onChanged} onUpdated={onUpdated} />
            : <div className="map-inspector-intro"><p className="eyebrow">CONTROL EN VIVO</p><h3>Una pantalla, un lugar.</h3><p>Seleccioná una pantalla del mapa para ver su último reporte y acceder a sus controles.</p></div>}
          {unplaced.length > 0 && <div className="map-display-list"><h3>Sin ubicar <span>{unplaced.length}</span></h3><p className="map-hint">Podés operarlas acá o ubicarlas en Editar croquis.</p>{unplaced.map(({ display, presence }) => <button key={display.id} className={`connection-${presence.kind}`} aria-label={display.name} aria-description={presence.label} aria-pressed={selectedDisplayId === display.id} onClick={() => { setSelectedId(''); setSelectedDisplayId(display.id) }}><span>{display.name}<small><ConnectionDot connected={presence.connected} label={presence.label} />{presence.label}</small></span></button>)}</div>}
        </>}
      </aside>
    </div>
    {discard && <Dialog title="Cargar croquis guardado" busy={saving} onClose={() => setDiscard(false)}><p>Se van a descartar tus cambios locales y cargar la última versión guardada de este evento.</p><div className="button-row"><button disabled={saving} onClick={() => setDiscard(false)}>Seguir editando</button><button disabled={saving} onClick={() => void reloadSaved()}>Descartar y cargar</button></div></Dialog>}
  </div>
}
