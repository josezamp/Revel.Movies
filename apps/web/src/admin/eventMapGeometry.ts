import type { MapNode } from '../api/eventMap'

export const MAP_WIDTH = 1200
export const MAP_HEIGHT = 800

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
  const width = Math.min(MAP_WIDTH, Math.max(8, Math.round(next.width)))
  const height = Math.min(MAP_HEIGHT, Math.max(8, Math.round(next.height)))
  return { ...next, width, height,
    x: Math.round(Math.min(MAP_WIDTH - width, Math.max(0, next.x))),
    y: Math.round(Math.min(MAP_HEIGHT - height, Math.max(0, next.y))) }
}
