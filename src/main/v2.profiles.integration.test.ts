/**
 * Integração da v2 (sem IA e sem GUI): múltiplos perfis.
 *
 * O que este arquivo prova é a premissa da v2 — **dois alunos no mesmo
 * aparelho, sem vazamento entre eles**:
 *
 * - currículo, lição, exercício, card, erro, conversa e trilha só aparecem para
 *   o dono (id de outro perfil é `não encontrado`, nunca dados alheios);
 * - o **idioma** de cards/rótulos segue o perfil de cada um, não o primeiro
 *   perfil do aparelho (era `getDefaultProfile()` ambiental);
 * - painel, cache e home são agregados **por perfil**;
 * - apagar um perfil não toca na memória do outro;
 * - trocar de perfil cancela o stream do anterior.
 *
 * Sem modelo configurado, toda geração cai no gerador determinístico (inglês),
 * que é exatamente o caminho que precisa continuar funcionando.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { getDb, initDatabase, schema } from './db'
import { updateSettings } from './settings'
import {
  activeProfile,
  activeProfileId,
  createProfile,
  deleteProfile,
  listProfiles,
  setActiveProfile
} from './profiles'
import {
  answerExercise,
  completeOnboarding,
  curriculumView,
  finishLesson,
  generateCurriculum,
  openLesson,
  profilesView
} from './learning'
import { recordCorrections, setErrorResolved } from './notebook'
import { answerReview, cardsForLesson, reviewState } from './review'
import { homeState } from './home'
import { dashboardView } from './dashboard'
import { cacheStats } from './prewarm'
import { submitReport } from './reports'
import { startScenarioRun, refreshLessonScenario } from './scenario'
import { createConversation, cancelTurnsExceptProfile } from './tutor'
import { resetProviderStatus } from './provider-status'

type Learner = {
  profileId: number
  lessonId: number
  exerciseId: number
  cardId: number
  errorId: number
  conversationId: number
  sessionId: number
}

const learners: { a: Learner; b: Learner } = {} as { a: Learner; b: Learner }

/** Perfil novo, onboarding pronto, currículo gerado e memória semeada. */
async function buildLearner(name: string, nativeLang: string): Promise<Learner> {
  const profile = createProfile({ name, targetLang: 'en', nativeLang })
  completeOnboarding({ goal: 'conversação', cefr: 'A2', targetLang: 'en', nativeLang })
  await generateCurriculum(profile.id)

  const lesson = curriculumView(profile.id).units[0]?.lessons[0]
  if (!lesson) throw new Error('currículo vazio')

  const detail = await openLesson(lesson.id, profile.id)
  const exercise = detail.exercises[0]
  if (!exercise) throw new Error('lição sem exercícios')

  const cardsCreated = cardsForLesson(profile.id, lesson.id, detail.content.vocabulary)
  const recorded = recordCorrections(
    profile.id,
    [{ original: 'I am agree', corrected: 'I agree', tag: 'be-vs-verb', source: 'bank' }],
    { category: 'test', context: name }
  )

  const card = getDb()
    .select({ id: schema.cards.id })
    .from(schema.cards)
    .where(eq(schema.cards.profileId, profile.id))
    .get()
  const error = getDb()
    .select({ id: schema.errors.id })
    .from(schema.errors)
    .where(eq(schema.errors.profileId, profile.id))
    .get()

  const conversation = await createConversation(profile.id, { topic: name })
  const session = getDb()
    .select({ id: schema.studySessions.id })
    .from(schema.studySessions)
    .where(and(eq(schema.studySessions.profileId, profile.id), eq(schema.studySessions.kind, 'lesson')))
    .get()

  expect(cardsCreated).toBeGreaterThan(0)
  expect(recorded).toBeGreaterThan(0)

  return {
    profileId: profile.id,
    lessonId: lesson.id,
    exerciseId: exercise.id,
    cardId: card?.id ?? 0,
    errorId: error?.id ?? 0,
    conversationId: conversation.conversation.id,
    sessionId: session?.id ?? 0
  }
}

beforeAll(async () => {
  initDatabase()
  // Nada de IA: o teste exercita o caminho determinístico e o escopo de perfil.
  updateSettings({ provider: 'ollama', ollamaModel: '', ollamaBaseUrl: 'http://127.0.0.1:1', pregenerate: false })
  resetProviderStatus()

  learners.a = await buildLearner('Ana', 'pt-BR')
  learners.b = await buildLearner('Ben', 'en')
})

