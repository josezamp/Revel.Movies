import { useEffect, useRef, useState, type FormEvent } from 'react'
import { sendCommand, sendGroupCommand, type Display, type DisplayGroup } from '../api/client'
import { webPageUrlError } from '../webpages/webPage'

type Props = { eventId: string; displays: Display[]; groups: DisplayGroup[] }

export function WebPagePanel({ eventId, displays, groups }: Props) {
  const [url, setUrl] = useState('')
  const [selectedTarget, setSelectedTarget] = useState('')
  const [pending, setPending] = useState(false)
  const sending = useRef(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const targets = [
    ...displays.map(display => ({ value: `display:${display.id}`, label: display.name, ids: [display.id] })),
    ...groups.map(group => ({ value: `group:${group.id}`, label: `Grupo: ${group.name}`, ids: group.displayIds })),
  ]
  const target = targets.find(item => item.value === selectedTarget)
  useEffect(() => { if (selectedTarget && !target) setSelectedTarget('') }, [selectedTarget, target])
  const targetDisplays = displays.filter(display => target?.ids.includes(display.id))
  const blackedOut = targetDisplays.filter(display => display.blackout ?? display.desiredPlaybackState === 'Blackout').length

  async function dispatch(type: 'webpage.show' | 'webpage.clear') {
    if (!target?.ids.length || sending.current) return
    const error = type === 'webpage.show' ? webPageUrlError(url, window.location.href) : null
    if (error) { setFeedback({ error: true, text: error }); return }
    sending.current = true
    setPending(true)
    setFeedback(null)
    const [kind, id] = target.value.split(':')
    try {
      const payload = type === 'webpage.show' ? { url: new URL(url.trim()).href } : undefined
      if (kind === 'group') await sendGroupCommand(id, type, payload)
      else await sendCommand(id, type, payload)
      setFeedback({ error: false, text: `${type === 'webpage.show' ? 'URL guardada' : 'Retirada aceptada'} para ${target.label}. Las pantallas sin conexión se actualizarán al volver.` })
    } catch (cause) {
      setFeedback({ error: true, text: cause instanceof Error ? cause.message : 'No se pudo enviar la página.' })
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void dispatch('webpage.show') }

  return <section id="paginas-web" aria-labelledby="webpages-heading">
    <div className="section-heading"><div>
      <h2 id="webpages-heading">Página web</h2>
      <p className="muted">El concurso, un tablero o cualquier página preparada para proyectarse.</p>
    </div></div>
    <div className="announcement-workspace webpage-workspace">
      <form className="announcement-form" onSubmit={submit}>
        <fieldset disabled={pending}>
          <legend className="visually-hidden">Proyectar una página web</legend>
          <label>URL de la página
            <input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://tu-evento.com/halloween/2026/concurso/live" maxLength={2048} required />
            <small>Usá la dirección pública que pueden abrir las pantallas.</small>
          </label>
          <label>Proyectar en
            <select value={target?.value ?? ''} onChange={event => { setSelectedTarget(event.target.value); setFeedback(null) }} required>
              <option value="">Elegí una pantalla o un grupo</option>
              {targets.map(item => <option key={item.value} value={item.value}>{item.label} ({item.ids.length})</option>)}
            </select>
          </label>
          {target && !target.ids.length && <p className="announcement-notice">Agregá pantallas al grupo para proyectar.</p>}
          {blackedOut > 0 && <p className="announcement-notice">{blackedOut} con la imagen oscurecida. Usá «Restaurar imagen» en la tarjeta de la pantalla para volver a mostrar su contenido.</p>}
          <p className="content-target-names">{targetDisplays.map(display => display.name).join(', ')}</p><div className="button-row">
            <button className="announcement-publish" type="submit" disabled={!eventId || !target?.ids.length}>{pending ? 'Enviando…' : target ? `Mostrar página en ${target.label}` : 'Mostrar página · elegí destino'}</button>
            <button type="button" disabled={!target?.ids.length} onClick={() => void dispatch('webpage.clear')}>Retirar página</button>
          </div>
        </fieldset>
        {feedback && <p className={feedback.error ? 'diagnostics-error' : 'announcement-feedback'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
      </form>
      <div className="webpage-details">
        <h3>La misma pantalla, otra fuente</h3>
        <p>La página ocupa toda la pantalla y respeta su orientación. Al retirarla vuelve a verse la multimedia, que sigue reproduciéndose debajo. Los anuncios siguen apareciendo por encima.</p>
        <p className="announcement-help">El sitio debe permitir que Revel lo muestre dentro de una página. Si queda en blanco, revisá sus permisos de inserción y la conexión de la TV. Guardar la URL no confirma la carga del sitio.</p>
        {targetDisplays.length > 0 && <div className="announcement-assigned">
          <h3>Páginas asignadas</h3>
          <ul>{targetDisplays.map(display => <li key={display.id}>
            <strong>{display.name}</strong><span>{display.webPage?.url ?? 'Sin página web'}</span>
          </li>)}</ul>
        </div>}
      </div>
    </div>
  </section>
}
