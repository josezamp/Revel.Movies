import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { countdownSeconds, formatCountdown, type Announcement } from './announcement'

type Props = { announcement: Announcement; getNow?: () => number; showCompleted?: boolean; previewSeconds?: number }

// Shared by the editor preview and the player: typography and completion behavior stay identical.
export function AnnouncementSurface({ announcement, getNow = Date.now, showCompleted = false, previewSeconds }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (announcement.kind !== 'countdown' || previewSeconds !== undefined) return
    const timer = window.setInterval(() => setTick(tick => tick + 1), 250)
    return () => window.clearInterval(timer)
  }, [announcement.kind, previewSeconds])

  const seconds = previewSeconds ?? (announcement.endsAt ? countdownSeconds(announcement.endsAt, getNow()) : 0)
  const completed = announcement.kind === 'countdown' && (showCompleted || seconds === 0)
  const displayText = completed ? announcement.completedText : announcement.text
  const hasClock = announcement.kind === 'countdown' && !completed

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    const text = textRef.current
    const frame = surface?.parentElement
    if (!surface || !text || !frame) return
    const fit = () => {
      text.style.fontSize = ''
      const style = getComputedStyle(surface)
      const clock = surface.querySelector<HTMLElement>('.announcement-clock')
      const maxHeight = announcement.layout === 'banner' ? frame.clientHeight * 0.4 : frame.clientHeight
      const available = maxHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        - (announcement.layout === 'fullscreen' && clock ? clock.offsetHeight + parseFloat(style.rowGap) : 0)
      let size = parseFloat(getComputedStyle(text).fontSize)
      // Multiline messages must fit too; shrinking is based on the rendered text, not character estimates.
      for (let attempt = 0; attempt < 5 && available > 0 && text.scrollHeight > available; attempt++) {
        size = Math.max(1, size * available / text.scrollHeight * 0.95)
        text.style.fontSize = `${size}px`
      }
    }
    fit()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    observer?.observe(frame)
    window.addEventListener('resize', fit)
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit) }
  }, [displayText, hasClock, announcement.layout])

  return (
    <div ref={surfaceRef} className={`announcement-surface announcement-${announcement.layout} announcement-${announcement.theme}`}>
      <p ref={textRef} className="announcement-text">{displayText}</p>
      {hasClock && (
        <div className="announcement-clock" role="timer" aria-label="Tiempo restante" aria-live="off">
          {formatCountdown(seconds)}
        </div>
      )}
    </div>
  )
}
