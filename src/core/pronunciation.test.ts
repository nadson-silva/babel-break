/**
 * V2 — score de pronúncia determinístico: alinhamento, crédito parcial e as
 * armadilhas que fariam a nota mentir (frase curta, CJK,RTL, ASR mudo).
 */
import { describe, expect, it } from 'vitest'
import { scorePronunciation, weakWords } from './pronunciation'

describe('fala certa', () => {
  it('transcrição idêntica vale 1', () => {
    const score = scorePronunciation({ target: 'I work on the backend', transcript: 'I work on the backend', lang: 'en' })
    expect(score.score).toBeCloseTo(1, 5)
    expect(score.accuracy).toBeCloseTo(1, 5)
    expect(score.tags).toEqual([])
    expect(score.words.every((word) => word.status === 'ok')).toBe(true)
  })

  it('caixa/pontuação não contam como erro', () => {
    const score = scorePronunciation({ target: "Let's go!", transcript: 'lets go', lang: 'en' })
    expect(score.score).toBeCloseTo(1, 5)
  })
})

describe('fala parcial', () => {
  it('palavra trocada por som parecido ganha crédito parcial e tag', () => {
    const score = scorePronunciation({ target: 'I work on the backend', transcript: 'I work on the back end', lang: 'en' })
    expect(score.score).toBeLessThan(1)
    expect(score.score).toBeGreaterThan(0.6)
    expect(score.tags).toContain('pronunciation')
  })

  it('palavra faltando desconta e vira "missing-words"', () => {
    const score = scorePronunciation({ target: 'I have been working here for two years', transcript: 'I have been here', lang: 'en' })
    expect(score.accuracy).toBeLessThan(0.8)
    expect(score.tags).toContain('missing-words')
    expect(weakWords(score).length).toBeGreaterThan(0)
  })

  it('palavra sobrando derruba a precisão, não a accuracy', () => {
    const clean = scorePronunciation({ target: 'she sells sea shells', transcript: 'she sells sea shells', lang: 'en' })
    const noisy = scorePronunciation({ target: 'she sells sea shells', transcript: 'she sells these sea shells now', lang: 'en' })
    expect(noisy.accuracy).toBeLessThanOrEqual(clean.accuracy)
    expect(noisy.precision).toBeLessThan(clean.precision)
    expect(noisy.tags).toContain('extra-words')
  })

  it('ordem trocada não vale nota cheia', () => {
    const score = scorePronunciation({ target: 'the cat sat on the mat', transcript: 'mat the on sat cat the', lang: 'en' })
    // Alinhamento respeita ordem: palavras soltas fora de sequência não somam.
    expect(score.score).toBeLessThanOrEqual(0.6)
  })
})

describe('nada ouvido', () => {
  it('transcrição vazia é zero com tag própria', () => {
    const score = scorePronunciation({ target: 'hello world', transcript: '', lang: 'en' })
    expect(score.score).toBe(0)
    expect(score.transcriptEmpty).toBe(true)
    expect(score.tags).toContain('no-audio')
    expect(score.confidence).toBe(0)
  })

  it('null (sem ASR de resposta) cai no mesmo lugar', () => {
    const score = scorePronunciation({ target: 'hello world', transcript: null, lang: 'en' })
    expect(score.score).toBe(0)
    expect(score.transcriptEmpty).toBe(true)
  })
})

describe('frase curta é ruído, não conclusão', () => {
  it('uma palavra certa tem confiança baixa', () => {
    const oneWord = scorePronunciation({ target: 'yes', transcript: 'yes', lang: 'en' })
    const phrase = scorePronunciation({ target: 'yes we agree on that', transcript: 'yes we agree on that', lang: 'en' })
    expect(oneWord.score).toBeCloseTo(1, 5)
    expect(oneWord.confidence).toBeLessThan(phrase.confidence)
    expect(phrase.confidence).toBeCloseTo(1, 5)
  })
})

describe('qualquer escrita', () => {
  it('CJK: segmentação por unidade, sem depender de espaço', () => {
    const score = scorePronunciation({ target: '私は日本語を勉強しています', transcript: '私は日本語を勉強しています', lang: 'ja' })
    expect(score.score).toBeGreaterThan(0.9)

    const partial = scorePronunciation({ target: '私は日本語を勉強しています', transcript: '私は日本語です', lang: 'ja' })
    expect(partial.score).toBeLessThan(score.score)
  })

  it('RTL (árabe): harakat e pontuação não viram erro', () => {
    const same = scorePronunciation({ target: 'مرحبا بالعالم', transcript: 'مرحبا بالعالم', lang: 'ar' })
    expect(same.score).toBeCloseTo(1, 5)

    // Vocalização (harakat) Some no ASR: não pode virar "palavra errada".
    const withMarks = scorePronunciation({ target: 'مَرْحَبًا', transcript: 'مرحبا', lang: 'ar' })
    expect(withMarks.accuracy).toBeCloseTo(1, 5)
  })

  it('vi: diacrítico que define a palavra não é apagado na comparação', () => {
    const score = scorePronunciation({ target: 'tôi tên là', transcript: 'toi ten la', lang: 'vi' })
    // 'vi' preserva diacríticos (B7): sem acento é outra palavra.
    expect(score.score).toBeLessThan(1)
  })
})
