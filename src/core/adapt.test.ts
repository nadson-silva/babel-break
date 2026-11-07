import { describe, expect, it } from 'vitest'
import { errorFocus, focusDigest, focusTags, reestimateLevel } from './adapt'
import type { NotebookRow } from './adapt'

function row(overrides: Partial<NotebookRow>): NotebookRow {
  return {
    tag: 'past-simple',
    category: 'conversation',
    original: "I didn't went there.",
    corrected: "I didn't go there.",
    note: 'Depois de did, forma base.',
    occurrences: 1,
    lastSeen: 100,
    resolvedAt: null,
    ...overrides
  }
}

describe('errorFocus (a lição #2 enxerga a #1)', () => {
  it('prioriza o erro mais recorrente do caderno do aluno', () => {
    const focus = errorFocus([
      row({ tag: 'articles', occurrences: 2, lastSeen: 5 }),
      row({ tag: 'past-simple', occurrences: 5, lastSeen: 1 }),
      row({ tag: 'articles', occurrences: 3, lastSeen: 9 })
    ])

    // agrupado por tag, com a maior ocorrência de cada tag; o resto é âncora do banco
    const tags = focus.map((entry) => entry.tag)
    expect(tags.slice(0, 2)).toEqual(['past-simple', 'articles'])
    expect(focus[1].occurrences).toBe(3)
    expect(focus.slice(2).every((entry) => entry.source === 'bank')).toBe(true)
  })

  it('ancora no banco PT-BR quando o caderno ainda está vazio', () => {
    const focus = errorFocus([], 3)
    expect(focus).toHaveLength(3)
    for (const entry of focus) {
      expect(entry.source).toBe('bank')
      expect(entry.original.length).toBeGreaterThan(3)
    }
  })

  it('ignora erros já resolvidos', () => {
    const focus = errorFocus([row({ tag: 'articles', resolvedAt: 123 }), row({ tag: 'past-simple', occurrences: 4 })])
    expect(focusTags(focus, 1)[0]).toBe('past-simple')
  })

  it('resume em texto legível só com o que o aluno errou', () => {
    const focus = errorFocus([row({ occurrences: 3 }), row({ tag: 'articles', occurrences: 2 })])
    const digest = focusDigest([
      ...focus,
      { tag: 'bank-only', occurrences: 9, original: 'x', corrected: 'y', note: null, source: 'bank' }
    ])
    expect(digest).toBe('past-simple (3x) · articles (2x)')
  })
})

describe('reestimateLevel', () => {
  it('não mexe no nível sem confiança acumulada', () => {
    expect(reestimateLevel([{ skill: 'writing', estimate: 4.5, confidence: 0.2 }], 'A2')).toBeNull()
  })

  it('o teste de nivelamento sozinho (confiança 0.5) não reestima o nível', () => {
    const placement = [
      { skill: 'reading' as const, estimate: 1.0, confidence: 0.5 },
      { skill: 'grammar' as const, estimate: 1.0, confidence: 0.5 },
      { skill: 'vocab' as const, estimate: 1.0, confidence: 0.5 }
    ]
    expect(reestimateLevel(placement, 'A2')).toBeNull()
  })

  it('sobe no máximo um degrau por vez', () => {
    const skills = [
      { skill: 'writing' as const, estimate: 4.6, confidence: 0.8 },
      { skill: 'grammar' as const, estimate: 4.8, confidence: 0.8 }
    ]
    const result = reestimateLevel(skills, 'A2')
    expect(result?.cefr).toBe('B1')
  })

  it('desce um degrau quando as estimativas caem', () => {
    const skills = [{ skill: 'writing' as const, estimate: 1.2, confidence: 0.9 }]
    expect(reestimateLevel(skills, 'B1')?.cefr).toBe('A2')
  })
})
