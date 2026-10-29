import { useLayoutEffect, useRef, type RefObject } from 'react'

type Props = {
  src: string
  active: boolean
  prepare: boolean
  activeVideoRef: RefObject<HTMLVideoElement | null>
  hidden: boolean
  loop: boolean
  onEnded: () => void
  onError: () => void
}

// Keep the same native element when a queued video becomes active: its decoded
// frames and buffered ranges are useful even on HTTP TVs without a service worker.
export function PreloadedVideo({ src, active, prepare, activeVideoRef, hidden, loop, onEnded, onError }: Props) {
  const ref = useRef<HTMLVideoElement>(null)
  const sourceAssignedRef = useRef(false)

  useLayoutEffect(() => {
    const video = ref.current!
    return () => {
      video.pause()
      video.removeAttribute('src')
      video.load() // Release obsolete downloads and decoder resources.
      sourceAssignedRef.current = false
    }
  }, [src])

  useLayoutEffect(() => {
    const video = ref.current!
    // Give the current video its initial playback reserve before starting more
    // requests. Once started, retain queued buffers across playlist transitions.
    if ((active || prepare) && !sourceAssignedRef.current) {
      sourceAssignedRef.current = true
      video.src = src
    }
  }, [src, active, prepare])

  useLayoutEffect(() => {
    const video = ref.current!
    if (!active) {
      video.pause()
      if (video.readyState >= 1 && video.currentTime > 0) video.currentTime = 0
      return
    }
    activeVideoRef.current = video
    return () => {
      if (activeVideoRef.current === video) activeVideoRef.current = null
    }
  }, [active, activeVideoRef])

  return <video ref={ref} className={active ? 'player-media' : 'player-preload'}
    hidden={!active || hidden} aria-hidden={!active || hidden} preload="auto"
    loop={active && loop} muted playsInline
    onEnded={active ? onEnded : undefined} onError={active ? onError : undefined} />
}
