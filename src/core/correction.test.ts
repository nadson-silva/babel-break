import { describe, expect, it } from 'vitest'
import { bankCorrections, buildCorrectionReport, correctionPolicyPrompt, mergeCorrections } from './correction'

describe('correção de texto livre', () => {
  it('usa o banco PT-BR sem precisar de IA', () => {
    const corrections = bankCorrections('I have 25 years and I am boring today.')
    expect(corrections.length).toBeGreaterThanOrEqual(2)
    expect(corrections.every((correction) => correction.source === 'bank')).toBe(true)
    expect(corrections.map((correction) => correction.tag)).toEqual(
      expect.arrayContaining(['have-vs-be', 'participle-adjective'])
    )
  })

  it('mantém o banco quando o modelo aponta o mesmo trecho', () => {
    const bank = bankCorrections('I am developer.')
    const merged = mergeCorrections(bank, [
      { original: 'I am developer', corrected: 'I am the developer', tag: 'Articles', source: 'ai' }
    ])

    const articles = merged.filter((correction) => correction.tag === 'articles')
    expect(articles).toHaveLength(1)
    expect(articles[0].source).toBe('bank')
    expect(articles[0].corrected).toBe('I am a developer')
  })

  it('aceita achados novos do modelo e normaliza as tags', () => {
    const merged = mergeCorrections([], [
      { original: 'She no come', corrected: 'She does not come', tag: '  Negation  ', source: 'ai' }
    ])
    expect(merged[0].tag).toBe('negation')
    expect(merged[0].source).toBe('ai')
  })

  it('descarta correção que não muda nada', () => {
    const merged = mergeCorrections([], [
      { original: 'perfect', corrected: 'perfect', tag: 'spelling', source: 'ai' }
    ])
    expect(merged).toHaveLength(0)
  })

  it('relatório diz quando a frase está limpa', () => {
    const report = buildCorrectionReport('I work with a great team.')
    expect(report.clean).toBe(true)
    expect(report.recast).toBe('I work with a great team.')

    const dirty = buildCorrectionReport('I have 25 years.')
    expect(dirty.clean).toBe(false)
    expect(dirty.recast).toContain('I am 25 years old')
  })

  it('política de correção muda o texto do prompt', () => {
    expect(correctionPolicyPrompt('recast')).toMatch(/RECAST SUAVE/)
    expect(correctionPolicyPrompt('explicit')).toMatch(/EXPLICAÇÃO EXPLÍCITA/)
    expect(correctionPolicyPrompt('both')).toMatch(/AMBOS/)
  })
})
