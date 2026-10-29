import { useRef, useState, type FormEvent } from 'react'
import { createMediaLink } from '../api/client'
import { webPageUrlError } from '../webpages/webPage'
import { Dialog } from './Dialog'

export function MediaLinkDialog({ eventId, onSaved, onClose }: {
  eventId: string; onSaved: () => void; onClose: () => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const urlRef = useRef<HTMLInputElement>(null)
  const saving = useRef(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    const invalid = webPageUrlError(url, window.location.href)
    if (invalid) { setError(invalid); return }
    saving.current = true; setBusy(true); setError('')
    try { await createMediaLink(eventId, name.trim(), url.trim()); onSaved() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el enlace.') }
    finally { saving.current = false; setBusy(false) }
  }

  return <Dialog title="Agregar enlace" busy={busy} onClose={onClose} initialFocusRef={urlRef}>
    <form className="library-link-form" onSubmit={event => void submit(event)}>
      <p className="workspace-help">Guardá un sitio web para tenerlo a mano y mostrarlo en tus pantallas.</p>
      <label className="workspace-field">URL del sitio web<input ref={urlRef} type="url" required maxLength={2048} placeholder="https://tu-sitio.com"
        value={url} onChange={event => setUrl(event.target.value)} disabled={busy} /></label>
      <label className="workspace-field">Nombre del enlace <small>Opcional; si lo dejás vacío, usamos el dominio.</small><input maxLength={200} placeholder="Por ejemplo, resultados del concurso"
        value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
      <p className="workspace-help">Para verlo en una pantalla, el sitio debe permitir su inserción y tener conexión a internet.</p>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      <div className="playlist-dialog-footer"><button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="workspace-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar enlace'}</button></div>
    </form>
  </Dialog>
}
