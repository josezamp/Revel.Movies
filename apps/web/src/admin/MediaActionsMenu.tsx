import type { MediaAsset, MediaOptimization } from '../api/client'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu'

export function MediaActionsMenu({ item, job, origin, result, available, requesting, busy, onStart, onRemove }: {
  item: MediaAsset; job?: MediaOptimization; origin?: MediaAsset; result?: MediaAsset; available?: boolean
  requesting: string; busy: boolean; onStart: (id: string) => Promise<void>; onRemove: () => void
}) {
  const current = job?.sourceChecksum === item.checksum ||
    (job?.replaceOriginal && job.resultChecksum === item.checksum) ? job : undefined
  const pending = job?.status === 'Queued' || job?.status === 'Processing'
  const canReduce = item.type === 'Video' && !origin && !(current?.status === 'Completed' && result) && current?.status !== 'NoSaving'
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <button type="button" className="library-more-actions" aria-label={`Más opciones de ${item.name}`} title="Más opciones" disabled={busy}><span aria-hidden="true">⋯</span></button>
  </DropdownMenuTrigger><DropdownMenuContent align="end">
    <DropdownMenuLabel>{item.name}</DropdownMenuLabel>
    {canReduce && <><DropdownMenuItem disabled={!available || !!requesting || pending} onSelect={() => void onStart(item.id)} textValue="Reducir tamaño para TV">
      <span>{pending ? 'Reducción para TV en curso' : requesting === item.id ? 'Preparando…' : current?.status === 'Failed' ? 'Reintentar reducción para TV' : 'Reducir tamaño para TV'}</span>
      <small>{available === false ? 'Requiere habilitar FFmpeg en el servidor.' : current?.replaceOriginal
        ? 'Optimiza y reemplaza el video, conservando el audio.' : 'Crea una copia conservando el audio, hasta 1080p y 30 FPS. Conserva el original.'}</small>
    </DropdownMenuItem><DropdownMenuSeparator /></>}
    <DropdownMenuItem variant="destructive" disabled={busy} onSelect={onRemove}>Eliminar</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>
}
