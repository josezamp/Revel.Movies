import { useId, useState } from 'react'
import { Dialog } from './Dialog'

export function NameDialog({ title, initialName, label = 'Nombre', submitLabel = 'Guardar', onClose, onSave }: {
  title: string; initialName: string; label?: string; submitLabel?: string; onClose: () => void; onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const errorId = useId()
  const validation = !name.trim() ? 'Ingresá un nombre.' : name.trim().length > 200 ? 'Usá hasta 200 caracteres.' : ''
  const visibleError = error || (touched ? validation : '')
  return <Dialog title={title} busy={busy} onClose={onClose}><form onSubmit={async event => {
    event.preventDefault(); if (busy || validation) { setError(validation); return }
    setBusy(true); setError('')
    try { await onSave(name.trim()); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar. Tu texto se conserva.'); setBusy(false) }
  }}><label className="workspace-field">{label}<input autoFocus value={name} maxLength={201} aria-invalid={!!visibleError} aria-describedby={visibleError ? errorId : undefined} disabled={busy} onBlur={() => setTouched(true)} onChange={event => { setName(event.target.value); setTouched(true); setError('') }} /></label>
    {visibleError && <p id={errorId} role="alert" className="workspace-error">{visibleError}</p>}<div className="playlist-dialog-footer"><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="workspace-primary" disabled={busy || !!validation}>{busy ? 'Guardando…' : submitLabel}</button></div></form></Dialog>
}
