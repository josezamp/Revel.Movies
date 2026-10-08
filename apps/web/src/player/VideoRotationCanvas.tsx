import { useEffect, useRef, useState, type RefObject } from 'react'
import { startVideoCanvas } from './videoCanvas'

export function VideoRotationCanvas({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    setReady(false)
    setFailed(false)
    const stop = startVideoCanvas(video, canvas, () => {
      // Do not hide the native picture until the first decoded frame was copied.
      video.classList.add('player-video-canvas-source')
      setReady(true)
    }, error => {
      console.error('Video rotation compatibility mode failed:', error)
      video.classList.remove('player-video-canvas-source')
      setReady(false)
      setFailed(true)
    })
    return () => {
      stop()
      video.classList.remove('player-video-canvas-source')
    }
  }, [videoRef])

  return <>
    <canvas ref={canvasRef} className="player-media player-video-canvas" hidden={!ready} aria-hidden="true" />
    {failed && <p className="player-rotation-error" role="alert">Esta TV no permite girar el video. Volvé a la orientación 0°.</p>}
  </>
}
