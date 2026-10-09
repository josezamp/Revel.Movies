import test from 'node:test'
import assert from 'node:assert/strict'
import {
  configurePromotions, finishPlaylistItem, parsePromotionPolicy, parsePromotionProgress,
  preferLocalCheckpoint, readPlaylistCheckpoint, startPromotionProgress,
} from '../src/player/promotionalBreaks.ts'

const video = mediaId => ({ mediaId, mediaType: 'Video', fileSize: 10, durationSeconds: null })
const policy = { id: 'rule-1', enabled: true, playlistId: 'promos', playlistName: 'Promos', everyVideos: 5, items: [video('A'), video('B')] }
const playlist = { loop: true, items: Array.from({ length: 12 }, (_, index) => video(String(index + 1))) }

function player(main = playlist, rule = policy) {
  let progress = startPromotionProgress('session-1', rule)
  let index = 0
  return {
    get progress() { return progress },
    configure(next) { rule = next; progress = configurePromotions(progress, rule) },
    end() {
      const next = finishPlaylistItem(progress, rule, main, index)
      progress = next.progress
      index = next.playlistIndex
      return next
    },
  }
}

test('one rotating promotion after every five main videos, including across playlist loops', () => {
  const p = player()
  const result = Array.from({ length: 18 }, () => p.end().mediaId)
  assert.deepEqual(result, ['2', '3', '4', '5', 'A', '6', '7', '8', '9', '10', 'B', '11', '12', '1', '2', '3', 'A', '4'])
})

test('images do not count; promotion completion does not consume the next main video', () => {
  const p = player({ loop: true, items: [video('1'), { ...video('image'), mediaType: 'Image' }, video('2')] }, { ...policy, everyVideos: 2 })
  assert.equal(p.end().mediaId, 'image')
  assert.equal(p.progress.completedVideos, 1)
  assert.equal(p.end().mediaId, '2')
  assert.equal(p.progress.completedVideos, 1)
  assert.equal(p.end().mediaId, 'A')
  assert.equal(p.end().mediaId, '1')
  assert.equal(p.progress.completedVideos, 0)
})

test('disabling during a promotion lets it finish and returns to the correct next item', () => {
  const p = player(playlist, { ...policy, everyVideos: 1 })
  assert.equal(p.end().mediaId, 'A')
  p.configure({ ...policy, id: 'disabled', enabled: false, items: [] })
  assert.equal(p.progress.activeMediaId, 'A')
  assert.equal(p.end().mediaId, '2')
  assert.equal(p.end().mediaId, '3')
})

test('replacing a policy resets the counter but preserves the active promotion', () => {
  const p = player(playlist, { ...policy, everyVideos: 1 })
  p.end()
  p.configure({ ...policy, id: 'new', everyVideos: 2, items: [video('C')] })
  assert.equal(p.progress.activeMediaId, 'A')
  assert.equal(p.end().mediaId, '2')
  assert.equal(p.end().mediaId, '3')
  assert.equal(p.end().mediaId, 'C')
})

test('a final eligible video gets its promotion and then ends a non-looping playlist', () => {
  const p = player({ loop: false, items: [video('1')] }, { ...policy, everyVideos: 1 })
  assert.equal(p.end().ended, false)
  const final = p.end()
  assert.equal(final.ended, true)
  assert.equal(final.mediaId, '1')
  assert.equal(final.progress.activeMediaId, null)
})

test('a failed promotion uses the same return transition without retrying indefinitely', () => {
  const p = player({ loop: true, items: [video('1')] }, { ...policy, everyVideos: 1 })
  assert.equal(p.end().mediaId, 'A')
  assert.equal(p.end().mediaId, '1')
  assert.equal(p.end().mediaId, 'B')
})

test('without a policy playback advances normally; enabling starts counting at the next ending', () => {
  const p = player(playlist, null)
  assert.equal(p.end().mediaId, '2')
  assert.equal(p.progress.completedVideos, 0)
  p.configure({ ...policy, everyVideos: 1 })
  assert.equal(p.end().mediaId, 'A')
})

test('new playback sessions restart the count and rotation; reapplying the same policy does not', () => {
  const p = player()
  p.end()
  const progress = p.progress
  assert.deepEqual(configurePromotions(progress, policy), progress)
  assert.equal(startPromotionProgress('new-session', policy).completedVideos, 0)
  assert.equal(startPromotionProgress('new-session', policy).nextPromotionIndex, 0)
})

test('recovery chooses newer local progress only for the same playback session and valid index', () => {
  const p = player(playlist, { ...policy, everyVideos: 1 })
  p.end()
  const local = { progress: p.progress, playlistIndex: 0, positionSeconds: 2, capturedAt: 100, ended: false }
  assert.equal(preferLocalCheckpoint(local, 'session-1', null, 101, 12), true)
  assert.equal(preferLocalCheckpoint(local, 'session-2', null, 101, 12), false)
  assert.equal(preferLocalCheckpoint(local, 'session-1', { ...p.progress, sequence: 9 }, 101, 12), false)
  assert.equal(preferLocalCheckpoint({ ...local, playlistIndex: 12 }, 'session-1', null, 101, 12), false)
  const restored = configurePromotions(local.progress, { ...policy, id: 'disabled', enabled: false, items: [] })
  assert.equal(restored.activeMediaId, 'A')
})

test('corrupt storage and malformed policies/checkpoints are safely ignored', () => {
  assert.equal(readPlaylistCheckpoint({ getItem: () => '{broken' }), null)
  assert.equal(readPlaylistCheckpoint({ getItem: () => { throw new Error('disabled') } }), null)
  assert.equal(parsePromotionPolicy({ ...policy, everyVideos: 0 }), null)
  assert.equal(parsePromotionPolicy({ ...policy, everyVideos: 1.5 }), null)
  assert.equal(parsePromotionPolicy({ ...policy, items: [] }), null)
  assert.equal(parsePromotionProgress({ ...startPromotionProgress('s', policy), sequence: -1 }), null)
  assert.equal(parsePromotionProgress({ ...startPromotionProgress('s', policy), activeMediaId: {} }), null)
})
