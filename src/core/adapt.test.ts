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

describe('reestimateLevel (v2/D10)', () => {
  it('não mexe no nível sem confiança acumulada', () => {
    expect(
      reestimateLevel({ skills: [{ skill: 'writing', estimate: 4.5, confidence: 0.2 }], current: 'A2' })
    ).toBeNull()
  })

  it('o teste de nivelamento sozinho (confiança 0.5) não reestima o nível', () => {
    const placement = [
      { skill: 'reading' as const, estimate: 1.0, confidence: 0.5 },
      { skill: 'grammar' as const, estimate: 1.0, confidence: 0.5 },
      { skill: 'vocab' as const, estimate: 1.0, confidence: 0.5 }
    ]
    expect(reestimateLevel({ skills: placement, current: 'A2' })).toBeNull()
  })

  it('uma habilidade só, por mais confiável que seja, não redefine o aluno', () => {
    const one = [{ skill: 'writing' as const, estimate: 4.9, confidence: 0.95 }]
    expect(reestimateLevel({ skills: one, current: 'B1' })).toBeNull()
  })

  it('sobe no máximo um degrau por vez', () => {
    const skills = [
      { skill: 'writing' as const, estimate: 4.6, confidence: 0.8 },
      { skill: 'grammar' as const, estimate: 4.8, confidence: 0.8 }
    ]
    const result = reestimateLevel({ skills, current: 'A2' })
    expect(result?.cefr).toBe('B1')
    expect(result?.reason).toBe('up')
  })

  it('desce um degrau quando as estimativas caem', () => {
    const skills = [
      { skill: 'writing' as const, estimate: 1.2, confidence: 0.9 },
      { skill: 'grammar' as const, estimate: 1.4, confidence: 0.9 }
    ]
    const result = reestimateLevel({ skills, current: 'B1' })
    expect(result?.cefr).toBe('A2')
    expect(result?.reason).toBe('down')
  })

  it('banda morta: média perto da fronteira não alterna o nível', () => {
    // 2,4 de média cai em B1 (>= 2,5? não: 2,4 < 2,5 → A2). O caso que importa é
    // o que passa a fronteira por pouco — aqui 2,55 (B1, mas a 0,05 da fronteira).
    const borderline = [
      { skill: 'writing' as const, estimate: 2.55, confidence: 0.9 },
      { skill: 'grammar' as const, estimate: 2.55, confidence: 0.9 }
    ]
    const result = reestimateLevel({ skills: borderline, current: 'A2' })
    expect(result?.cefr).toBe('A2')
    expect(result?.reason).toBe('dead-band')
  })

  it('fora da banda morta, a mesma média move o nível', () => {
    const past = [
      { skill: 'writing' as const, estimate: 2.95, confidence: 0.9 },
      { skill: 'grammar' as const, estimate: 2.95, confidence: 0.9 }
    ]
    expect(reestimateLevel({ skills: past, current: 'A2' })?.cefr).toBe('B1')
  })

  it('peso por confiança: a habilidade com mais evidência manda mais', () => {
    const skills = [
      { skill: 'grammar' as const, estimate: 4.2, confidence: 0.95 },
      { skill: 'vocab' as const, estimate: 1.0, confidence: 0.56 }
    ]
    const result = reestimateLevel({ skills, current: 'A2' })
    // Ponderada ≈ 3,01 (passa a fronteira com folga). A média simples seria 2,6:
    // dentro da banda morta, e o aluno não subiria por causa de uma habilidade
    // que ele mal demonstrou.
    expect(result?.cefr).toBe('B1')
    expect(result?.average).toBeGreaterThan(2.75)
    expect(result?.average).toBeLessThan(3.5)
  })

  it('no teto (C1) não sobe — o plano não tem C2', () => {
    const skills = [
      { skill: 'grammar' as const, estimate: 5, confidence: 0.95 },
      { skill: 'writing' as const, estimate: 5, confidence: 0.95 }
    ]
    const result = reestimateLevel({ skills, current: 'C1' })
    expect(result?.cefr).toBe('C1')
    expect(result?.reason).toBe('ceiling')
  })
})
