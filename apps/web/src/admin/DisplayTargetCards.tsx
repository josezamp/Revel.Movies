import { useId } from 'react'
import { Switch } from '../components/ui/switch'
import type { DisplayTarget } from './displayTargets'

export function DisplayTargetCards({ targets, value, onChange, onlineOnly, onOnlineOnlyChange }: {
  targets: DisplayTarget[]; value: string; onChange: (value: string) => void
  onlineOnly: boolean; onOnlineOnlyChange: (value: boolean) => void
}) {
  const id = useId()
  const visible = targets.filter(target => !onlineOnly || target.connected)
  return <div className="destination-picker">
    <div className="destination-heading">
      <div><h3 id={`${id}-heading`}>Destino de reproducción</h3><p>Elegí dónde reproducir el contenido.</p></div>
      <label className="destination-filter" htmlFor={`${id}-online`}><Switch id={`${id}-online`} checked={onlineOnly} onCheckedChange={onOnlineOnlyChange} />Solo en línea</label>
    </div>
    <div className="destination-cards" role="radiogroup" aria-labelledby={`${id}-heading`}>
      {visible.map(target => <label key={target.value} className={`destination-card${value === target.value ? ' is-selected' : ''}`}>
        <input type="radio" name={`${id}-destination`} value={target.value} checked={value === target.value} onChange={() => onChange(target.value)}
          onFocus={event => event.currentTarget.closest('label')?.scrollIntoView({ block:'nearest', inline:'nearest' })} />
        <span className="destination-card-top"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          {target.kind === 'group' ? <><rect x="2" y="3" width="15" height="11" rx="2" /><path d="M7 17h13a2 2 0 0 0 2-2V8M9 14v4m-4 0h8" /></> : <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M12 17v4m-5 0h10" /></>}
        </svg><span className="destination-check" aria-hidden="true">{value === target.value ? '✓' : ''}</span></span>
        <strong title={target.label}>{target.label}</strong>
        <span className="destination-status"><i className={target.connected ? 'is-online' : ''} aria-hidden="true" />{target.statusLabel}</span>
      </label>)}
    </div>
    {!visible.length && <p className="destination-empty" role="status">{onlineOnly ? 'No hay pantallas ni grupos completamente en línea.' : 'Todavía no hay pantallas vinculadas a este evento.'}
      {onlineOnly && <button type="button" className="quiet-button" onClick={() => onOnlineOnlyChange(false)}>Mostrar todos los destinos</button>}</p>}
    {onlineOnly && targets.some(target => target.kind === 'group') && <p className="workspace-help">Se muestran los grupos con todas sus pantallas conectadas.</p>}
  </div>
}
