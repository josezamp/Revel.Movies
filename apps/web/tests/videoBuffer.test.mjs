import test from 'node:test'
import assert from 'node:assert/strict'
import { bufferVideoPlayback, bufferedSecondsAhead, canCorrectPlayback, hasPlaybackBuffer, maxBufferWaitMs } from '../src/player/videoBuffer.ts'

class Video extends EventTarget {
  currentTime = 0
  duration = 120
  readyState = 3
  paused = true
  seeking = false
  ended = false
  error = null
  ranges = [[0, 2]]
  playCount = 0

  get buffered() {
    return { length: this.ranges.length, start: index => this.ranges[index][0], end: index => this.ranges[index][1] }
  }

  pause() { this.paused = true }
  play() {
    this.playCount++
    this.paused = false
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  }

  emit(name) { this.dispatchEvent(new Event(name)) }
}

function control(t, video = new Video()) {
  const previousWindow = globalThis.window
  const timers = new Map()
  const states = []
  let now = 0
  let nextTimer = 0
  t.mock.method(performance, 'now', () => now)
  globalThis.window = {
    setInterval(callback) { timers.set(++nextTimer, callback); return nextTimer },
    clearInterval(id) { timers.delete(id) },
  }
  const stop = bufferVideoPlayback(video, value => states.push(value))
  t.after(() => { stop(); globalThis.window = previousWindow })
  return {
    video, states, stop,
    tick(elapsed) {
      now += elapsed
      for (const callback of timers.values()) callback()
    },
  }
}

test('startup waits for fifteen contiguous seconds instead of the first playable frames', t => {
  const { video, states } = control(t)
  assert.equal(video.playCount, 0)
  assert.equal(states.at(-1), true)
  video.emit('canplay')
  assert.equal(video.playCount, 0)
  video.ranges = [[0, 15]]
  video.emit('progress')
  assert.equal(video.playCount, 1)
  assert.equal(states.at(-1), false)
})

test('short clips and the final seconds can play once the remainder is buffered', t => {
  const video = new Video()
  video.duration = 4
  video.ranges = [[0, 4]]
  control(t, video)
  assert.equal(video.playCount, 1)
  video.currentTime = 3.5
  assert.equal(hasPlaybackBuffer(video), true)
  video.currentTime = 4
  assert.equal(hasPlaybackBuffer(video), false)
})

test('a stall pauses playback until the reserve is rebuilt', t => {
  const video = new Video()
  video.ranges = [[0, 15]]
  const { states } = control(t, video)
  video.currentTime = 15
  video.readyState = 2
  video.emit('waiting')
  assert.equal(video.paused, true)
  assert.equal(states.at(-1), true)
  video.ranges = [[0, 17]]
  video.readyState = 3
  video.emit('canplay')
  assert.equal(video.playCount, 1)
  video.ranges = [[0, 30]]
  video.emit('progress')
  assert.equal(video.playCount, 2)
  assert.equal(states.at(-1), false)
})

test('limited preload falls back after the deadline, but only with playable data', t => {
  const { video, tick } = control(t)
  video.readyState = 2
  tick(maxBufferWaitMs)
  assert.equal(video.playCount, 0)
  video.readyState = 3
  video.emit('canplay')
  assert.equal(video.playCount, 1)
})

test('repeated waiting events do not postpone the fallback indefinitely', t => {
  const { video, tick } = control(t)
  tick(maxBufferWaitMs / 2)
  video.emit('waiting')
  tick(maxBufferWaitMs / 2)
  assert.equal(video.playCount, 1)
})

test('seeking waits for data at the destination, ignoring buffers on either side', t => {
  const video = new Video()
  video.ranges = [[0, 15], [30, 60]]
  control(t, video)
  video.currentTime = 20
  video.seeking = true
  video.emit('seeking')
  video.seeking = false
  video.emit('seeked')
  assert.equal(video.playCount, 1)
  assert.equal(bufferedSecondsAhead(video), 0)
  video.ranges = [[0, 15], [20, 60]]
  video.emit('progress')
  assert.equal(video.playCount, 2)
})

test('pause, stop or source change disposes listeners and pending buffer timers', t => {
  const { video, stop, tick } = control(t)
  stop()
  video.pause()
  video.ranges = [[0, 60]]
  video.emit('progress')
  video.emit('canplay')
  video.emit('waiting')
  tick(maxBufferWaitMs * 2)
  assert.equal(video.playCount, 0)
})

test('synchronization only seeks into a buffered destination with a reserve', () => {
  const video = new Video()
  video.paused = false
  video.ranges = [[0, 20], [50, 70]]
  assert.equal(canCorrectPlayback(video, 5), true)
  assert.equal(canCorrectPlayback(video, 6), false)
  assert.equal(canCorrectPlayback(video, 30), false)
  assert.equal(canCorrectPlayback(video, 50), true)
  for (const invalid of [-1, NaN, Infinity]) assert.equal(canCorrectPlayback(video, invalid), false)
  video.seeking = true
  assert.equal(canCorrectPlayback(video, 5), false)
  video.seeking = false
  video.paused = true
  assert.equal(canCorrectPlayback(video, 5), false)
})
