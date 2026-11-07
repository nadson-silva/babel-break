import type { CefrLevel } from '../shared/types'

export const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1']

export function levelIndex(level: CefrLevel): number {
  const index = CEFR_LEVELS.indexOf(level)
  return index === -1 ? 0 : index
}

export function levelFromScore(score: number): CefrLevel {
  if (score < 0.25) return 'A1'
  if (score < 0.45) return 'A2'
  if (score < 0.65) return 'B1'
  if (score < 0.85) return 'B2'
  return 'C1'
}

export function nextLevel(level: CefrLevel): CefrLevel {
  const index = levelIndex(level)
  return CEFR_LEVELS[Math.min(index + 1, CEFR_LEVELS.length - 1)]
}

export function clampLevel(level: string | null | undefined): CefrLevel {
  return CEFR_LEVELS.includes(level as CefrLevel) ? (level as CefrLevel) : 'A2'
}
