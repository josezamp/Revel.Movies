import { useRef, useState } from 'react'
import { cleanEventMedia, getMediaCleanupPreview, type MediaCleanupPreview, type MediaCleanupResult } from '../api/client'
import { Dialog } from './Dialog'

export function MediaCleanupControl({ eventId, onCleaned }: { eventId: string; onCleaned: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<MediaCleanupPreview>()
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<MediaCleanupResult>()
  const running = useRef(false)

  async function review() {
    if (running.current) return
    running.current = true; setBusy(true); setOpen(true); setError(''); setPreview(undefined); setConfirmation(''); setResult(undefined)
    try { setPreview(await getMediaCleanupPreview(eventId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo revisar el almacenamiento.') }
    finally { running.current = false; setBusy(false) }
  }

  async function clean() {
    if (running.current || !preview || confirmation !== 'ELIMINAR') return
    running.current = true; setBusy(true); setError('')
    try {
      const outcome = await cleanEventMedia(eventId, preview.snapshotToken, confirmation)
      setResult(outcome); setPreview(undefined); setConfirmation('')
      await onCleaned()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la limpieza. Revisá el resumen para reintentar.')
      setPreview(undefined); setConfirmation('')
    } finally { running.current = false; setBusy(false) }
  }

  return <>
    <button type="button" className="danger-button" disabled={busy} onClick={() => void review()}>Limpiar archivos del evento</button>
    {open && <Dialog title="Limpiar archivos del evento" busy={busy} onClose={() => setOpen(false)}>
      {preview && <>
        <p>Vas a eliminar físicamente los archivos de <strong>«{preview.eventName}»</strong>. Esta acción es irreversible.</p>
        <dl className="cleanup-summary">
          <div><dt>Archivos en la biblioteca</dt><dd>{preview.mediaCount}</dd></div>
          <div><dt>Archivos físicos, incluidas copias para TV</dt><dd>{preview.fileCount}</dd></div>
          <div><dt>Archivos huérfanos incluidos</dt><dd>{preview.orphanFileCount}</dd></div>
          <div><dt>Archivos temporales asociados</dt><dd>{preview.temporaryFileCount}</dd></div>
          <div><dt>Espacio a liberar</dt><dd>{formatBytes(preview.totalBytes)}</dd></div>
        </dl>
        <p>Se detendrá la reproducción y se recargarán las pantallas de este evento. Sus playlists quedarán vacías y las escenas que usen estos archivos necesitarán contenido nuevo.</p>
        <p className="workspace-help">Se conservan el evento y sus pantallas vinculadas. Los archivos de otros eventos no se modifican.</p>
        <label className="workspace-field">Escribí ELIMINAR para confirmar
          <input autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
        </label>
      </>}
      {busy && <p role="status">{preview ? 'Eliminando archivos…' : 'Revisando almacenamiento…'}</p>}
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {result && <div role="status">
        <p><strong>{result.failedFileCount ? 'Limpieza parcial.' : 'Archivos eliminados.'}</strong> {result.deletedFileCount} archivos borrados · {formatBytes(result.freedBytes)} liberados.</p>
        {result.warnings.map(warning => <p className="workspace-error" key={warning}>{warning}</p>)}
      </div>}
      <div className="playlist-dialog-footer">
        <button disabled={busy} onClick={() => setOpen(false)}>{result ? 'Cerrar' : 'Cancelar'}</button>
        {preview ? <button className="danger-button" disabled={busy || confirmation !== 'ELIMINAR'} onClick={() => void clean()}>Eliminar todos los archivos del evento</button>
          : !busy && (!result || result.failedFileCount > 0) && <button onClick={() => void review()}>Revisar de nuevo</button>}
      </div>
    </Dialog>}
  </>
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
