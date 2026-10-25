import test from 'node:test'
import assert from 'node:assert/strict'
import { PlayerOperationGuard, isSceneExpired, summarizePreparation, resolveSceneReturn } from '../src/player/preparationStatus.ts'

test('partial preparation cannot promise readiness and network fallback cannot promise offline availability', () => {
  const cached = { mediaId: 'background', availability: 'cached' }
  const unavailable = { mediaId: 'missing', availability: 'unavailable' }
  assert.equal(summarizePreparation([cached, unavailable]).status, 'partial')
  assert.equal(summarizePreparation([unavailable]).status, 'error')
  assert.equal(summarizePreparation([cached]).status, 'ready')
  assert.equal(summarizePreparation([{ mediaId: 'large-video', availability: 'network' }]).status, 'network')
  assert.equal(summarizePreparation([cached], true).status, 'network')
  assert.equal(summarizePreparation([], true).status, 'network')
  assert.equal(summarizePreparation([]).status, 'ready')
})

test('a delayed preparation or a pre-reconnect preparation cannot confirm the current attempt', () => {
  const player = new PlayerOperationGuard()
  const first = player.beginPreparation()
  const second = player.beginPreparation()
  assert.equal(player.isCurrentPreparation(first), false)
  assert.equal(player.isCurrentPreparation(second), true)
  player.invalidatePreparation()
  assert.equal(player.isCurrentPreparation(second), false)
})

test('a newer operator decision prevents both scheduled activation and automatic return', () => {
  const player = new PlayerOperationGuard()
  const scene = player.nextDecision(41)
  player.activateSession('temporary-scene')
  assert.equal(player.isActiveSession('temporary-scene'), true)
  player.nextDecision(42)
  assert.equal(player.isCurrentDecision(scene), false)
  assert.equal(player.isActiveSession('temporary-scene'), false)
  assert.equal(player.nextDecision(40), null)
})

test('an elapsed or malformed temporal scene never activates after reconnect', () => {
  const now = Date.parse('2026-10-25T12:00:00Z')
  assert.equal(isSceneExpired('2026-10-25T11:59:59Z', now), true)
  assert.equal(isSceneExpired('2026-10-25T12:00:00Z', now), true)
  assert.equal(isSceneExpired('2026-10-25T12:00:01Z', now), false)
  assert.equal(isSceneExpired('invalid', now), true)
  assert.equal(isSceneExpired(undefined, now), false)
})

test('nested return skips an expired previous scene and restores every affected layer', () => {
  const now = Date.parse('2026-10-25T12:00:00Z')
  const keep = { media: 'keep', announcement: 'keep', webPage: 'keep', blackout: 'keep', promotions: 'keep' }
  const base = { sceneExpiresAt: null, name: 'Base' }
  const expiredOverlay = { name: 'Expired', sceneExpiresAt: '2026-10-25T11:59:59Z', scenePrevious: base,
    sceneComposition: { ...keep, announcement: 'replace' } }
  const current = { scenePrevious: expiredOverlay, sceneComposition: { ...keep, media: 'replace' } }
  const result = resolveSceneReturn(current, now)
  assert.equal(result.recovery.name, 'Base')
  assert.equal(result.composition.media, 'replace')
  assert.equal(result.composition.announcement, 'replace')
  assert.equal(result.composition.webPage, 'keep')
  expiredOverlay.sceneExpiresAt = '2026-10-25T12:00:01Z'
  assert.equal(resolveSceneReturn(current, now).recovery.name, 'Expired')
})
