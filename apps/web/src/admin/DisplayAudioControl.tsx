import { useId, useState } from 'react'
import { updateDisplaySettings, type Display } from '../api/client'
import { Switch } from '../components/ui/switch'
import './audioSettings.css'

export function DisplayAudioControl({ display, onUpdated, onChanged, disabled = false }: {
  display: Display; onUpdated: (display: Display) => void; onChanged: () => Promise<void>; disabled?: boolean
}) {
  const id = useId()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(audioEnabled: boolean) {
    if (saving || disabled) return
    setSaving(true)
    setError('')
    try {
      onUpdated(await updateDisplaySettings(display.id, { audioEnabled }))
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el audio de esta pantalla.')
    } finally { setSaving(false) }
  }

  return <div className="display-orientation display-audio-setting">
    <div className="display-orientation-heading"><label htmlFor={id}>Audio</label>{saving && <small role="status">Guardando…</small>}</div>
    <div className="display-audio-toggle"><Switch id={id} aria-label={`Audio de ${display.name}`} aria-describedby={`${id}-help`}
      checked={display.audioEnabled !== false} disabled={disabled || saving} onCheckedChange={audioEnabled => void save(audioEnabled)} />
      <span>{display.audioEnabled === false ? 'Silenciado' : 'Activado'}</span></div>
    <small id={`${id}-help`} className="display-image-fit-help">Controla el sonido de los videos de esta pantalla. Al activarlo, el navegador puede pedir tocar «Activar audio» en el dispositivo.</small>
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </div>
}
