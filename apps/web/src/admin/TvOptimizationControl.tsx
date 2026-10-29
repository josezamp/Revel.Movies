import type { MediaAsset, MediaOptimization } from '../api/client'

export function TvOptimizationControl({ item, job, origin, result, available, requesting, onStart, onPreview }: {
  item: MediaAsset; job?: MediaOptimization; origin?: MediaAsset; result?: MediaAsset
  available?: boolean; requesting: string; onStart: (id: string) => Promise<void>; onPreview: (item: MediaAsset) => void
}) {
  if (item.type !== 'Video') return null
  if (origin) return <div className="tv-optimization"><strong>Copia para TV · Sin audio</strong>
    <button className="quiet-button" onClick={() => onPreview(origin)}>Ver original</button></div>
  const current = job?.sourceChecksum === item.checksum ? job : undefined
  const pending = job?.status === 'Queued' || job?.status === 'Processing'
  const completed = current?.status === 'Completed' && result
  const noSaving = current?.status === 'NoSaving'
  return <div className="tv-optimization" aria-label={`Optimización de ${item.name}`}>
    {pending ? <>
      <span role="status">{job.status === 'Queued' ? 'En cola para TV' : `Reduciendo para TV… ${job.progress}%`}</span>
      <progress aria-label={`Reducción de ${item.name}`} max={100} value={job.progress} />
      <small>Podés cerrar esta página. El original se conserva.</small>
    </> : completed ? <>
      <strong>Copia TV lista · {Math.round((1 - (current.optimizedSize ?? result.fileSize) / current.originalSize) * 100)}% menos</strong>
      <small>{formatSize(current.originalSize)} → {formatSize(current.optimizedSize ?? result.fileSize)}. El original se conserva.</small>
      <button className="quiet-button" onClick={() => onPreview(result)}>Ver copia TV</button>
    </> : <>
      {noSaving ? <small>{current.error}</small> : <>
        <button disabled={!available || !!requesting} onClick={() => void onStart(item.id)}>
          {requesting === item.id ? 'Preparando…' : current?.status === 'Failed' ? 'Reintentar reducción para TV' : 'Reducir tamaño para TV'}
        </button>
        {current?.status === 'Failed' && <small className="workspace-error" role="alert">{current.error}</small>}
        <small>Creá una copia sin audio, hasta 1080p y 30 FPS. Se conserva el original.</small>
      </>}
    </>}
  </div>
}

function formatSize(bytes: number) { return `${(bytes / 1024 ** 2).toFixed(1)} MB` }
