// Native video buffers are browser-managed. Wait for a useful reserve before
// playback, with a time limit for devices that cap preloading while paused.
export const playbackBufferSeconds = 15
export const maxBufferWaitMs = 15_000
export const videoStallTimeoutMs = 30_000
const maxVideoReloads = 2

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

type VideoRecoveryOptions = {
  // During load(), currentTime is temporarily zero. Keep the pending seek as the checkpoint.
  getPosition: () => number
  reload: (positionSeconds: number) => void
  onFailure: (error: unknown) => void
}

export function recoverVideoPlayback(
  video: HTMLVideoElement,
  onBuffering: (buffering: boolean) => void,
  options: VideoRecoveryOptions,
): () => void {
  let stopped = false
  let stopBuffering: (() => void) | undefined
  let timer: number | undefined
  let lastPosition = video.currentTime
  let lastProgressAt = performance.now()
  let lastCheckAt = lastProgressAt
  let healthyPlaybackMs = 0
  let attempts = 0
  let generation = 0

  function stop() {
    if (stopped) return
    stopped = true
    generation++
    if (timer !== undefined) window.clearInterval(timer)
    stopBuffering?.()
    video.removeEventListener('playing', onPlaying)
    video.removeEventListener('waiting', onWaiting)
    video.removeEventListener('seeked', onSeeked)
    video.removeEventListener('ended', stop)
    // Also abort a pending native play() when an operator pauses or replaces this video.
    video.pause()
  }

  function fail(error: unknown) {
    if (stopped) return
    stop()
    onBuffering(false)
    options.onFailure(error)
  }

  function onPlaying() { if (!stopped) onBuffering(false) }
  function onWaiting() { if (!stopped) onBuffering(true) }
  function onSeeked() {
    // Restoring a checkpoint or synchronizing is not evidence of decoded playback.
    lastPosition = video.currentTime
    healthyPlaybackMs = 0
  }

  function checkProgress() {
    if (stopped) return
    if (video.ended) { stop(); return }
    const now = performance.now()
    const elapsed = now - lastCheckAt
    lastCheckAt = now
    const advancing = !video.paused && !video.seeking && !video.error && video.readyState >= 2 &&
      Number.isFinite(video.currentTime) && video.currentTime !== lastPosition
    lastPosition = video.currentTime
    if (advancing) {
      lastProgressAt = now
      // Require sustained progress before allowing another full recovery cycle.
      healthyPlaybackMs += Math.min(elapsed, 1000)
      if (healthyPlaybackMs >= videoStallTimeoutMs) attempts = 0
      onBuffering(false)
      return
    }
    healthyPlaybackMs = 0
    if (now - lastProgressAt < videoStallTimeoutMs) return

    if (attempts > maxVideoReloads) {
      fail(new Error(`Video did not advance after resume and ${maxVideoReloads} reloads ` +
        `(position ${options.getPosition()}, readyState ${video.readyState}, media error ${video.error?.code ?? 'none'}).`))
      return
    }
    lastProgressAt = now
    const attempt = attempts++
    const currentGeneration = ++generation
    stopBuffering?.()
    stopBuffering = undefined
    onBuffering(true)

    try {
      if (attempt === 0) {
        // Bypass the reserve gate once: some TVs stop preloading while paused.
        // Leave native buffering running even if another waiting event arrives.
        void Promise.resolve(video.play()).catch(error => {
          if (stopped || currentGeneration !== generation) return
          if (error?.name === 'NotAllowedError' || error?.name === 'NotSupportedError') fail(error)
          // Other failures (or a never-settling promise) escalate on the next deadline.
        })
      } else {
        const position = options.getPosition()
        options.reload(Number.isFinite(position) ? Math.max(0, position) : 0)
        if (!stopped) stopBuffering = bufferVideoPlayback(video, onBuffering)
      }
    } catch (error) { fail(error) }
  }

  video.addEventListener('playing', onPlaying)
  video.addEventListener('waiting', onWaiting)
  video.addEventListener('seeked', onSeeked)
  video.addEventListener('ended', stop)
  timer = window.setInterval(checkProgress, 1000)
  stopBuffering = bufferVideoPlayback(video, onBuffering)
  return stop
}
