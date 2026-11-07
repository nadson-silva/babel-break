import { describe, expect, it } from 'vitest'
import {
  applyRating,
  cardDedupeKey,
  freshSchedule,
  dueLabel,
  errorCard,
  fullSchedule,
  parseSchedule,
  previewIntervals,
  vocabCard,
  phraseCard
} from './srs'
import { promptLocale } from './prompts'

describe('templates de card', () => {
  it('gera cloze a partir da frase de exemplo do vocabulário', () => {
    const card = vocabCard({ term: 'deploy', translation: 'implantar', example: 'We deploy on Fridays.' }, 7)
    expect(card.kind).toBe('vocab')
    expect(card.front).toContain('___')
    expect(card.back).toContain('deploy')
    expect(card.back).toContain('implantar')
    expect(card.lessonId).toBe(7)
  })

  it('cai para frente/traseiro quando o termo não está na frase', () => {
    const card = vocabCard({ term: 'ship', translation: 'enviar', example: 'Release today.' })
    expect(card.front).toBe('ship — enviar')
  })

  it('cria card de erro com a correção e a tag', () => {
    const card = errorCard({
      original: 'I have 25 years.',
      corrected: 'I am 25 years old.',
      tag: 'have-vs-be',
      note: 'Idade usa to be.'
    })
    expect(card.kind).toBe('error')
    expect(card.front).toContain('I have 25 years.')
    expect(card.back).toContain('I am 25 years old.')
    expect(card.tag).toBe('have-vs-be')
  })

  it('deduplica por conteúdo, não por linha inserida', () => {
    const a = vocabCard({ term: 'study', translation: 'estudar', example: 'I study English.' }, 1)
    const b = vocabCard({ term: 'Study', translation: 'estudar', example: 'I study English.' }, 2)
    expect(cardDedupeKey(a)).toBe(cardDedupeKey(b))
  })
})

/** M4: templates de card que respeitam o idioma-alvo (nomes e escrita CJK). */
describe('cards por idioma (M4)', () => {
  const ja = promptLocale('ja', 'pt-BR')
  const es = promptLocale('es', 'pt-BR')

  it('faz cloze em CJK sem fronteiras de palavra', () => {
    const card = vocabCard(
      { term: '勉強', translation: 'estudo', example: '毎日制語の勉強をします。' },
      3,
      ja
    )
    expect(card.front).toContain('___')
    expect(card.back).toContain('勉強')
    expect(card.lessonId).toBe(3)
  })

  it('mantém a fronteira \b em escrita separada por espaço', () => {
    // "edit" não deve ser clozeado dentro de "credit"
    const card = vocabCard({ term: 'edit', translation: 'editar', example: 'I fixed the credit system.' }, 4)
    expect(card.front).not.toContain('___')
  })

  it('nomeia o idioma-alvo nos textos dos cards', () => {
    const phrase = phraseCard('Tengo una reunión.', 'Tenho uma reunião.', 5, es)
    expect(phrase.front).toBe('Traduza para o espanhol: Tenho uma reunião.')
    expect(phrase.hint).toContain('espanhol')

    const error = errorCard(
      { original: '私は学生', corrected: '私は学生です', tag: 'polite-form', note: 'Use です.' },
      ja
    )
    expect(error.front).toContain('私は学生')
    expect(error.hint).toContain('japonês')

    const vocab = vocabCard({ term: 'ship', translation: 'enviar', example: 'Release today.' }, null, ja)
    expect(vocab.hint).toContain('Diga o termo em japonês')
  })
})

describe('agendamento FSRS', () => {
  it('novo card vira learning ao responder "bom" e ganha due futuro', () => {
    const now = new Date('2026-11-07T10:00:00Z')
    const start = fullSchedule(freshSchedule(now))
    expect(start.state).toBe('new')

    const outcome = applyRating(start.schedule, 'good', now)
    expect(outcome.reps).toBe(1)
    expect(['learning', 'review']).toContain(outcome.state)
    expect(outcome.due).toBeGreaterThan(now.getTime())
    expect(outcome.stability).toBeGreaterThan(0)
  })

  it('errado ("again") aumenta lapses quando o card já estava em revisão', () => {
    const now = new Date('2026-11-07T10:00:00Z')
    let schedule = fullSchedule(freshSchedule(now))

    for (const rating of ['good', 'good', 'good'] as const) {
      schedule = applyRating(schedule.schedule, rating, new Date(schedule.due + 60_000))
    }

    const failed = applyRating(schedule.schedule, 'again', new Date(schedule.due + 60_000))
    if (schedule.state === 'review') {
      expect(failed.lapses).toBe(schedule.lapses + 1)
    }
    expect(failed.difficulty).toBeGreaterThan(schedule.difficulty)
  })

  it('prévia dos quatro botões vem ordenada e legível', () => {
    const now = new Date('2026-11-07T10:00:00Z')
    const schedule = fullSchedule(freshSchedule(now))
    const preview = previewIntervals(schedule.schedule, now)

    expect(preview.map((item) => item.rating)).toEqual(['again', 'hard', 'good', 'easy'])
    for (const item of preview) expect(item.label).toMatch(/\d/)
    expect(preview[3].minutes).toBeGreaterThanOrEqual(preview[0].minutes)
  })

  it('sobrevive a um schedule antigo/corrompido sem perder o card', () => {
    const now = new Date('2026-11-07T10:00:00Z')
    expect(parseSchedule('não é json', now).state).toBeDefined()
    expect(parseSchedule(null, now).reps).toBe(0)

    const card = freshSchedule(now)
    const round = parseSchedule(serializeRoundTrip(card), now)
    expect(round.due.getTime()).toBe(card.due.getTime())
  })

  it('descreve vencimento em linguagem humana', () => {
    const now = Date.now()
    expect(dueLabel(now - 1000, now)).toBe('agora')
    expect(dueLabel(now + 10 * 60_000, now)).toBe('em 10 min')
    expect(dueLabel(now + 3 * 60 * 60_000, now)).toBe('em 3 h')
    expect(dueLabel(now + 5 * 24 * 60 * 60_000, now)).toBe('em 5 d')
  })
})

function serializeRoundTrip(card: { due: Date }): string {
  return JSON.stringify({ ...card, due: card.due.toISOString(), last_review: null })
}
