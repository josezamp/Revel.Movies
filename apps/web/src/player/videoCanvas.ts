export function needsVideoCanvas(userAgent: string): boolean {
  return /\bTizen\b/i.test(userAgent) && /SMART[- ]?TV|SmartTV/i.test(userAgent)
}

// Tizen can present decoded video on a hardware plane that ignores CSS rotation.
// Keep the video as the playback clock, but composite its frames into the page.
export function startVideoCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  onReady: () => void,
  onError: (error: unknown) => void,
): () => void {
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    onError(new Error('Canvas video rendering is unavailable.'))
    return () => {}
  }

  let stopped = false
  let ready = false
  let animationFrame: number | undefined
  let videoFrame: number | undefined
  let lastDraw = -Infinity
  const hasVideoFrames = typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function'

  function cancelFrame() {
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
    if (videoFrame !== undefined) video.cancelVideoFrameCallback(videoFrame)
    animationFrame = undefined
    videoFrame = undefined
  }

  function draw() {
    if (stopped || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
    try {
      // Bound the copy cost on TVs, including when the source is 4K.
      const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight))
      const width = Math.max(1, Math.round(video.videoWidth * scale))
      const height = Math.max(1, Math.round(video.videoHeight * scale))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context!.drawImage(video, 0, 0, width, height)
      if (!ready) {
        ready = true
        onReady()
      }
    } catch (error) {
      stopped = true
      cancelFrame()
      onError(error)
    }
  }

  function schedule() {
    if (stopped || video.paused || video.ended || animationFrame !== undefined || videoFrame !== undefined) return
    if (hasVideoFrames) {
      videoFrame = video.requestVideoFrameCallback(tick)
    } else {
      animationFrame = window.requestAnimationFrame(tick)
    }
  }

  function tick(now: number) {
    animationFrame = undefined
    videoFrame = undefined
    // Older Tizen browsers use the animation-frame fallback. Never copy above 30 fps.
    if (now - lastDraw >= 1000 / 30) {
      draw()
      lastDraw = now
    }
    schedule()
  }

  function refresh() {
    // Allow a paint before copying: readyState can advance before the decoder's
    // first image is available to drawImage on a hardware-backed video element.
    // Use animation frames here so an already-paused video is also redrawn when
    // switching from native rendering (no new video frame callback is guaranteed).
    if (stopped) return
    cancelFrame()
    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = undefined
        draw()
        schedule()
      })
    })
  }

  function finish() {
    cancelFrame()
    draw()
  }

  const refreshEvents = ['loadeddata', 'canplay', 'seeked', 'play', 'resize']
  const finishEvents = ['pause', 'ended']
  refreshEvents.forEach(event => video.addEventListener(event, refresh))
  finishEvents.forEach(event => video.addEventListener(event, finish))
  refresh()

  return () => {
    stopped = true
    cancelFrame()
    refreshEvents.forEach(event => video.removeEventListener(event, refresh))
    finishEvents.forEach(event => video.removeEventListener(event, finish))
  }
}
