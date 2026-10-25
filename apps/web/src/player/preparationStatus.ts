export type PreparationStatus = 'ready' | 'network' | 'partial' | 'error'

export type AssetPreparation = {
  mediaId: string
  availability: 'cached' | 'network' | 'unavailable'
  reason?: string
}

/** Cache availability and network reachability are different guarantees. */
export function summarizePreparation(assets: AssetPreparation[], networkRequired = false): {
  status: PreparationStatus; prepared: number; network: number; failed: number; detail: string
} {
  const prepared = assets.filter(asset => asset.availability === 'cached').length
  const network = assets.filter(asset => asset.availability === 'network').length
  const failed = assets.filter(asset => asset.availability === 'unavailable').length
  const status = failed > 0 ? (prepared + network > 0 ? 'partial' : 'error')
    : network > 0 || networkRequired ? 'network' : 'ready'
  return {
    status, prepared, network, failed,
    detail: `${prepared}/${assets.length} en caché; ${network} por red; ${failed} no disponibles${networkRequired ? '; la página externa requiere red y no permite verificar su contenido' : ''}`,
  }
}

/** Each operation captures its generation before starting asynchronous work. */
export class PlayerOperationGuard {
  private decision = 0
  private preparation = 0
  private revision = 0
  private sessionId: string | null = null

  nextDecision(revision?: number): number | null {
    if (revision !== undefined && revision < this.revision) return null
    if (revision !== undefined) this.revision = revision
    this.sessionId = null
    return ++this.decision
  }

  isCurrentDecision(generation: number) { return this.decision === generation }
  beginPreparation() { return ++this.preparation }
  isCurrentPreparation(generation: number) { return this.preparation === generation }
  invalidatePreparation() { ++this.preparation }
  activateSession(sessionId: string) { this.sessionId = sessionId }
  clearActiveSession() { this.sessionId = null }
  isActiveSession(sessionId: string) { return this.sessionId === sessionId }
}

export function isSceneExpired(expiresAt: unknown, serverNow: number): boolean {
  if (expiresAt === undefined || expiresAt === null) return false
  return typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= serverNow
}

export type SceneComposition = {
  media: 'keep' | 'replace' | 'remove'
  webPage: 'keep' | 'replace' | 'remove'
  announcement: 'keep' | 'replace' | 'remove'
  blackout: 'keep' | 'on' | 'off'
  promotions: 'keep' | 'suspend'
}

type SceneRecoveryLink<T> = {
  sceneExpiresAt?: string | null
  scenePrevious?: T | null
  sceneComposition?: SceneComposition | null
}

/** A nested temporary scene must not reveal another scene whose deadline passed. */
export function resolveSceneReturn<T extends SceneRecoveryLink<T>>(active: T, serverNow: number): {
  recovery: T; composition: SceneComposition
} | null {
  let recovery = active.scenePrevious
  let composition = active.sceneComposition
  if (!recovery || !composition) return null
  for (let depth = 0; depth < 30; depth++) {
    if (!isSceneExpired(recovery.sceneExpiresAt, serverNow)) return { recovery, composition }
    const previousComposition = recovery.sceneComposition
    if (!recovery.scenePrevious || !previousComposition) return null
    composition = {
      media: composition.media === 'keep' && previousComposition.media === 'keep' ? 'keep' : 'replace',
      webPage: composition.webPage === 'keep' && previousComposition.webPage === 'keep' ? 'keep' : 'replace',
      announcement: composition.announcement === 'keep' && previousComposition.announcement === 'keep' ? 'keep' : 'replace',
      blackout: composition.blackout === 'keep' && previousComposition.blackout === 'keep' ? 'keep' : 'off',
      promotions: composition.promotions === 'keep' && previousComposition.promotions === 'keep' ? 'keep' : 'suspend',
    }
    recovery = recovery.scenePrevious
  }
  return null
}
