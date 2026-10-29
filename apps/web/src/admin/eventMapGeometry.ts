import type { MapNode } from '../api/eventMap'

export const MAP_WIDTH = 1200
export const MAP_HEIGHT = 800
export const MAP_MIN_SIZE = 8
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

// getRandomValues also works on the HTTP LAN deployments supported by the panel.
export function createMapNodeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function fitMapNode(node: MapNode, changes: Partial<MapNode>): MapNode {
  const next = { ...node, ...changes }
  const width = Math.min(MAP_WIDTH, Math.max(MAP_MIN_SIZE, Math.round(next.width)))
  const height = Math.min(MAP_HEIGHT, Math.max(MAP_MIN_SIZE, Math.round(next.height)))
  return { ...next, width, height,
    x: Math.round(Math.min(MAP_WIDTH - width, Math.max(0, next.x))),
    y: Math.round(Math.min(MAP_HEIGHT - height, Math.max(0, next.y))) }
}

// Move only the requested edges. The opposite edge stays anchored, including at
// the canvas boundary and when the pointer crosses the minimum element size.
export function resizeMapNode(node: MapNode, handle: ResizeHandle, dx: number, dy: number): MapNode {
  let left = node.x, top = node.y, right = node.x + node.width, bottom = node.y + node.height
  if (handle.includes('w')) left = Math.max(0, Math.min(right - MAP_MIN_SIZE, Math.round(node.x + dx)))
  if (handle.includes('e')) right = Math.min(MAP_WIDTH, Math.max(left + MAP_MIN_SIZE, Math.round(right + dx)))
  if (handle.includes('n')) top = Math.max(0, Math.min(bottom - MAP_MIN_SIZE, Math.round(node.y + dy)))
  if (handle.includes('s')) bottom = Math.min(MAP_HEIGHT, Math.max(top + MAP_MIN_SIZE, Math.round(bottom + dy)))
  return { ...node, x: left, y: top, width: right - left, height: bottom - top }
}
