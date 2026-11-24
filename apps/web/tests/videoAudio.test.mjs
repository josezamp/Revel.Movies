import test from 'node:test'
import assert from 'node:assert/strict'
import { playVideoWithAudioFallback } from '../src/player/videoBuffer.ts'

test('audio autoplay refusal retries once muted and reports the need for local interaction', async () => {
  const attempts = []
  let blocked = 0
  const video = { muted: false, play() {
    attempts.push(this.muted)
    return this.muted ? Promise.resolve() : Promise.reject(new DOMException('Gesture required', 'NotAllowedError'))
  } }
  await playVideoWithAudioFallback(video, { isCancelled: () => false, onAudioBlocked: () => blocked++ })
  assert.deepEqual(attempts, [false, true])
  assert.equal(blocked, 1)
})

test('an operator pause or replaced source cancels the silent autoplay retry', async () => {
  let rejectPlay
  let cancelled = false
  let attempts = 0
  let blocked = 0
  const video = { muted: false, play() { attempts++; return new Promise((_, reject) => { rejectPlay = reject }) } }
  const playback = playVideoWithAudioFallback(video, { isCancelled: () => cancelled, onAudioBlocked: () => blocked++ })
  cancelled = true
  rejectPlay(new DOMException('Gesture required', 'NotAllowedError'))
  await playback
  assert.equal(attempts, 1)
  assert.equal(blocked, 0)
})

test('muting remotely while an audible play is pending still starts the silent picture', async () => {
  let rejectPlay
  let attempts = 0
  const video = { muted: false, play() {
    attempts++
    return attempts === 1 ? new Promise((_, reject) => { rejectPlay = reject }) : Promise.resolve()
  } }
  const playback = playVideoWithAudioFallback(video, { isCancelled: () => false, onAudioBlocked: () => {} })
  video.muted = true
  rejectPlay(new DOMException('Gesture required', 'NotAllowedError'))
  await playback
  assert.equal(attempts, 2)
  assert.equal(video.muted, true)
})

for (const name of ['AbortError', 'NotSupportedError']) {
  test(`${name} is not masked as an audio permission problem`, async () => {
    let attempts = 0
    const video = { muted: false, play() { attempts++; return Promise.reject(new DOMException('Unavailable', name)) } }
    await assert.rejects(playVideoWithAudioFallback(video, {
      isCancelled: () => false, onAudioBlocked: () => assert.fail('Not a policy error'),
    }), { name })
    assert.equal(attempts, 1)
    assert.equal(video.muted, false)
  })
}

test('a browser that also refuses muted playback cannot create a retry loop', async () => {
  let attempts = 0
  const video = { muted: false, play() { attempts++; throw new DOMException('No autoplay', 'NotAllowedError') } }
  await assert.rejects(playVideoWithAudioFallback(video, {
    isCancelled: () => false, onAudioBlocked: () => {},
  }), { name: 'NotAllowedError' })
  assert.equal(attempts, 2)
})

test('an audible legacy player can return void without being muted', async () => {
  const video = { muted: false, play() {} }
  await playVideoWithAudioFallback(video, { isCancelled: () => false, onAudioBlocked: () => assert.fail() })
  assert.equal(video.muted, false)
})
