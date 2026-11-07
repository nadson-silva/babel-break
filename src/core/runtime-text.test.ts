/**
 * Lapidação do M4 no M5: o texto que o **main** gera (cards, intervalo do FSRS,
 * fechamento, motivo da sugestão, mensagens de erro) tem de sair no idioma das
 * explicações do aluno — e um idioma sem dicionário cai em inglês, nunca em
 * frase inventada.
 */
import { describe, expect, it } from 'vitest'
import {
  RUNTIME_TEXT_KEYS,
  RUNTIME_TEXT_LANGUAGES,
  localizeDecimal,
  runtimeTemplates,
  runtimeText
} from './runtime-text'
import { dueLabel, phraseCard, previewIntervals, vocabCard } from './srs'
import { promptLocale } from './prompts'

describe('paridade dos dicionários de runtime', () => {
  it('todo idioma cobre todas as chaves', () => {
    for (const language of RUNTIME_TEXT_LANGUAGES) {
      const templates = runtimeTemplates(language)
      for (const key of RUNTIME_TEXT_KEYS) {
        expect(templates[key], `${language}.${key}`).toBeTruthy()
      }
    }
  })

  it('idioma desconhecido cai em inglês', () => {
    expect(runtimeTemplates('klingon')).toBe(runtimeTemplates('en'))
    expect(runtimeText('zu', 'due.now')).toBe('now')
  })

  it('variantes regionais herdam do idioma base', () => {
    expect(runtimeText('pt', 'due.now')).toBe('agora')
    expect(runtimeText('pt-PT', 'due.now')).toBe('agora')
    expect(runtimeText('en-GB', 'due.now')).toBe('now')
  })

  it('interpola variáveis e mantém placeholder desconhecido visível', () => {
    expect(runtimeText('pt-BR', 'due.relative', { value: '4 d' })).toBe('em 4 d')
    expect(runtimeText('en', 'recap.cards', { count: 3 })).toBe('3 new card(s) in your review queue.')
    expect(runtimeText('en', 'grade.correct')).toBe('Correct!')
    expect(runtimeText('en', 'due.relative')).toBe('in {value}')
  })
})

describe('cards e agendamento no idioma do aluno', () => {
  it('card de vocabulário usa o idioma-alvo nos textos', () => {
    const spanish = promptLocale('es', 'en')
    const card = vocabCard({ term: 'latencia', translation: 'latency', example: 'La latencia es baja.' }, null, spanish)

    expect(card.hint).toBe('Complete the sentence with the word that means “latency”.')
    expect(card.front).toContain('___')
  })

  it('card de frase em japonês explica em português', () => {
    const japanese = promptLocale('ja', 'pt-BR')
    const card = phraseCard('これはサーバーです。', 'Este é o servidor.', null, japanese)

    expect(card.front).toBe('Traduza para o japonês: Este é o servidor.')
    expect(card.hint).toContain('japonês')
  })

  it('rótulo de vencimento segue o idioma', () => {
    const now = Date.UTC(2026, 10, 7, 12)
    const inFourDays = now + 4 * 24 * 60 * 60 * 1000

    expect(dueLabel(now - 1000, now, 'pt-BR')).toBe('agora')
    expect(dueLabel(inFourDays, now, 'pt-BR')).toBe('em 4 d')
    expect(dueLabel(inFourDays, now, 'en')).toBe('in 4 d')
    expect(dueLabel(inFourDays, now, 'fr')).toBe('dans 4 j')
  })

  it('prévia dos botões de revisão segue o idioma (e não a sintonia do FSRS)', () => {
    const now = new Date(Date.UTC(2026, 10, 7))
    const english = previewIntervals(null, now, 'en').map((entry) => entry.label)
    const french = previewIntervals(null, now, 'fr').map((entry) => entry.label)

    // mesmos números, unidades na língua do aluno
    expect(english).toEqual(['1 min', '6 min', '10 min', expect.stringMatching(/^\d+ d$/) as unknown as string])
    expect(french.slice(0, 3)).toEqual(english.slice(0, 3))
    expect(french[3]).toMatch(/\d+ j$/)
  })

  it('decimal regional só troca em pt/es', () => {
    expect(localizeDecimal('4.5', 'pt-BR')).toBe('4,5')
    expect(localizeDecimal('4.5', 'es')).toBe('4,5')
    expect(localizeDecimal('4.5', 'en')).toBe('4.5')
  })
})
