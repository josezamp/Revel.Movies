import assert from 'node:assert/strict'
import test from 'node:test'
import { playbackConfirmed, reportAge, timeLabel } from '../src/admin/liveState.ts'
import { sceneDestinations } from '../src/admin/sceneView.ts'

test('only a recent correlated playback report confirms a request', () => {
  const now = Date.now()
  const report = { lastCommandId: 'new', actualCommandId: 'old', lastPlaybackReportAt: new Date(now).toISOString() }
  assert.equal(playbackConfirmed(report, now), false)
  assert.equal(playbackConfirmed({ ...report, actualCommandId: 'new' }, now), true)
  assert.equal(playbackConfirmed({ ...report, actualCommandId: 'new' }, now + 16000), false)
  assert.equal(playbackConfirmed({ ...report, lastCommandId: null, actualCommandId: null }, now), false)
  assert.equal(reportAge({ lastPlaybackReportAt: null }, now), null)
  assert.equal(timeLabel(42), '00:42')
  assert.equal(timeLabel(null), '—')
})
test('overlapping groups deduplicate identical composition and flag conflicting destinations', () => {
  const assignment = { displayIds: [], groupIds: ['one', 'two'], media: { action: 'keep' }, webPage: { action: 'keep' }, announcement: { action: 'keep' }, blackout: 'off', promotions: 'keep' }
  const displays = [{ id: 'tv', name: 'Patio' }]
  const groups = [{ id: 'one', displayIds: ['tv'] }, { id: 'two', displayIds: ['tv'] }]
  assert.equal(sceneDestinations([assignment], displays, groups).destinations.length, 1)
  const result = sceneDestinations([assignment, { ...assignment, blackout: 'on' }], displays, groups)
  assert.deepEqual(result.conflicts, ['Patio'])
  assert.deepEqual(sceneDestinations([{ ...assignment, displayIds: ['missing'] }], displays, groups).missing, ['missing'])
})
