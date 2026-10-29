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
  pauseCount = 0

  get buffered() {
    return { length: this.ranges.length, start: index => this.ranges[index][0], end: index => this.ranges[index][1] }
  }

  pause() { this.pauseCount++; this.paused = true }
  play() {
    this.playCount++
    this.paused = false
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  }

  emit(name) { this.dispatchEvent(new Event(name)) }
}

function control(t, video = new Video(), options) {
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
  const stop = bufferVideoPlayback(video, value => states.push(value), options)
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

for (const readyState of [0, 2, 3]) {
  test(`playlist transitions request native playback immediately with readyState ${readyState}`, t => {
    const video = new Video()
    video.readyState = readyState
    video.ranges = readyState === 0 ? [] : [[0, 2]]
    const { tick, states } = control(t, video, { startImmediately: true })
    assert.equal(video.playCount, 1)
    assert.equal(video.pauseCount, 0)
    video.seeking = true
    video.emit('seeking')
    video.emit('waiting')
    assert.equal(video.paused, false)
    assert.equal(states.at(-1), true)
    tick(maxBufferWaitMs * 2)
    assert.equal(video.playCount, 1)
    video.emit('playing')
    assert.equal(states.at(-1), false)
  })
}

test('canceling a native playlist start pauses it and prevents late events from restarting it', t => {
  const video = new Video()
  video.play = () => { video.playCount++; video.paused = false; return new Promise(() => {}) }
  const { stop, tick, states } = control(t, video, { startImmediately: true })
  assert.equal(video.playCount, 1)
  stop()
  const reports = states.length
  for (const event of ['loadedmetadata', 'canplay', 'waiting', 'playing']) video.emit(event)
  tick(maxBufferWaitMs * 2)
  assert.equal(video.paused, true)
  assert.equal(video.playCount, 1)
  assert.equal(states.length, reports)
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

for (const readyState of [0, 1, 2]) {
  test(`limited preload delegates to native playback at the deadline with readyState ${readyState}`, t => {
    const video = new Video()
    video.readyState = readyState
    video.ranges = []
    const { tick } = control(t, video)
    tick(maxBufferWaitMs - 1)
    assert.equal(video.playCount, 0)
    tick(1)
    assert.equal(video.playCount, 1)
    assert.equal(video.paused, false)
    tick(maxBufferWaitMs)
    assert.equal(video.playCount, 1)
  })
}

test('a pending seek cannot prevent the native fallback at the deadline', t => {
  const video = new Video()
  video.seeking = true
  video.ranges = [[0, 30]]
  const { tick } = control(t, video)
  tick(maxBufferWaitMs - 1)
  assert.equal(video.playCount, 0)
  tick(1)
  assert.equal(video.playCount, 1)
})

test('native fallback keeps playback running through further waiting and seeking events', t => {
  const { video, tick, states } = control(t)
  tick(maxBufferWaitMs)
  assert.equal(video.playCount, 1)
  const pauses = video.pauseCount
  video.readyState = 2
  for (const event of ['waiting', 'waiting', 'seeking']) {
    video.emit(event)
    assert.equal(video.pauseCount, pauses)
    assert.equal(video.paused, false)
    assert.equal(states.at(-1), true)
  }
  tick(maxBufferWaitMs * 2)
  assert.equal(video.playCount, 1)
  video.emit('playing')
  assert.equal(states.at(-1), false)
})

test('native fallback supports a legacy play method that returns no promise', t => {
  const video = new Video()
  video.play = () => { video.playCount++; video.paused = false }
  const { tick } = control(t, video)
  assert.doesNotThrow(() => tick(maxBufferWaitMs))
  assert.equal(video.playCount, 1)
  assert.equal(video.paused, false)
})

test('a synchronous play failure does not escape the timer or create a retry loop', t => {
  const video = new Video()
  video.play = () => { video.playCount++; throw new Error('Playback unavailable') }
  const { tick } = control(t, video)
  assert.doesNotThrow(() => tick(maxBufferWaitMs))
  video.emit('waiting')
  tick(maxBufferWaitMs * 2)
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

test('disposing native fallback prevents later events from changing playback or telemetry', t => {
  const { video, stop, tick, states } = control(t)
  tick(maxBufferWaitMs)
  stop()
  video.pause()
  const pauses = video.pauseCount
  const reports = states.length
  video.emit('waiting')
  video.emit('seeking')
  video.emit('canplay')
  video.emit('playing')
  tick(maxBufferWaitMs * 2)
  assert.equal(video.playCount, 1)
  assert.equal(video.pauseCount, pauses)
  assert.equal(video.paused, true)
  assert.equal(states.length, reports)
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

function recoveryControl(t, video = new Video(), options = {}) {
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
    ...options,
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

test('native playlist startup retains the watchdog and uses the normal buffer gate after reload', t => {
  const video = new Video()
  video.readyState = 2
  const { tick, reloads, stop } = recoveryControl(t, video, { startImmediately: true })
  assert.equal(video.playCount, 1)
  tick(videoStallTimeoutMs)
  assert.equal(video.playCount, 2)
  tick(videoStallTimeoutMs)
  assert.deepEqual(reloads, [0])
  // Reload has no usable data; immediate startup is only for the transition.
  assert.equal(video.playCount, 2)
  stop()
  tick(maxBufferWaitMs * 2)
  assert.equal(video.playCount, 2)
  assert.equal(video.paused, true)
})

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
