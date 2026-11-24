import { useCallback, useEffect, useRef, useState } from 'react'
import './fullscreen.css'

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => Promise<void> | void
}
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

function fullscreenElement() {
  return document.fullscreenElement ?? (document as FullscreenDocument).webkitFullscreenElement ?? null
}

function fullscreenSupported() {
  const root = document.documentElement as FullscreenElement
  if (typeof root.requestFullscreen === 'function')
    return document.fullscreenEnabled !== false && typeof document.exitFullscreen === 'function'
  return typeof root.webkitRequestFullscreen === 'function'
    && typeof (document as FullscreenDocument).webkitExitFullscreen === 'function'
    && (document as FullscreenDocument).webkitFullscreenEnabled !== false
}

export function PlayerFullscreenControl({ autoHide = false }: { autoHide?: boolean }) {
  const [supported] = useState(fullscreenSupported)
  const [active, setActive] = useState(() => !!fullscreenElement())
  const [visible, setVisible] = useState(true)
  const [error, setError] = useState('')
  const controlsRef = useRef<HTMLDivElement>(null)
  const focusToggle = useRef(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const changing = useRef(false)

  const showControls = useCallback(() => {
    setVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      // Keep keyboard users' focused controls on screen.
      if (!controlsRef.current?.contains(document.activeElement)) setVisible(false)
    }, 4000)
  }, [])

  const toggle = useCallback(async () => {
    if (!supported || changing.current) return
    changing.current = true
    setError('')
    showControls()
    try {
      if (fullscreenElement()) {
        if (typeof document.exitFullscreen === 'function') await document.exitFullscreen()
        else await (document as FullscreenDocument).webkitExitFullscreen?.()
      } else {
        // Request the whole document so pairing, media and overlays can change without exiting.
        const root = document.documentElement as FullscreenElement
        if (typeof root.requestFullscreen === 'function') await root.requestFullscreen({ navigationUI: 'hide' })
        else await root.webkitRequestFullscreen?.()
      }
    } catch {
      setError('No se pudo cambiar a pantalla completa. Volvé a intentarlo desde este dispositivo.')
    } finally {
      changing.current = false
    }
  }, [showControls, supported])

  useEffect(() => {
    showControls()
    function syncFullscreen() {
      setActive(!!fullscreenElement())
      setError('')
      showControls()
    }
    function fullscreenError() {
      setError('No se pudo cambiar a pantalla completa. Volvé a intentarlo desde este dispositivo.')
      showControls()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))) return
      if (event.key.toLowerCase() !== 'f' || !supported) return
      event.preventDefault()
      void toggle()
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('webkitfullscreenchange', syncFullscreen)
    document.addEventListener('fullscreenerror', fullscreenError)
    document.addEventListener('webkitfullscreenerror', fullscreenError)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointermove', showControls, { passive: true })
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('webkitfullscreenchange', syncFullscreen)
      document.removeEventListener('fullscreenerror', fullscreenError)
      document.removeEventListener('webkitfullscreenerror', fullscreenError)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointermove', showControls)
      window.clearTimeout(hideTimer.current)
    }
  }, [showControls, supported, toggle])

  const hidden = (autoHide || active) && !visible
  const label = active ? 'Salir de pantalla completa' : 'Pantalla completa'

  return (
    <div className="player-fullscreen" ref={controlsRef}
      onFocusCapture={event => { if (!event.target.classList.contains('player-fullscreen-reveal')) showControls() }}
      onBlurCapture={showControls}>
      {hidden ? (
        <button type="button" className="player-fullscreen-reveal" aria-label="Mostrar controles de pantalla"
          onClick={event => {
            focusToggle.current = event.detail === 0
            if (event.detail > 0) event.currentTarget.blur()
            showControls()
          }}>
          <span aria-hidden="true">⛶</span>
        </button>
      ) : (
        <div className="player-fullscreen-panel">
          <button type="button" className="player-fullscreen-toggle" disabled={!supported} aria-keyshortcuts="f"
            ref={node => { if (node && focusToggle.current) { focusToggle.current = false; node.focus() } }}
            onClick={event => { if (event.detail > 0) event.currentTarget.blur(); void toggle() }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d={active ? 'M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5' : 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5'} />
            </svg>
            {label}
          </button>
          {supported ? <p>Tecla F · Tocá la esquina superior derecha para mostrar este control.</p>
            : <p>Este navegador no permite pantalla completa. Probá abrir el reproductor en otro navegador.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
