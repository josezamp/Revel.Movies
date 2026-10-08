import { useMemo, useState, type FormEvent } from 'react'
import { sendCommand, sendGroupCommand, type Display, type DisplayGroup } from '../api/client'
import { AnnouncementSurface } from '../announcements/AnnouncementSurface'
import type { Announcement } from '../announcements/announcement'

type Props = { eventId: string; displays: Display[]; groups: DisplayGroup[] }

export function AnnouncementsPanel({ eventId, displays, groups }: Props) {
  const [kind, setKind] = useState<Announcement['kind']>('countdown')
  const [text, setText] = useState('Comenzamos en unos minutos')
  const [completedText, setCompletedText] = useState('¡Comenzamos!')
  const [layout, setLayout] = useState<Announcement['layout']>('fullscreen')
  const [theme, setTheme] = useState<Announcement['theme']>('dark')
  const [timing, setTiming] = useState('duration')
  const [minutes, setMinutes] = useState('5')
  const [deadline, setDeadline] = useState('')
  const [selectedTarget, setSelectedTarget] = useState('')
  const [portrait, setPortrait] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)

  const targets = [
    ...displays.map(display => ({ value: `display:${display.id}`, label: display.name, ids: [display.id] })),
    ...groups.map(group => ({ value: `group:${group.id}`, label: `Grupo: ${group.name}`, ids: group.displayIds })),
  ]
  const target = targets.find(item => item.value === selectedTarget) ?? targets[0]
  const targetDisplays = displays.filter(display => target?.ids.includes(display.id))
  const offlineCount = targetDisplays.filter(display => display.status === 'Offline' || display.status === 2 || display.status === 'Unknown' || display.status === 0).length
  const blackoutCount = targetDisplays.filter(display => display.desiredPlaybackState === 'Blackout').length
  const seconds = Math.round(Number(minutes) * 60)
  const deadlineMs = Date.parse(deadline)
  const previewEnd = useMemo(() => {
    const timestamp = timing === 'duration' ? Date.now() + Math.min(604800, Math.max(0, seconds || 0)) * 1000 : deadlineMs
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
  }, [timing, seconds, deadlineMs])
  const preview: Announcement = {
    kind, text: text.trim() || 'Tu mensaje aparecerá aquí', layout, theme,
    endsAt: previewEnd,
    completedText: completedText.trim() || 'Mensaje al finalizar',
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!target || pending) return
    if (kind === 'countdown' && timing === 'deadline' && (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now() || deadlineMs > Date.now() + 604800000)) {
      setFeedback({ error: true, text: 'Elegí una fecha futura dentro de los próximos 7 días.' })
      return
    }
    if (!text.trim() || (kind === 'countdown' && !completedText.trim())) {
      setFeedback({ error: true, text: 'Completá el mensaje y, para una cuenta regresiva, el texto al finalizar.' })
      return
    }
    const payload = {
      kind, text: text.trim(), layout, theme,
      ...(kind === 'countdown' ? {
        completedText: completedText.trim(),
        ...(timing === 'duration' ? { durationSeconds: seconds } : { endsAt: new Date(deadlineMs).toISOString() }),
      } : {}),
    }
    await dispatch('announcement.show', payload)
  }

  async function dispatch(type: string, payload?: unknown) {
    if (!target || pending) return
    const [targetType, targetId] = target.value.split(':')
    setPending(true)
    setFeedback(null)
    try {
      if (targetType === 'group') await sendGroupCommand(targetId, type, payload)
      else await sendCommand(targetId, type, payload)
      setFeedback({ error: false, text: type === 'announcement.show'
        ? `Envío aceptado para ${target.label} (${target.ids.length} ${target.ids.length === 1 ? 'pantalla' : 'pantallas'}). Las pantallas desconectadas lo recuperarán al volver.`
        : `Retirada aceptada para ${target.label}. Las pantallas desconectadas se actualizarán al volver.` })
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : 'No se pudo enviar. Revisá la conexión e intentá de nuevo.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <section id="anuncios" className="announcements-panel" aria-labelledby="announcements-heading">
      <div className="section-heading">
        <div>
          <h2 id="announcements-heading">Anuncios</h2>
          <p className="muted">Un mensaje para tu público, en el momento indicado.</p>
        </div>
      </div>
      <div className="announcement-workspace">
        <form className="announcement-form" onSubmit={event => void publish(event)}>
          <fieldset disabled={pending}>
            <legend className="visually-hidden">Contenido del anuncio</legend>
            <div className="announcement-kind" role="group" aria-label="Tipo de anuncio">
              <button type="button" aria-pressed={kind === 'countdown'} onClick={() => setKind('countdown')}>Cuenta regresiva</button>
              <button type="button" aria-pressed={kind === 'message'} onClick={() => setKind('message')}>Mensaje</button>
            </div>
            <label>
              Mensaje
              <textarea value={text} onChange={event => setText(event.target.value)} maxLength={240} rows={3} required />
              <small>{text.length}/240 caracteres</small>
            </label>
            {kind === 'countdown' && <>
              <label>
                Finalizar la cuenta
                <select value={timing} onChange={event => setTiming(event.target.value)}>
                  <option value="duration">Después de una duración</option>
                  <option value="deadline">A una fecha y hora</option>
                </select>
              </label>
              {timing === 'duration' ? <div className="announcement-duration">
                <label>Minutos<input type="number" min="0.1" max="10080" step="0.1" value={minutes} onChange={event => setMinutes(event.target.value)} required /></label>
                <div className="button-row" aria-label="Duraciones rápidas">
                  {[1, 5, 10].map(value => <button type="button" key={value} onClick={() => setMinutes(String(value))}>{value} min</button>)}
                </div>
              </div> : <label>
                Fecha y hora local
                <input type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} required />
                <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}. Hasta 7 días desde ahora.</small>
              </label>}
              <label>
                Mensaje al llegar a cero
                <textarea value={completedText} onChange={event => setCompletedText(event.target.value)} maxLength={240} rows={2} required />
                <small>Queda visible hasta que retires o reemplaces el anuncio.</small>
              </label>
            </>}
            <div className="announcement-form-row">
              <label>Formato<select value={layout} onChange={event => setLayout(event.target.value as Announcement['layout'])}>
                <option value="fullscreen">Pantalla completa</option><option value="banner">Franja inferior</option>
              </select></label>
              <label>Fondo<select value={theme} onChange={event => setTheme(event.target.value as Announcement['theme'])}>
                <option value="dark">Oscuro</option><option value="light">Claro</option>
              </select></label>
            </div>
            <label>
              Enviar a
              <select value={target?.value ?? ''} onChange={event => { setSelectedTarget(event.target.value); setFeedback(null) }} required>
                {!targets.length && <option value="">Primero vinculá una pantalla</option>}
                {targets.map(item => <option key={item.value} value={item.value}>{item.label} ({item.ids.length})</option>)}
              </select>
            </label>
            {target && !target.ids.length && <p className="announcement-notice">Agregá pantallas al grupo para enviar anuncios.</p>}
            {offlineCount > 0 && <p className="announcement-notice">{offlineCount} sin conexión. Recibirán el anuncio al reconectarse; la cuenta no se reinicia.</p>}
            {blackoutCount > 0 && <p className="announcement-notice">{blackoutCount} en blackout. El anuncio quedará oculto hasta volver a reproducir contenido.</p>}
            <p className="announcement-help">El contenido sigue reproduciéndose debajo. Un nuevo anuncio reemplaza al anterior.</p>
            <div className="button-row">
              <button className="announcement-publish" type="submit" disabled={!eventId || !target?.ids.length}>{pending ? 'Enviando…' : 'Mostrar anuncio'}</button>
              <button type="button" disabled={!target?.ids.length} onClick={() => void dispatch('announcement.clear')}>Retirar anuncio</button>
            </div>
          </fieldset>
          {feedback && <p className={feedback.error ? 'diagnostics-error' : 'announcement-feedback'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
        </form>
        <div className="announcement-preview-column">
          <div className="announcement-preview-heading">
            <strong>Vista previa</strong>
            <label><input type="checkbox" checked={portrait} onChange={event => setPortrait(event.target.checked)} /> Vertical</label>
          </div>
          <div className={`announcement-preview ${portrait ? 'is-portrait' : ''}`}>
            {layout === 'banner' && <span className="announcement-preview-placeholder">Tu contenido sigue aquí</span>}
            <AnnouncementSurface announcement={preview} showCompleted={showCompleted} previewSeconds={timing === 'duration' ? Math.min(604800, Math.max(0, seconds || 0)) : undefined} />
          </div>
          {kind === 'countdown' && <label className="announcement-completion-toggle"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} /> Ver mensaje al finalizar</label>}
          <p className="announcement-help">{kind === 'countdown' && timing === 'duration' ? 'La duración comienza al enviar. ' : ''}La orientación real respeta la configuración de cada pantalla.</p>
          {targetDisplays.length > 0 && <div className="announcement-assigned">
            <h3>Anuncios asignados</h3>
            <ul>{targetDisplays.map(display => <li key={display.id}>
              <strong>{display.name}</strong>
              <span>{display.announcement ? `${display.announcement.kind === 'countdown' ? 'Cuenta regresiva' : 'Mensaje'}: ${display.announcement.text}` : 'Sin anuncio'}</span>
            </li>)}</ul>
            <small>Estado guardado. El envío aceptado no confirma que la pantalla ya lo muestre.</small>
          </div>}
        </div>
      </div>
    </section>
  )
}
