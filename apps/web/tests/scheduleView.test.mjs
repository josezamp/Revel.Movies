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
