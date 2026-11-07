import { describe, expect, it } from 'vitest'
import { gradeDeterministic, normalizeText, shuffleTokens } from './grading'

/**
 * Correção determinística em qualquer escrita (M4): antes, tudo que não era
 * [a-z0-9] virava espaço — o que apagava chinês, coreano e árabe e fazia o
 * gabarito bater com qualquer resposta.
 */
describe('normalização unicode', () => {
  it('preserva letras de qualquer escrita', () => {
    expect(normalizeText('私は学生です')).toBe('私は学生です')
    expect(normalizeText('مرحبا بالعالم!')).toBe('مرحبا بالعالم')
    expect(normalizeText('안녕하세요.')).toBe('안녕하세요')
  })

  it('tolera acentos latinos e variantes de decomposição', () => {
    expect(normalizeText('CAFÉ')).toBe(normalizeText('cafe'))
    expect(normalizeText('reunión')).toBe(normalizeText('reunion'))
    // Hangul composto vs. decomposto (NFD em jamo) precisa bater
    expect(normalizeText('학')).toBe(normalizeText('학'.normalize('NFD')))
  })

  it('remove marcas combinantes, bidi e zero-width', () => {
    expect(normalizeText('مُرَحْبا')).toBe(normalizeText('مرحبا'))
    expect(normalizeText('\u202babc\u202c')).toBe('abc')
    expect(normalizeText('a\u200bb')).toBe('ab')
  })
})

describe('correção objetiva multilíngue', () => {
  it('casa gabarito de cloze em japonês', () => {
    const feedback = gradeDeterministic('cloze', { answer: '日本語' }, '日本語')
    expect(feedback?.correct).toBe(true)
    expect(gradeDeterministic('cloze', { answer: '日本語' }, '中国語')?.correct).toBe(false)
  })

  it('casa ordem de frase CJK montada sem espaços', () => {
    const answer = '私は毎日日本語を勉強します'
    const tokens = ['私', 'は', '毎日', '日本語', 'を', '勉強', 'します']
    const assembled = tokens.join('')
    expect(gradeDeterministic('order', { answer }, assembled)?.correct).toBe(true)
    expect(gradeDeterministic('order', { answer }, assembled + ' ')?.correct).toBe(true)
  })

  it('casa tradução árabe aceitando a normalização', () => {
    const feedback = gradeDeterministic('translate', { answer: 'أعشق البرمجة' }, 'أعشق البرمجة.')
    expect(feedback?.correct).toBe(true)
  })

  it('mantém o comportamento histórico em inglês', () => {
    expect(gradeDeterministic('multiple_choice', { answer: "I'm a developer." }, "i'm a developer.")?.correct).toBe(
      true
    )
    expect(gradeDeterministic('order', { answer: 'I study every day' }, 'i study  every  day')?.correct).toBe(true)
  })

  it('embaralha tokens deterministicamente por seed', () => {
    const tokens = ['私', 'は', '毎日', '日本語']
    const a = shuffleTokens(tokens, 42)
    const b = shuffleTokens(tokens, 42)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(tokens.length)
  })
})
