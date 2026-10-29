import test from 'node:test'
import assert from 'node:assert/strict'
import { bufferVideoPlayback, bufferedSecondsAhead, canCorrectPlayback, hasPlaybackBuffer, maxBufferWaitMs,
  recoverVideoPlayback, videoStallTimeoutMs } from '../src/player/videoBuffer.ts'

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

function recoveryControl(t, video = new Video()) {
  const previousWindow = globalThis.window
  const timers = new Map()
  const states = []
  const reloads = []
  const failures = []
  let pendingPosition
  let now = 0
  let nextTimer = 0
  t.mock.method(performance, 'now', () => now)
  globalThis.window = {
    setInterval(callback) { timers.set(++nextTimer, callback); return nextTimer },
    clearInterval(id) { timers.delete(id) },
  }
  video.ranges = [[0, 120]]
  const stop = recoverVideoPlayback(video, value => states.push(value), {
    getPosition: () => pendingPosition ?? video.currentTime,
    reload(position) {
      reloads.push(position)
      pendingPosition = position
      video.pause()
      video.currentTime = 0
      video.readyState = 0
      video.ranges = []
      video.emit('emptied')
    },
    onFailure: error => failures.push(error),
  })
  t.after(() => { stop(); globalThis.window = previousWindow })
  return {
    video, states, reloads, failures, stop,
    tick(elapsed) {
      now += elapsed
      for (const [id, callback] of [...timers]) if (timers.has(id)) callback()
    },
    metadata() {
      video.readyState = 3
      video.ranges = [[0, 120]]
      video.currentTime = pendingPosition ?? video.currentTime
      pendingPosition = undefined
      video.emit('loadedmetadata')
      video.emit('seeked')
    },
  }
}

test('a silent freeze first resumes, then reloads at the saved position', t => {
  const { video, tick, reloads, metadata, states } = recoveryControl(t)
  video.currentTime = 42
  tick(1000)
  tick(videoStallTimeoutMs - 1)
  assert.equal(video.playCount, 1)
  tick(1)
  assert.equal(video.playCount, 2)
  assert.deepEqual(reloads, [])
  tick(videoStallTimeoutMs)
  assert.deepEqual(reloads, [42])
  assert.equal(video.currentTime, 0)
  metadata()
  assert.equal(video.currentTime, 42)
  assert.equal(video.playCount, 3)
  assert.equal(states.at(-1), false)
})

test('buffering stuck below HAVE_FUTURE_DATA can recover without waiting forever', t => {
  const { video, tick, reloads } = recoveryControl(t)
  video.currentTime = 23
  tick(1000)
  video.readyState = 2
  video.emit('waiting')
  assert.equal(video.paused, true)
  tick(videoStallTimeoutMs)
  assert.equal(video.playCount, 2)
  assert.equal(video.paused, false)
  // A further waiting event must not pause the native recovery attempt again.
  video.emit('waiting')
  assert.equal(video.paused, false)
  tick(videoStallTimeoutMs)
  assert.deepEqual(reloads, [23])
})

test('failed reloads retain the checkpoint and stop after two reloads', t => {
  const { video, tick, reloads, failures, metadata } = recoveryControl(t)
  video.currentTime = 51
  tick(1000)
  for (let attempt = 0; attempt < 4; attempt++) tick(videoStallTimeoutMs)
  assert.deepEqual(reloads, [51, 51])
  assert.equal(failures.length, 1)
  assert.equal(video.paused, true)
  const plays = video.playCount
  metadata()
  tick(videoStallTimeoutMs * 10)
  assert.equal(video.playCount, plays)
  assert.equal(failures.length, 1)
})

test('operator pause during reload cancels every pending automatic play', t => {
  const { video, tick, stop, metadata, reloads, failures } = recoveryControl(t)
  video.currentTime = 37
  tick(1000)
  tick(videoStallTimeoutMs)
  tick(videoStallTimeoutMs)
  stop()
  const plays = video.playCount
  metadata()
  video.emit('canplay')
  video.emit('waiting')
  tick(videoStallTimeoutMs * 5)
  assert.equal(video.currentTime, 37)
  assert.equal(video.paused, true)
  assert.equal(video.playCount, plays)
  assert.deepEqual(reloads, [37])
  assert.deepEqual(failures, [])
})

test('source replacement cancels a pending resume promise without reporting a stale error', async t => {
  const { video, tick, stop, reloads, failures } = recoveryControl(t)
  let rejectPlay
  video.play = () => new Promise((_, reject) => { rejectPlay = reject })
  tick(videoStallTimeoutMs)
  stop()
  rejectPlay(new DOMException('Interrupted by new source', 'AbortError'))
  await Promise.resolve()
  tick(videoStallTimeoutMs * 5)
  assert.deepEqual(reloads, [])
  assert.deepEqual(failures, [])
})

test('autoplay refusal is reported once instead of reloading in a loop', async t => {
  const { video, tick, reloads, failures } = recoveryControl(t)
  video.play = () => Promise.reject(new DOMException('User gesture required', 'NotAllowedError'))
  tick(videoStallTimeoutMs)
  await Promise.resolve()
  tick(videoStallTimeoutMs * 5)
  assert.deepEqual(reloads, [])
  assert.equal(failures.length, 1)
  assert.equal(failures[0].name, 'NotAllowedError')
})

test('playing events without position progress do not reset the retry limit', t => {
  const { video, tick, reloads, failures, metadata } = recoveryControl(t)
  for (let attempt = 0; attempt < 4; attempt++) {
    video.emit('playing')
    tick(videoStallTimeoutMs)
    if (reloads.length) metadata()
  }
  assert.equal(reloads.length, 2)
  assert.equal(failures.length, 1)
})

test('sustained playback replenishes the recovery budget for a later freeze', t => {
  const { video, tick, reloads, metadata, failures } = recoveryControl(t)
  tick(videoStallTimeoutMs)
  tick(videoStallTimeoutMs)
  metadata()
  for (let second = 0; second < 35; second++) {
    video.currentTime++
    tick(1000)
  }
  const plays = video.playCount
  tick(videoStallTimeoutMs)
  assert.equal(video.playCount, plays + 1)
  assert.equal(reloads.length, 1)
  assert.deepEqual(failures, [])
})

test('an ended video is never restarted by recovery', t => {
  const { video, tick, reloads, failures } = recoveryControl(t)
  video.ended = true
  video.emit('ended')
  const plays = video.playCount
  tick(videoStallTimeoutMs * 5)
  assert.equal(video.playCount, plays)
  assert.deepEqual(reloads, [])
  assert.deepEqual(failures, [])
})
