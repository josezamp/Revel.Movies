import { useCallback, useEffect, useRef, useState } from 'react'
import { getScheduleImportContext } from '../api/schedules'
import { Dialog } from './Dialog'
import { downloadScheduleContext } from './scheduleImport'

export function ScheduleContextDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const revision = useRef(0)
  const text = useRef<HTMLTextAreaElement>(null)
  const load = useCallback(async () => {
    const request = ++revision.current
    setLoading(true); setError(''); setFeedback('')
    try {
      const result = await getScheduleImportContext(eventId)
      if (request === revision.current) setPrompt(result.prompt)
    } catch (cause) {
      if (request === revision.current) setError(cause instanceof Error ? cause.message : 'No se pudo cargar el contexto del evento.')
    } finally { if (request === revision.current) setLoading(false) }
  }, [eventId])
  useEffect(() => { void load(); return () => { revision.current++ } }, [load])

  async function copy() {
    if (!prompt || copying) return
    const request = revision.current
    setCopying(true); setFeedback('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(prompt)
      if (request === revision.current) setFeedback('Contexto copiado. Pegalo en ChatGPT y contale tu cronograma.')
    } catch {
      if (request === revision.current) {
        text.current?.focus(); text.current?.select()
        setFeedback('El navegador no permitió copiar automáticamente. El texto quedó seleccionado: copialo con Ctrl+C (⌘C en Mac) o descargá el contexto.')
      }
    } finally { if (request === revision.current) setCopying(false) }
  }

  return <Dialog title="Contexto para ChatGPT" onClose={onClose}>
    <div className="schedule-import-context">
      <p>Copiá este contexto en ChatGPT y agregá tu cronograma. Incluye el formato de importación y el catálogo de pantallas, grupos y contenido de este evento.</p>
      <p className="workspace-help">Pedile fechas completas, el cambio de día después de medianoche y qué mostrar al finalizar cada franja. Después, traé su respuesta a “Importar JSON”.</p>
      {loading && <p role="status">Preparando el contexto del evento…</p>}
      {error && <p role="alert" className="workspace-error">{error} <button onClick={() => void load()}>Reintentar</button></p>}
      {prompt && !loading && <label className="workspace-field">Contexto del evento<textarea ref={text} className="schedule-json-input" readOnly rows={12} spellCheck={false} value={prompt} /></label>}
      {feedback && <p role="status" className="workspace-feedback">{feedback}</p>}
      <div className="playlist-dialog-footer"><button onClick={onClose}>Volver</button><button disabled={loading || !prompt || !!error} onClick={() => downloadScheduleContext(prompt, eventId)}>Descargar contexto</button><button className="workspace-primary" disabled={loading || copying || !prompt || !!error} onClick={() => void copy()}>{copying ? 'Copiando…' : 'Copiar contexto'}</button></div>
    </div>
  </Dialog>
}