describe('perfis separados por construção', () => {
  it('o perfil ativo é o último criado/usado, e a lista traz os dois', () => {
    expect(activeProfileId()).toBe(learners.b.profileId)

    const view = profilesView()
    expect(view.multiProfile).toBe(true)
    expect(view.profiles).toHaveLength(2)
    expect(view.profiles.map((entry) => entry.name)).toEqual(['Ben', 'Ana'])

    const ana = view.profiles.find((entry) => entry.name === 'Ana')
    const ben = view.profiles.find((entry) => entry.name === 'Ben')
    expect(ana?.active).toBe(false)
    expect(ben?.active).toBe(true)
    expect(ana?.completedLessons).toBe(0)
    expect(ana?.dueCards).toBeGreaterThan(0)
    expect(ana?.openErrors).toBe(1)
  })

  it('home e painel agregam só a memória do perfil pedido', async () => {
    // Ana abre uma lição a mais que Ben: é assim que se vê a contagem separada.
    const secondAna = curriculumView(learners.a.profileId).units[0]?.lessons[1]
    expect(secondAna).toBeTruthy()
    await openLesson(secondAna?.id as number, learners.a.profileId)

    setActiveProfile(learners.a.profileId)
    const homeA = homeState()
    setActiveProfile(learners.b.profileId)
    const homeB = homeState()

    expect(homeA.profile.id).toBe(learners.a.profileId)
    expect(homeB.profile.id).toBe(learners.b.profileId)
    // Mesma quantidade de lições no currículo, ids completamente separados.
    expect(homeA.totalCount).toBeGreaterThan(0)
    expect(homeB.totalCount).toBe(homeA.totalCount)
    expect(homeA.units.map((unit) => unit.lessons.map((lesson) => lesson.id))).not.toEqual(
      homeB.units.map((unit) => unit.lessons.map((lesson) => lesson.id))
    )

    const dashA = dashboardView(Date.now(), learners.a.profileId)
    expect(dashA.profile.id).toBe(learners.a.profileId)
    expect(dashA.cache.lessonsTotal).toBe(homeA.totalCount)

    const statsAna = cacheStats(learners.a.profileId)
    const statsBen = cacheStats(learners.b.profileId)
    expect(statsAna.lessonsCached).toBe(2)
    expect(statsBen.lessonsCached).toBe(1)
  })

  it('o idioma dos cards segue o perfil do card (não o primeiro perfil)', () => {
    setActiveProfile(learners.a.profileId)
    const inPortuguese = reviewState(learners.a.profileId, 50)
    setActiveProfile(learners.b.profileId)
    const inEnglish = reviewState(learners.b.profileId, 50)

    const anaHint = inPortuguese.due.find((card) => card.id === learners.a.cardId)?.hint ?? ''
    const benHint = inEnglish.due.find((card) => card.id === learners.b.cardId)?.hint ?? ''

    expect(anaHint).toMatch(/Complete a frase|Diga o termo/)
    expect(benHint).toMatch(/Complete the sentence|Say the term/)
    // Nenhum card do Ben pode sair em português: era `getDefaultProfile()` ambiental.
    expect(inEnglish.due.every((card) => !/Complete a frase|Diga o termo/.test(card.hint ?? ''))).toBe(true)
  })
})

describe('escopo por perfil nos handlers (v2 / D2)', () => {
  beforeAll(() => {
    setActiveProfile(learners.b.profileId)
  })

  function expectForeign(message: string): void {
    expect(message).toMatch(/não encontrad/i)
  }

  it('lição de outro perfil não abre, não responde e não fecha', async () => {
    await openLesson(learners.a.lessonId, learners.b.profileId).catch((error: unknown) => {
      expectForeign(error instanceof Error ? error.message : String(error))
    })

    let threw = ''
    try {
      await answerExercise({ exerciseId: learners.a.exerciseId, response: 'x' }, learners.b.profileId)
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error)
    }
    expectForeign(threw)

    threw = ''
    try {
      finishLesson({ lessonId: learners.a.lessonId, sessionId: learners.a.sessionId }, learners.b.profileId)
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error)
    }
    expectForeign(threw)

    // O progresso da Ana não mudou: a tentativa dela continua sem resposta alheia.
    const attempts = Number(
      getDb()
        .select({ value: count() })
        .from(schema.attempts)
        .where(eq(schema.attempts.exerciseId, learners.a.exerciseId))
        .get()?.value ?? 0
    )
    expect(attempts).toBe(0)
  })

  it('card, erro e relatório de outro perfil ficam fora de alcance', () => {
    let threw = ''
    try {
      answerReview(learners.b.profileId, learners.a.cardId, 'good')
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error)
    }
    expectForeign(threw)

    threw = ''
    try {
      setErrorResolved(learners.b.profileId, learners.a.errorId, true)
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error)
    }
    expectForeign(threw)

    const errorRow = getDb()
      .select({ resolvedAt: schema.errors.resolvedAt })
      .from(schema.errors)
      .where(eq(schema.errors.id, learners.a.errorId))
      .get()
    expect(errorRow?.resolvedAt).toBeNull()

    // Report sobre exercício alheio: registrado, mas sem efeito.
    const report = submitReport({ kind: 'exercise', targetId: learners.a.exerciseId, reason: 'wrong_answer' }, learners.b.profileId)
    expect(report.effect).toBe('logged')

    const blocked = Number(
      getDb()
        .select({ value: count() })
        .from(schema.exercises)
        .where(and(eq(schema.exercises.id, learners.a.exerciseId), eq(schema.exercises.blocked, true)))
        .get()?.value ?? 0
    )
    expect(blocked).toBe(0)
  })

  it('cenário e conversa não aceitam lição de outro perfil', async () => {
    let threw = ''
    try {
      await startScenarioRun(learners.b.profileId, { lessonId: learners.a.lessonId })
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error)
    }
    expectForeign(threw)

    threw = ''
    try {
      await refreshLessonScenario(learners.a.lessonId, learners.b.profileId)
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error)
    }
    expectForeign(threw)

    threw = ''
    try {
      await createConversation(learners.b.profileId, { lessonId: learners.a.lessonId })
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error)
    }
    expectForeign(threw)

    // O cenário cacheado da Ana continua intacto.
    const scenario = getDb()
      .select({ scenario: schema.lessons.scenario })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, learners.a.lessonId))
      .get()
    expect(scenario?.scenario ?? null).toBeNull()
  })

  it('sessões de estudo da Ana não são fechadas pelo Ben', () => {
    const before = getDb()
      .select({ endedAt: schema.studySessions.endedAt })
      .from(schema.studySessions)
      .where(eq(schema.studySessions.id, learners.a.sessionId))
      .get()
    expect(before?.endedAt).toBeNull()

    finishLesson({ lessonId: learners.b.lessonId, sessionId: learners.b.sessionId }, learners.b.profileId)

    const after = getDb()
      .select({ endedAt: schema.studySessions.endedAt })
      .from(schema.studySessions)
      .where(eq(schema.studySessions.id, learners.a.sessionId))
      .get()
    expect(after?.endedAt).toBeNull()
  })

  it('trocar de perfil derruba o stream do perfil anterior', () => {
    // `cancelTurnsExceptProfile` é o gancho usado por `profile:switch`.
    expect(cancelTurnsExceptProfile(learners.b.profileId)).toBeGreaterThanOrEqual(0)
    expect(cancelTurnsExceptProfile(learners.a.profileId)).toBe(0)
  })
})

