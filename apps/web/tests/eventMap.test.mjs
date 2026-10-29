import assert from 'node:assert/strict'
import test from 'node:test'
import { createMapNodeId, fitMapNode } from '../src/admin/eventMapGeometry.ts'

test('dragging and resizing keep the entire element inside the canvas', () => {
  const node = { id: 'shape', x: 120, y: 150, width: 200, height: 100 }
  assert.deepEqual(fitMapNode(node, { x: 1300, y: -30 }), { ...node, x: 1000, y: 0 })
  assert.deepEqual(fitMapNode(node, { width: 2000, height: 900 }), { ...node, x: 0, y: 0, width: 1200, height: 800 })
  assert.equal(fitMapNode(node, { width: -1 }).width, 8)
  const fraction = fitMapNode(node, { x: 1200, y: 800, width: 500.5, height: 100.1 })
  assert.ok(fraction.x + fraction.width <= 1200 && fraction.y + fraction.height <= 800)
  assert.equal(node.x, 120)
})

test('map identifiers are UUIDs even without the secure-context randomUUID API', () => {
  const first = createMapNodeId()
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(first, createMapNodeId())
})
