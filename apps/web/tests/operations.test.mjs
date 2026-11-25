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

test('a scene block is summarised in plain language for its card', async () => {
  const { assignmentSummary, returnLabel } = await import('../src/admin/sceneView.ts')
  const base = { displayIds: ['a'], groupIds: [], media: { action: 'keep' }, webPage: { action: 'keep' }, announcement: { action: 'keep' }, blackout: 'keep', promotions: 'keep' }
  const media = [{ id: 'm1', name: 'menu-cena' }]
  const playlists = [{ id: 'p1', name: 'Recepción' }]
  assert.equal(assignmentSummary(base, media, playlists), 'Sin cambios')
  assert.equal(assignmentSummary({ ...base, media: { action: 'replace', type: 'media', mediaId: 'm1' } }, media, playlists), 'menu-cena')
  assert.equal(assignmentSummary({ ...base, media: { action: 'replace', type: 'playlist', playlistId: 'p1' }, announcement: { action: 'replace', payload: { kind: 'countdown', text: 'Ya empieza', layout: 'banner', theme: 'dark' } } }, media, playlists), 'Playlist Recepción + Cuenta regresiva: Ya empieza')
  assert.equal(assignmentSummary({ ...base, webPage: { action: 'replace', payload: { url: 'https://example.com/votar' } }, promotions: 'suspend' }, media, playlists), 'Página example.com + Sin cortes promocionales')
  assert.equal(assignmentSummary({ ...base, media: { action: 'replace', type: 'media', mediaId: 'gone' } }, media, playlists), 'Archivo no disponible')
  assert.equal(returnLabel(300), '5 min')
  assert.equal(returnLabel(45), '45 s')
})
