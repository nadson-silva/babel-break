/**
 * Integração do M2 (sem IA e sem GUI): migrações + caderno de erros + FSRS +
 * adaptação visível entre a lição #1 e a lição #2 + sessão guiada.
 *
 * Roda com o stub de `electron` (vitest.config.mts). Sem modelo configurado,
 * toda geração cai no determinístico — que é justamente o caminho que precisa
 * continuar funcionando offline.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { bankCorrections } from '../core/correction'
import { getDb, initDatabase, schema } from './db'
import {
  answerExercise,
  completeOnboarding,
  curriculumView,
  finishLesson,
  generateCurriculum,
  lastOpenedLesson,
  openLesson
} from './learning'
import { focusFor, notebookView, recordCorrections } from './notebook'
import { answerReview, cardsForRecurringErrors, reviewState } from './review'
import {
  abandonGuidedSession,
  activeGuidedSession,
  advanceGuidedSession,
  finishGuidedSession,
  startGuidedSession
} from './guided'
import { createConversation, sendTurn } from './tutor'
import { homeState } from './home'

let profileId = 0

beforeAll(async () => {
  initDatabase()

  const state = completeOnboarding({ goal: 'entrevista para dev', cefr: 'A2' })
  profileId = state.profile.id

  await generateCurriculum()
})

describe('currículo e lição #1', () => {
  it('gera unidades e lições sem IA (fallback determinístico)', () => {
    const curriculum = curriculumView()
    expect(curriculum.generated).toBe(true)
    expect(curriculum.units.length).toBeGreaterThanOrEqual(2)
    const lessons = curriculum.units.flatMap((unit) => unit.lessons)
    expect(lessons.length).toBeGreaterThanOrEqual(6)
  })

  it('abre a lição com conteúdo, exercícios e foco', async () => {
    const first = curriculumView().units[0].lessons[0]
    const detail = await openLesson(first.id)

    expect(detail.exercises.length).toBeGreaterThanOrEqual(6)
    expect(detail.content.explanation.length).toBeGreaterThan(20)
    expect(detail.content.source).toBe('fallback')
    expect(detail.focus.length).toBeGreaterThan(0)
  })

  it('anota no caderno a resposta errada de um exercício', async () => {
    const first = curriculumView().units[0].lessons[0]
    const detail = await openLesson(first.id)
    const cloze = detail.exercises.find((exercise) => exercise.type === 'cloze') ?? detail.exercises[0]

    const feedback = await answerExercise({ exerciseId: cloze.id, response: 'zzz errado de propósito' })
    expect(feedback.correct).toBe(false)

    const view = notebookView(profileId)
    expect(view.openCount).toBeGreaterThan(0)
    expect(view.tags.some((tag) => tag.occurrences >= 1)).toBe(true)
  })

  it('concluir a lição cria cards na fila de revisão', async () => {
    const first = curriculumView().units[0].lessons[0]
    const detail = await openLesson(first.id)
    const result = finishLesson({ lessonId: first.id, sessionId: detail.sessionId })

    expect(result.total).toBe(detail.exercises.length)
    expect(result.cardsCreated).toBeGreaterThan(0)

    const review = reviewState(profileId, 20)
    expect(review.total).toBeGreaterThan(0)
    expect(review.dueCount).toBeGreaterThan(0)
  })
})

describe('o loop: a lição #2 enxerga os erros da #1', () => {
  beforeAll(() => {
    // Simula duas mensagens corrigidas no chat com o tutor (banco PT-BR).
    const corrections = bankCorrections('I have 25 years and I am developer.')
    expect(corrections.length).toBeGreaterThan(0)
    recordCorrections(profileId, corrections, { category: 'conversation', context: 'conversa' })
    recordCorrections(profileId, corrections, { category: 'conversation', context: 'conversa' })
  })

  it('registra recorrência em vez de linha duplicada', () => {
    const tags = focusFor(profileId, 6)
    const haveVsBe = tags.find((entry) => entry.tag === 'have-vs-be')
    const articles = tags.find((entry) => entry.tag === 'articles')

    expect(haveVsBe?.source).toBe('student')
    expect(haveVsBe?.occurrences).toBe(2)
    expect(articles?.occurrences).toBe(2)

    const view = notebookView(profileId)
    const haveRow = view.tags.find((tag) => tag.tag === 'have-vs-be')
    expect(haveRow?.examples).toHaveLength(1)
  })

  it('a segunda lição mira as tags do caderno', async () => {
    const lessons = curriculumView().units.flatMap((unit) => unit.lessons)
    const second = lessons[1]
    const detail = await openLesson(second.id)

    expect(detail.focus.some((entry) => entry.source === 'student')).toBe(true)

    const targeted = detail.exercises.filter((exercise) => exercise.targetTags.length > 0)
    expect(targeted.length).toBeGreaterThan(0)
    expect(targeted[0].targetTags[0]).toBe(detail.focus[0].tag)

    const pitfalls = detail.content.pitfalls ?? []
    expect(pitfalls.some((pitfall) => pitfall.wrong !== pitfall.right)).toBe(true)
  })

  it('casa o recast do banco com a explicação mostrada ao aluno', () => {
    const view = notebookView(profileId)
    const haveRow = view.tags.find((tag) => tag.tag === 'have-vs-be')
    expect(haveRow?.examples[0].corrected).toContain('I am 25 years old')
    expect(haveRow?.examples[0].note).toContain('to be')
  })
})

describe('revisão FSRS', () => {
  it('aplica a nota e empurra o card para o futuro', async () => {
    const lessons = curriculumView().units.flatMap((unit) => unit.lessons)
    const detail = await openLesson(lessons[2].id)
    finishLesson({ lessonId: lessons[2].id, sessionId: detail.sessionId })

    const before = reviewState(profileId, 20)
    expect(before.due.length).toBeGreaterThan(0)

    const card = before.due[0]
    const result = answerReview(profileId, card.id, 'good')

    expect(result.rating).toBe('good')
    expect(result.nextDueLabel).not.toBe('agora')

    const after = reviewState(profileId, 20)
    expect(after.reviewedToday).toBeGreaterThan(0)
    expect(after.due.some((entry) => entry.id === card.id)).toBe(false)
  })

  it('não duplica cards do mesmo vocabulário ou erro', () => {
    const before = reviewState(profileId, 50).total
    cardsForRecurringErrors(profileId, 8)
    const afterFirst = reviewState(profileId, 50).total

    cardsForRecurringErrors(profileId, 8)
    const afterSecond = reviewState(profileId, 50).total

    expect(afterFirst).toBeGreaterThanOrEqual(before)
    // segunda chamada com os mesmos erros não cria nada novo
    expect(afterSecond).toBe(afterFirst)
  })
})

describe('sessão guiada', () => {
  it('anda pelas etapas e fecha com recapitulação', async () => {
    abandonGuidedSession(profileId)

    const session = await startGuidedSession(profileId)
    expect(session.lessonId).not.toBeNull()
    expect(['review', 'lesson']).toContain(session.step)

    advanceGuidedSession(profileId, 'lesson')
    advanceGuidedSession(profileId, 'practice')
    expect(activeGuidedSession(profileId)?.step).toBe('practice')

    advanceGuidedSession(profileId, 'tutor')
    const finished = finishGuidedSession(profileId, { reviewDone: 1, practice: { correct: 3, total: 6 } })

    expect(finished.step).toBe('recap')
    expect(finished.recap).not.toBeNull()
    expect(finished.recap?.message.length).toBeGreaterThan(10)
    expect(activeGuidedSession(profileId)).toBeNull()
  })

  it('aparece no estado da home enquanto estiver ativa', async () => {
    const session = await startGuidedSession(profileId)
    expect(homeState().guided?.id).toBe(session.id)

    abandonGuidedSession(profileId)
    expect(homeState().guided).toBeNull()
  })
})

describe('tutor sem modelo configurado', () => {
  it('cria a conversa mesmo quando o abridor falha', async () => {
    const view = await createConversation(profileId, { topic: 'rotina no trabalho' })
    expect(view.conversation.topic).toBe('rotina no trabalho')
    expect(view.messages).toHaveLength(0)
  })

  it('devolve erro claro em vez de quebrar o turno', async () => {
    const view = await createConversation(profileId, { topic: 'erro de rede' })
    const events: string[] = []

    const result = await sendTurn(
      profileId,
      { requestId: 'req-1', conversationId: view.conversation.id, text: 'I have 25 years.' },
      (event) => events.push(event.type)
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('modelo')

    const persisted = getDb()
      .select({ role: schema.messages.role })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, view.conversation.id))
      .all()

    expect(persisted.filter((row) => row.role === 'assistant')).toHaveLength(0)
  })
})

it('home agrega revisão, caderno e "continuar de onde parei"', async () => {
  const lessons = curriculumView().units.flatMap((unit) => unit.lessons)
  await openLesson(lessons[3].id)

  const home = homeState()
  expect(home.curriculumReady).toBe(true)
  expect(home.continueLesson?.id ?? lastOpenedLesson(profileId)?.id).toBeDefined()
  expect(home.review.total).toBeGreaterThan(0)
  expect(home.notebook.open).toBeGreaterThan(0)
  expect(home.notebook.tags.length).toBeGreaterThan(0)
})
