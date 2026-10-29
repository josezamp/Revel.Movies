import assert from 'node:assert/strict'
import test from 'node:test'
import { createMapNodeId, fitMapNode, resizeMapNode } from '../src/admin/eventMapGeometry.ts'

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

test('resizing each edge or corner anchors the opposite edges', () => {
  const node = { id: 'shape', x: 100, y: 120, width: 200, height: 100 }
  const expected = {
    n: [100, 140, 200, 80], ne: [100, 140, 230, 80], e: [100, 120, 230, 100], se: [100, 120, 230, 120],
    s: [100, 120, 200, 120], sw: [130, 120, 170, 120], w: [130, 120, 170, 100], nw: [130, 140, 170, 80],
  }
  for (const [handle, geometry] of Object.entries(expected)) {
    const result = resizeMapNode(node, handle, 30, 20)
    assert.deepEqual([result.x, result.y, result.width, result.height], geometry, handle)
  }
  assert.deepEqual(node, { id: 'shape', x: 100, y: 120, width: 200, height: 100 })
})

test('resizing cannot cross the opposite edge or move the anchored edge at canvas limits', () => {
  const node = { id: 'wall', x: 100, y: 120, width: 320, height: 12 }
  assert.deepEqual(resizeMapNode(node, 'nw', -2000, -2000), { ...node, x: 0, y: 0, width: 420, height: 132 })
  assert.deepEqual(resizeMapNode(node, 'se', 2000, 2000), { ...node, width: 1100, height: 680 })
  assert.deepEqual(resizeMapNode(node, 'nw', 2000, 2000), { ...node, x: 412, y: 124, width: 8, height: 8 })
  assert.deepEqual(resizeMapNode(node, 'se', -2000, -2000), { ...node, width: 8, height: 8 })
  // Vertical walls can change thickness without changing their length or position.
  const vertical = { ...node, width: 12, height: 320 }
  assert.deepEqual(resizeMapNode(vertical, 'e', 20, 70), { ...vertical, width: 32 })
})
