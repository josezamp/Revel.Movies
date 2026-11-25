import test from 'node:test'
import assert from 'node:assert/strict'
import { localDateTime, pendingSchedule, scheduleDate, scheduleTime } from '../src/admin/scheduleView.ts'

test('schedule date and time use the selected zone across midnight, regardless of browser zone', () => {
  const date = new Date('2026-11-01T02:59:00Z')
  assert.equal(localDateTime(date, 'America/Argentina/Buenos_Aires'), '2026-10-31T23:59')
  assert.equal(scheduleTime(date.toISOString(), 'America/Argentina/Buenos_Aires'), '23:59')
  assert.match(scheduleDate(date.toISOString(), 'America/Argentina/Buenos_Aires'), /31/)
  assert.equal(localDateTime(new Date('2026-11-01T03:15:00Z'), 'America/Argentina/Buenos_Aires'), '2026-11-01T00:15')
})
test('only unfinished entries remain in the agenda', () => {
  assert.equal(pendingSchedule('activating'), true)
  for (const status of ['completed', 'partial', 'failed', 'missed', 'cancelled']) assert.equal(pendingSchedule(status), false)
})

test('agenda rows show how long is left and group by day in the event time zone', async () => {
  const { relativeStart, scheduleDay } = await import('../src/admin/scheduleView.ts')
  const now = Date.parse('2026-11-25T14:00:00Z')
  assert.equal(relativeStart('2026-11-25T14:00:30Z', now), 'en menos de 1 min')
  assert.equal(relativeStart('2026-11-25T14:12:00Z', now), 'en 12 min')
  assert.equal(relativeStart('2026-11-25T16:05:00Z', now), 'en 2 h 5 min')
  assert.equal(relativeStart('2026-11-28T15:00:00Z', now), 'en 3 días')
  assert.equal(relativeStart('2026-11-25T13:00:00Z', now), '')
  const zone = 'America/Argentina/Buenos_Aires'
  assert.match(scheduleDay('2026-11-25T23:30:00Z', zone, now), /^Hoy · /)
  // 03:30 UTC is still 00:30 of the next local day in Buenos Aires.
  assert.match(scheduleDay('2026-11-26T03:30:00Z', zone, now), /^Mañana · /)
  assert.doesNotMatch(scheduleDay('2026-11-28T15:00:00Z', zone, now), /Hoy|Mañana/)
})
