import type { MediaAsset, MediaOptimization } from '../api/client'

export function TvOptimizationControl({ item, job, origin, result, requesting, onPreview }: {
  item: MediaAsset; job?: MediaOptimization; origin?: MediaAsset; result?: MediaAsset
  requesting: string; onPreview: (item: MediaAsset) => void
}) {
  if (item.type !== 'Video') return null
  if (origin) return <div className="tv-optimization"><strong>Copia TV lista · {Math.round((1 - item.fileSize / origin.fileSize) * 100)}% menos</strong>
    <small>{formatSize(origin.fileSize)} → {formatSize(item.fileSize)}. El original se conserva.</small>
    <button className="quiet-button" onClick={() => onPreview(origin)}>Ver original</button></div>
  const current = job?.sourceChecksum === item.checksum ||
    (job?.replaceOriginal && job.resultChecksum === item.checksum) ? job : undefined
  const pending = job?.status === 'Queued' || job?.status === 'Processing'
  const completed = current?.status === 'Completed' && result
  const noSaving = current?.status === 'NoSaving'
  if (!pending && !completed && !noSaving && current?.status !== 'Failed' && requesting !== item.id) return null
  return <div className="tv-optimization" aria-label={`Optimización de ${item.name}`}>
    {pending ? <>
      <span role="status">{job.status === 'Queued' ? 'En cola para TV' : `Reduciendo para TV… ${job.progress}%`}</span>
      <progress aria-label={`Reducción de ${item.name}`} max={100} value={job.progress} />
      <small>{job.replaceOriginal ? 'Podés cerrar esta página. Se conserva el audio; el video se reemplaza al terminar.' : 'Podés cerrar esta página. El original se conserva.'}</small>
    </> : completed ? <>
      <strong>{current.replaceOriginal ? 'Video optimizado' : 'Copia TV lista'} · {Math.round((1 - (current.optimizedSize ?? result.fileSize) / current.originalSize) * 100)}% menos</strong>
      <small>{formatSize(current.originalSize)} → {formatSize(current.optimizedSize ?? result.fileSize)}. {current.replaceOriginal ? 'Archivo reemplazado · audio conservado.' : 'El original se conserva.'}</small>
      {!current.replaceOriginal && <button className="quiet-button" onClick={() => onPreview(result)}>Ver copia TV</button>}
    </> : <>
      {noSaving ? <small>{current.error}</small> : <>
        {requesting === item.id && <span role="status">Preparando copia para TV…</span>}
        {current?.status === 'Failed' && <small className="workspace-error" role="alert">{current.error}</small>}
        {current?.status === 'Failed' && <small>Podés reintentar desde el menú de opciones.</small>}
      </>}
    </>}
  </div>
}

function formatSize(bytes: number) { return `${(bytes / 1024 ** 2).toFixed(1)} MB` }
