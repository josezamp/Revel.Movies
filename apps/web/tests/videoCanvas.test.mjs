import test from 'node:test'
import assert from 'node:assert/strict'
import { needsVideoCanvas, startVideoCanvas } from '../src/player/videoCanvas.ts'

test('Samsung TV browsers use compatibility rendering without affecting desktop browsers', () => {
  assert.equal(needsVideoCanvas('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 TV Safari/537.36'), true)
  assert.equal(needsVideoCanvas('Mozilla/5.0 (SmartTV; Linux; Tizen 8.0) AppleWebKit/537.36'), true)
  assert.equal(needsVideoCanvas('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36'), false)
  assert.equal(needsVideoCanvas('Mozilla/5.0 (Linux; Android 12) SamsungBrowser/20.0 Chrome/106.0.0.0'), false)
})

function fixture(t, { playing = false, decoded = true, frameCallbacks = true } = {}) {
  const callbacks = new Map()
  let sequence = 0
  const previousWindow = globalThis.window
  globalThis.window = {
    requestAnimationFrame: callback => { callbacks.set(++sequence, callback); return sequence },
    cancelAnimationFrame: id => callbacks.delete(id),
  }
  t.after(() => { globalThis.window = previousWindow })
  const video = Object.assign(new EventTarget(), {
    paused: !playing, ended: false, readyState: decoded ? 2 : 0,
    videoWidth: 3840, videoHeight: 2160, currentTime: 42,
    play: () => assert.fail('Rendering must not restart playback'),
    pause: () => assert.fail('Rendering must not pause playback'),
  })
  if (frameCallbacks) {
    video.requestVideoFrameCallback = globalThis.window.requestAnimationFrame
    video.cancelVideoFrameCallback = globalThis.window.cancelAnimationFrame
  }
  const frames = []
  const context = { drawImage: (...args) => frames.push(args) }
  const canvas = {
    width: 300, height: 150,
    getContext: () => context,
  }
  let ready = 0
  const errors = []
  const stop = startVideoCanvas(video, canvas, () => ready++, error => errors.push(error))
  t.after(stop)
  const repaint = () => {
    for (let frame = 0; frame < 2; frame++) {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach(callback => callback(100))
    }
  }
  repaint()
  return { video, canvas, context, frames, callbacks, errors, stop, repaint, ready: () => ready }
}

test('a paused video keeps its position and redraws after seeking without a running timer', t => {
  const f = fixture(t)
  assert.equal(f.video.currentTime, 42)
  assert.equal(f.video.paused, true)
  assert.equal(f.ready(), 1)
  assert.equal(f.frames.length, 1)
  assert.equal(f.canvas.width / f.canvas.height, 16 / 9)
  assert.ok(f.canvas.width <= 1920)
  assert.equal(f.callbacks.size, 0)
  f.video.currentTime = 60
  f.video.dispatchEvent(new Event('seeked'))
  f.repaint()
  assert.equal(f.video.currentTime, 60)
  assert.equal(f.frames.length, 2)
  assert.equal(f.callbacks.size, 0)
  assert.deepEqual(f.errors, [])
})

test('native video stays visible until a decoded frame is available', t => {
  const f = fixture(t, { decoded: false })
  assert.equal(f.ready(), 0)
  assert.equal(f.frames.length, 0)
  f.video.readyState = 2
  f.video.dispatchEvent(new Event('loadeddata'))
  f.repaint()
  assert.equal(f.ready(), 1)
  assert.equal(f.frames.length, 1)
})

for (const frameCallbacks of [true, false]) {
  test(`changing rendering mode cancels pending frames and listeners (${frameCallbacks ? 'video frames' : 'older TV fallback'})`, t => {
    const f = fixture(t, { playing: true, frameCallbacks })
    assert.equal(f.callbacks.size, 1)
    f.video.dispatchEvent(new Event('play'))
    assert.equal(f.callbacks.size, 1)
    const previousFrames = f.frames.length
    f.stop()
    assert.equal(f.callbacks.size, 0)
    f.video.dispatchEvent(new Event('seeked'))
    f.video.dispatchEvent(new Event('play'))
    assert.equal(f.frames.length, previousFrames)
    assert.equal(f.callbacks.size, 0)
    assert.equal(f.video.currentTime, 42)
    assert.equal(f.video.paused, false)
  })
}

test('a TV that rejects frame copies reports the failure without leaving a render loop running', t => {
  const f = fixture(t, { playing: true, decoded: false })
  f.video.readyState = 2
  // drawImage can reject a source even after the browser reports decoded data.
  f.context.drawImage = () => { throw new Error('Video frames are inaccessible') }
  f.video.dispatchEvent(new Event('loadeddata'))
  f.repaint()
  assert.equal(f.ready(), 0)
  assert.equal(f.errors.length, 1)
  assert.equal(f.callbacks.size, 0)
})
