import test from 'node:test'
import assert from 'node:assert/strict'
import { importLocalDate, MAX_SCHEDULE_IMPORT_BYTES, parseScheduleImport, scheduleImportJson } from '../src/admin/scheduleImport.ts'

test('accepts a JSON object pasted directly or copied from a ChatGPT JSON code block', () => {
  const value = { schemaVersion: 1, scenes: [{ key: 'previa', name: '¡Bienvenidos!' }], schedule: [] }
  const json = JSON.stringify(value, null, 2)
  assert.deepEqual(parseScheduleImport(json), value)
  assert.deepEqual(parseScheduleImport(`\n\`\`\`json\n${json}\n\`\`\`\n`), value)
})

test('rejects incomplete JSON, non-object values and explanations outside the document', () => {
  for (const source of ['', ' ', '{', 'null', '[]', 'true', '"cronograma"', 'Acá está tu JSON: {"scenes":[]}'])
    assert.throws(() => parseScheduleImport(source), Error, source)
})

test('enforces the upload budget in UTF-8 bytes, including Spanish and emoji text', () => {
  const ascii = JSON.stringify({ text: 'a'.repeat(MAX_SCHEDULE_IMPORT_BYTES) })
  assert.throws(() => parseScheduleImport(ascii), /1 MB/)
  const multiByte = JSON.stringify({ text: '🎉'.repeat(Math.floor(MAX_SCHEDULE_IMPORT_BYTES / 4)) })
  assert.ok(multiByte.length < MAX_SCHEDULE_IMPORT_BYTES)
  assert.throws(() => parseScheduleImport(multiByte), /1 MB/)
})

test('shows the supplied local date without converting it to the browser timezone at midnight', () => {
  assert.equal(importLocalDate('2035-10-31T21:00'), '31/10/2035')
  assert.equal(importLocalDate('2035-11-01T00:00'), '01/11/2035')
})

test('preserves duplicate properties for server validation instead of silently choosing one value', () => {
  const duplicate = '{"schemaVersion": 1, "schemaVersion": 2, "scenes": []}'
  assert.equal(scheduleImportJson(duplicate), duplicate)
  assert.equal(scheduleImportJson('```json\n' + duplicate + '\n```'), duplicate)
})
