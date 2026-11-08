/**
 * V2 (D7) — a escala única do app: 0–1 persistido, 0–5 na estimativa.
 * Sem teste disto, voz entraria numa escala e o CEFR leria outra.
 */
import { describe, expect, it } from 'vitest'
import {
  SKILL_SCALE_MAX,
  SPEECH_PASS_SCORE,
  clampScore01,
  clampSkill,
  scoreFromSkill,
  scorePercent,
  skillSample,
  speechPassed
} from './score'

describe('clampScore01', () => {
  it('absorve o lixo que modelo devolve', () => {
    expect(clampScore01(undefined)).toBe(0)
    expect(clampScore01(null)).toBe(0)
    expect(clampScore01(Number.NaN)).toBe(0)
    expect(clampScore01(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampScore01(-3)).toBe(0)
    expect(clampScore01(12)).toBe(1)
    expect(clampScore01(0.42)).toBe(0.42)
  })
})

describe('as duas escalas conversão ida e volta', () => {
  it('score 0–1 → amostra 0–5 → score 0–1', () => {
    for (const value of [0, 0.2, 0.75, 1]) {
      expect(scoreFromSkill(skillSample(value))).toBeCloseTo(value, 10)
    }
  })

  it('estimativa fora da escala não explode o nível', () => {
    expect(clampSkill(99)).toBe(SKILL_SCALE_MAX)
    expect(clampSkill(-4)).toBe(0)
    expect(skillSample(0.8)).toBeCloseTo(4, 10)
  })
})

describe('piso de acerto', () => {
  it('pronúncia abaixo de 70% não conta como acerto', () => {
    expect(speechPassed(0.69)).toBe(false)
    expect(speechPassed(SPEECH_PASS_SCORE)).toBe(true)
    expect(speechPassed(0.95)).toBe(true)
    expect(speechPassed(null)).toBe(false)
    expect(scorePercent(0.825)).toBe(83)
  })
})
