import type { SelectHTMLAttributes } from 'react'
import type { DisplayTarget } from './displayTargets'

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & { targets: DisplayTarget[] }

export function DisplayTargetSelect({ targets, ...props }: Props) {
  return <select {...props}>
    <option value="">Elegí una pantalla o un grupo</option>
    {targets.map(target => <option key={target.value} value={target.value}>
      {target.connected ? '🟢' : '🔴'} {target.label} · {target.statusLabel}
    </option>)}
  </select>
}
