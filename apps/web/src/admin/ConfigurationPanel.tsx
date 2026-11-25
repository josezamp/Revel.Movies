import { useState } from 'react'
import { pairDisplay, renameDisplay, sendCommand, type Display, type DisplayGroup, type PendingPairing } from '../api/client'
import { DisplayAudioControl } from './DisplayAudioControl'
import { ConnectionDot } from './DisplayName'
import { displayPresence } from './displayPresence'
import { NameDialog } from './NameDialog'

type Props = {
  eventId: string; eventName?: string; pending: PendingPairing[]; displays: Display[]; groups: DisplayGroup[]
  onChanged: () => Promise<void>; onUpdated: (display: Display) => void; onShowLive: () => void
}

// Pairing and per-screen settings: the two things an operator sets up once, before the event.
export function ConfigurationPanel({ eventId, eventName, pending, displays, groups, onChanged, onUpdated, onShowLive }: Props) {
  const [pairing, setPairing] = useState<PendingPairing>()
  const [paired, setPaired] = useState('')
  const [renaming, setRenaming] = useState<Display>()
  const [copied, setCopied] = useState(false)
  const [identifying, setIdentifying] = useState('')
  const [identified, setIdentified] = useState('')
  const [error, setError] = useState('')
  const address = `${window.location.origin}/player`

  async function copyAddress() {
    try { await navigator.clipboard.writeText(address); setCopied(true); window.setTimeout(() => setCopied(false), 2500) }
    catch { setCopied(false) }
  }

  async function identify(display: Display) {
    if (identifying) return
    setIdentifying(display.id); setIdentified(''); setError('')
    try { await sendCommand(display.id, 'display.identify'); setIdentified(display.id); window.setTimeout(() => setIdentified(current => current === display.id ? '' : current), 4000) }
    catch (cause) { setError(cause instanceof Error ? cause.message : `No se pudo identificar ${display.name}.`) }
    finally { setIdentifying('') }
  }

  return <>
    <section className="config-section" aria-labelledby="pairing-heading">
      <div className="workspace-heading"><div><h2 id="pairing-heading">Agregar pantalla</h2><p>Abrí esta dirección en el navegador de la TV. Va a mostrar un código de 6 dígitos, que aparece acá para vincularla.</p></div></div>
      <div className="player-address"><code>{address}</code><button onClick={() => void copyAddress()}>{copied ? 'Dirección copiada' : 'Copiar dirección'}</button><a href="/player" target="_blank" rel="noreferrer">Abrir el reproductor acá</a></div>
      {paired && <p role="status" className="workspace-feedback config-paired"><span>«{paired}» quedó vinculada{eventName ? ` a ${eventName}` : ''}.</span> <button onClick={onShowLive}>Ver en En vivo</button></p>}
      {pending.length === 0
        ? <p className="muted pairing-waiting">Ninguna TV espera vinculación. Cuando abras el reproductor, su código aparece acá en unos segundos.</p>
        : <ul className="pairing-list" aria-label="Pantallas que esperan vinculación">{pending.map(item => <li key={item.code}>
          <strong className="pair-code">{item.code.slice(0, 3)} {item.code.slice(3)}</strong>
          <span>Comprobá que la TV muestre este código.</span>
          <button className="workspace-primary" disabled={!eventId} aria-label={`Vincular la pantalla con código ${item.code}`} onClick={() => { setPaired(''); setPairing(item) }}>Vincular</button>
        </li>)}</ul>}
    </section>
    <section className="config-section" aria-label="Pantallas del evento">
      <div className="workspace-heading"><div><h2>Pantallas del evento <span className="count-badge">{displays.length}</span></h2><p>El audio se guarda por pantalla y se conserva al reconectar. Orientación, mantenimiento y diagnóstico están en «Detalles» de cada pantalla en En vivo.</p></div></div>
      {error && <p role="alert" className="workspace-error">{error}</p>}
      {displays.length === 0 ? <p className="muted">Todavía no hay pantallas en este evento. Vinculá la primera desde arriba.</p> : <ul className="config-displays">{displays.map(display => {
        const presence = displayPresence(display.status)
        const memberOf = groups.filter(group => group.displayIds.includes(display.id)).map(group => group.name)
        return <li key={display.id}>
          <div className="config-display-name"><ConnectionDot connected={presence.connected} label={presence.label} /><strong>{display.name}</strong>
            <button className="display-rename" aria-label={`Renombrar ${display.name}`} title="Renombrar" onClick={() => setRenaming(display)}>✎</button></div>
          <span className="config-display-meta">{presence.label} · {memberOf.length ? `${memberOf.length === 1 ? 'Grupo' : 'Grupos'}: ${memberOf.join(', ')}` : 'Sin grupo'}</span>
          <DisplayAudioControl compact display={display} onChanged={onChanged} onUpdated={onUpdated} />
          <button className="config-identify" disabled={!presence.connected || !!identifying} title={presence.connected ? 'Muestra el nombre en la TV unos segundos' : 'La pantalla está desconectada'} aria-label={`Identificar ${display.name}`} onClick={() => void identify(display)}>
            {identifying === display.id ? 'Enviando…' : identified === display.id ? 'Enviado ✓' : 'Identificar'}</button>
        </li>
      })}</ul>}
    </section>
    {pairing && <NameDialog title={`Vincular pantalla ${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}`} initialName="" label="Nombre de la pantalla (por ejemplo, «TV Salón»)" submitLabel="Vincular" onClose={() => setPairing(undefined)} onSave={async name => {
      await pairDisplay(pairing.code, name, eventId); setPaired(name); await onChanged()
    }} />}
    {renaming && <NameDialog title="Renombrar pantalla" initialName={renaming.name} onClose={() => setRenaming(undefined)} onSave={async name => { onUpdated(await renameDisplay(renaming.id, name)); await onChanged() }} />}
  </>
}