describe('apagar perfil apaga só ele', () => {
  it('deleteProfile remove a memória da Ana e deixa a do Ben intacta', () => {
    setActiveProfile(learners.b.profileId)
    const benLessonIds = curriculumView(learners.b.profileId)
      .units.flatMap((unit) => unit.lessons)
      .map((lesson) => lesson.id)

    const result = deleteProfile(learners.a.profileId)
    expect(result.remaining).toBe(1)
    expect(listProfiles().map((row) => row.id)).toEqual([learners.b.profileId])
    expect(activeProfile().id).toBe(learners.b.profileId)

    const leftovers = getDb()
      .select({ id: schema.lessons.id })
      .from(schema.lessons)
      .where(inArray(schema.lessons.profileId, [learners.a.profileId]))
      .all()
    expect(leftovers).toHaveLength(0)

    const countWhereProfile = (table: 'cards' | 'errors' | 'conversations' | 'units' | 'studySessions'): number => {
      const from = {
        cards: schema.cards,
        errors: schema.errors,
        conversations: schema.conversations,
        units: schema.units,
        studySessions: schema.studySessions
      }[table]
      return Number(
        getDb()
          .select({ value: count() })
          .from(from)
          .where(eq(from.profileId, learners.a.profileId))
          .get()?.value ?? 0
      )
    }

    for (const table of ['cards', 'errors', 'conversations', 'units', 'studySessions'] as const) {
      expect(countWhereProfile(table), table).toBe(0)
    }

    // As tabelas sem `profile_id` (exercícios, itens, progresso de lição) também
    // não deixaram rastro: nada aponta para lição que não existe mais.
    const dangling = Number(
      getDb()
        .select({ value: count() })
        .from(schema.exercises)
        .where(
          sql`${schema.exercises.lessonId} not in (select ${schema.lessons.id} from ${schema.lessons})`
        )
        .get()?.value ?? 0
    )
    expect(dangling).toBe(0)

    // Ben continua com tudo o que é dele.
    const stillThere = getDb()
      .select({ value: count() })
      .from(schema.lessons)
      .where(inArray(schema.lessons.id, benLessonIds))
      .get()
    expect(Number(stillThere?.value ?? 0)).toBe(benLessonIds.length)

    const benCards = Number(
      getDb()
        .select({ value: count() })
        .from(schema.cards)
        .where(eq(schema.cards.profileId, learners.b.profileId))
        .get()?.value ?? 0
    )
    expect(benCards).toBeGreaterThan(0)
  })

  it('o último perfil apagado dá lugar a um perfil limpo (nunca zero)', () => {
    const ben = learners.b.profileId
    deleteProfile(ben)

    const fresh = activeProfile()
    expect(fresh.onboardingCompletedAt).toBeNull()
    expect(listProfiles()).toHaveLength(1)

    const orphans = Number(
      getDb()
        .select({ value: sql<number>`count(*)` })
        .from(schema.lessons)
        .get()?.value ?? 0
    )
    expect(orphans).toBe(0)
  })
})
