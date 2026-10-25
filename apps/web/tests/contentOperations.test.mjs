import test from 'node:test'
import assert from 'node:assert/strict'
import { deliveryState, playbackCommandId } from '../src/admin/contentOperations.ts'

const sent = { displayId: 'tv', name: 'Patio', sentAt: 1000, commandId: 'new-command' }
const screen = { id: 'tv', actualPlaybackState: 'Playing', actualCommandId: 'old-command', lastCommandId: 'new-command', lastPlaybackReportAt: new Date(2000).toISOString() }

test('an older playback report cannot confirm a newly sent playlist', () => {
  assert.equal(deliveryState(sent, screen, 2000), 'Enviado · esperando confirmación')
  assert.equal(deliveryState(sent, { ...screen, actualCommandId: 'new-command' }, 2000), 'Aplicación confirmada')
})

test('the prior command still visible before refresh is not mistaken for a later decision', () => {
  const delivery = { ...sent, previousCommandId: 'old-command' }
  assert.equal(deliveryState(delivery, { ...screen, lastCommandId: 'old-command' }, 2000), 'Enviado · esperando confirmación')
  assert.equal(deliveryState(delivery, { ...screen, lastCommandId: 'later-command' }, 2000), 'Hay una acción posterior en esta pantalla')
  assert.equal(deliveryState(delivery, { ...screen, actualCommandId: 'new-command' }, 2000), 'Aplicación confirmada')
})

test('API acceptance without a command correlation never becomes playback confirmation', () => {
  const accepted = { ...sent, commandId: undefined }
  assert.equal(deliveryState(accepted, { ...screen, actualCommandId: 'new-command' }, 2000), 'Enviado · esperando confirmación')
  assert.equal(deliveryState(accepted, screen, 32000), 'Sin confirmación reciente · revisar En vivo')
})

test('a matching command with an expired or missing report is not a fresh confirmation', () => {
  assert.equal(deliveryState(sent, { ...screen, actualCommandId: 'new-command' }, 20000), 'Confirmación desactualizada · revisar En vivo')
  assert.equal(deliveryState(sent, { ...screen, actualCommandId: 'new-command', lastPlaybackReportAt: null }, 2000), 'Confirmación desactualizada · revisar En vivo')
  assert.equal(deliveryState({ ...sent, sentAt: 10000 }, { ...screen, actualCommandId: 'new-command' }, 11000), 'Confirmación desactualizada · revisar En vivo')
})

test('removed targets, per-screen failures and later actions stay explicit', () => {
  assert.equal(deliveryState(sent, undefined, 2000), 'Destino no disponible')
  assert.equal(deliveryState({ ...sent, error: 'Sin conexión' }, screen, 2000), 'Sin conexión')
  assert.equal(deliveryState(sent, { ...screen, lastCommandId: 'later' }, 2000), 'Hay una acción posterior en esta pantalla')
})

test('configuration acknowledgement does not falsely imply that media is playing', () => {
  assert.equal(deliveryState({ ...sent, expected: 'configuration' }, { ...screen, actualPlaybackState: 'Stopped', actualCommandId: 'new-command' }, 2000), 'Configuración confirmada')
  assert.equal(deliveryState(sent, { ...screen, actualPlaybackState: 'Loading', actualCommandId: 'new-command' }, 2000), 'Comando confirmado; cargando contenido')
})

test('playback and promotion API wrappers retain the command correlation', () => {
  assert.equal(playbackCommandId({ playCommand: { commandId: 'play' }, prepareCommand: { commandId: 'prepare' } }), 'play')
  assert.equal(playbackCommandId({ command: { commandId: 'promotions' }, targets: ['tv'] }), 'promotions')
  assert.equal(playbackCommandId({ commandId: 'direct' }), 'direct')
  assert.equal(playbackCommandId({}), undefined)
})
