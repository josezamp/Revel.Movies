import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'

export function Dialog({ title, busy = false, onClose, children, initialFocusRef }: {
  title: string; busy?: boolean; onClose: () => void; children: ReactNode; initialFocusRef?: RefObject<HTMLElement | null>
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    dialog.showModal()
    initialFocusRef?.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [initialFocusRef])
  return (
    <dialog ref={ref} className="playlist-dialog" aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        )).filter(element => element.getClientRects().length > 0)
        const first = elements[0], last = elements[elements.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
      <div className="playlist-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="quiet-button" aria-label="Cerrar modal" disabled={busy} onClick={onClose}>✕</button>
      </div>
      {children}
    </dialog>
  )
}
