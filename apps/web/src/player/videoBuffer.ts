// Native video buffers are browser-managed. Wait for a useful reserve before
// playback, with a time limit for devices that cap preloading while paused.
export const playbackBufferSeconds = 15
export const maxBufferWaitMs = 15_000

type BufferedVideo = Pick<HTMLVideoElement, 'buffered' | 'currentTime' | 'duration' | 'readyState' | 'paused' | 'seeking'>

export function bufferedSecondsAhead(video: BufferedVideo, position = video.currentTime): number {
  for (let index = 0; index < video.buffered.length; index++) {
    if (video.buffered.start(index) <= position && video.buffered.end(index) > position)
      return video.buffered.end(index) - position
  }
  return 0
}

export function hasPlaybackBuffer(video: BufferedVideo, position = video.currentTime): boolean {
  if (!Number.isFinite(position) || position < 0 || video.readyState < 3) return false
  const remaining = Number.isFinite(video.duration) ? video.duration - position : Infinity
  if (remaining <= 0) return false
  const required = Math.min(playbackBufferSeconds, remaining)
  return bufferedSecondsAhead(video, position) >= Math.max(0.01, required - 0.05)
}

export function canCorrectPlayback(video: BufferedVideo, position: number): boolean {
  return !video.paused && !video.seeking && hasPlaybackBuffer(video, position)
}

export function bufferVideoPlayback(video: HTMLVideoElement, onBuffering: (buffering: boolean) => void): () => void {
  let disposed = false
  let waiting = false
  let waitStartedAt = 0

  const checkBuffer = () => {
    if (disposed || !waiting || video.error || video.seeking || video.readyState < 3) return
    if (!hasPlaybackBuffer(video) && performance.now() - waitStartedAt < maxBufferWaitMs) return

    waiting = false
    void video.play().catch(() => {
      // Autoplay policy or an interrupted play request must not create a retry loop.
    })
  }

  const waitForBuffer = () => {
    if (disposed || video.ended || video.error) return
    if (!waiting) waitStartedAt = performance.now()
    waiting = true
    onBuffering(true)
    video.pause()
    checkBuffer()
  }

  const onPlaying = () => {
    if (!disposed) onBuffering(false)
  }
  const onEnded = () => {
    waiting = false
    onBuffering(false)
  }

  video.addEventListener('waiting', waitForBuffer)
  video.addEventListener('seeking', waitForBuffer)
  video.addEventListener('playing', onPlaying)
  video.addEventListener('ended', onEnded)
  const progressEvents = ['loadedmetadata', 'progress', 'canplay', 'seeked']
  for (const event of progressEvents) video.addEventListener(event, checkBuffer)
  const timer = window.setInterval(checkBuffer, 250)
  waitForBuffer()

  return () => {
    disposed = true
    window.clearInterval(timer)
    video.removeEventListener('waiting', waitForBuffer)
    video.removeEventListener('seeking', waitForBuffer)
    video.removeEventListener('playing', onPlaying)
    video.removeEventListener('ended', onEnded)
    for (const event of progressEvents) video.removeEventListener(event, checkBuffer)
  }
}
