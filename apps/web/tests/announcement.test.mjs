import test from 'node:test'
import assert from 'node:assert/strict'
import { countdownSeconds, formatCountdown, parseAnnouncement } from '../src/announcements/announcement.ts'

test('countdown follows the absolute deadline after reconnect or clock correction', () => {
  const endsAt = '2026-10-08T12:05:00Z'
  assert.equal(countdownSeconds(endsAt, Date.parse('2026-10-08T12:00:00Z')), 300)
  assert.equal(countdownSeconds(endsAt, Date.parse('2026-10-08T12:04:30Z')), 30)
  assert.equal(countdownSeconds(endsAt, Date.parse('2026-10-08T12:04:59.900Z')), 1)
  assert.equal(countdownSeconds(endsAt, Date.parse(endsAt)), 0)
  assert.equal(countdownSeconds(endsAt, Date.parse('2026-10-09T12:00:00Z')), 0)
})

test('clock handles hours, long durations and zero without wrapping', () => {
  for (const [seconds, expected] of [[300, '05:00'], [3600, '01:00:00'], [3661, '01:01:01'], [604800, '168:00:00'], [-10, '00:00']]) {
    assert.equal(formatCountdown(seconds), expected)
  }
})

test('player rejects malformed announcements and keeps completed countdowns for recovery', () => {
  const announcement = { kind: 'countdown', text: 'Inicio', layout: 'banner', theme: 'dark', endsAt: '2026-10-08T12:00:00Z', completedText: 'Listo' }
  assert.deepEqual(parseAnnouncement(announcement), announcement)
  for (const invalid of [null, {}, { ...announcement, endsAt: 'invalid' }, { ...announcement, kind: 'html' }, { ...announcement, text: ' ' }, { ...announcement, completedText: null }, { ...announcement, layout: 'anything' }]) {
    assert.equal(parseAnnouncement(invalid), null)
  }
})
