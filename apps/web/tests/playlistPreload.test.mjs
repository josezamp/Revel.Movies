import test from 'node:test'
import assert from 'node:assert/strict'
import { getUpcomingVideoIds, startPromotionProgress } from '../src/player/promotionalBreaks.ts'

const video = mediaId => ({ mediaId, mediaType: 'Video', fileSize: 10, durationSeconds: null })
const image = mediaId => ({ ...video(mediaId), mediaType: 'Image' })
const playlist = (items, loop = false) => ({ items, loop })
const policy = { id: 'policy', enabled: true, playlistId: 'promos', playlistName: 'Promos', everyVideos: 2,
  items: [video('promo-1'), video('promo-2')] }
const progress = (rule = null, fields = {}) => ({ ...startPromotionProgress('playback', rule), ...fields })

test('preloads two distinct next videos in order and skips intervening images', () => {
  const main = playlist([video('a'), image('poster'), video('b'), video('b'), image('other'), video('c'), video('d')])
  assert.deepEqual(getUpcomingVideoIds(main, 0, progress(), null, 'a'), ['b', 'c'])
  assert.deepEqual(getUpcomingVideoIds(main, 0, progress(), null, 'a', 1), ['b'])
})

test('a looping playlist wraps from the current index and excludes the playing resource', () => {
  const main = playlist([video('a'), video('b'), video('c')], true)
  assert.deepEqual(getUpcomingVideoIds(main, 2, progress(), null, 'c'), ['a', 'b'])
  assert.deepEqual(getUpcomingVideoIds(playlist([video('a'), video('a')], true), 0, progress(), null, 'a'), [])
})

test('a non-looping playlist stops at the end and recovery starts at the recovered index', () => {
  const main = playlist([video('a'), video('b'), video('c'), video('d')])
  assert.deepEqual(getUpcomingVideoIds(main, 2, progress(), null, 'c'), ['d'])
  assert.deepEqual(getUpcomingVideoIds(main, 3, progress(), null, 'd'), [])
})

test('pending promotions precede the next main video using recovered progress and rotation', () => {
  const main = playlist([video('a'), image('poster'), video('b'), video('c')])
  const recovered = progress(policy, { completedVideos: 1, nextPromotionIndex: 1 })
  assert.deepEqual(getUpcomingVideoIds(main, 2, recovered, policy, 'b'), ['promo-2', 'c'])
})

test('the final video can preload its promotion but never restarts an ended playlist', () => {
  const main = playlist([video('a')])
  const rule = { ...policy, everyVideos: 1 }
  assert.deepEqual(getUpcomingVideoIds(main, 0, progress(rule), rule, 'a'), ['promo-1'])
  assert.deepEqual(getUpcomingVideoIds(main, 0, progress(rule, { activeMediaId: 'promo-1' }), rule, 'promo-1'), [])
})

test('finishing a promotion returns to the next item without counting its main video twice', () => {
  const main = playlist([video('a'), video('b'), video('c')])
  const active = progress(policy, { activeMediaId: 'promo-1', nextPromotionIndex: 1 })
  assert.deepEqual(getUpcomingVideoIds(main, 0, active, policy, 'promo-1'), ['b', 'c'])
})

test('disabled and replaced policies preserve an active promotion return and apply the new rule', () => {
  const main = playlist([video('a'), video('b'), video('c')])
  const active = progress(policy, { activeMediaId: 'promo-1', nextPromotionIndex: 1 })
  const disabled = { ...policy, id: 'disabled', enabled: false, items: [] }
  assert.deepEqual(getUpcomingVideoIds(main, 0, active, disabled, 'promo-1'), ['b', 'c'])
  const replacement = { ...policy, id: 'replacement', everyVideos: 1, items: [video('new-promo')] }
  assert.deepEqual(getUpcomingVideoIds(main, 0, active, replacement, 'promo-1'), ['b', 'new-promo'])
})

test('replacing a policy resets the previous counter before predicting the next break', () => {
  const main = playlist([video('a'), video('b'), video('c')])
  const replacement = { ...policy, id: 'replacement', items: [video('new-promo')] }
  assert.deepEqual(getUpcomingVideoIds(main, 0, progress(policy, { completedVideos: 1 }), replacement, 'a'), ['b', 'new-promo'])
})

test('repeated main items scan at most one cycle even with a large rotating promotion list', () => {
  const rule = { ...policy, everyVideos: 1, items: Array.from({ length: 100 }, (_, index) => video(`promo-${index}`)) }
  assert.deepEqual(getUpcomingVideoIds(playlist([video('a')], true), 0, progress(rule), rule, 'a'), ['promo-0'])
  assert.deepEqual(getUpcomingVideoIds(playlist([image('poster')], true), 0, progress(rule), rule, 'poster'), [])
})

test('lookahead never mutates playlist, policy, or playback progress', () => {
  const main = Object.freeze(playlist(Object.freeze([Object.freeze(video('a')), Object.freeze(video('b'))]), true))
  const rule = Object.freeze({ ...policy, everyVideos: 1, items: Object.freeze(policy.items.map(item => Object.freeze({ ...item }))) })
  const current = Object.freeze(progress(rule))
  assert.deepEqual(getUpcomingVideoIds(main, 0, current, rule, 'a'), ['promo-1', 'b'])
  assert.deepEqual(current, progress(rule))
})

test('empty playlists, invalid indices, and empty limits have no upcoming videos', () => {
  const main = playlist([video('a'), video('b')], true)
  assert.deepEqual(getUpcomingVideoIds(playlist([]), 0, progress(), null, 'a'), [])
  for (const index of [-1, 2, 0.5, Number.NaN])
    assert.deepEqual(getUpcomingVideoIds(main, index, progress(), null, 'a'), [])
  for (const limit of [0, -1, 0.5, Number.NaN, Infinity])
    assert.deepEqual(getUpcomingVideoIds(main, 0, progress(), null, 'a', limit), [])
})
