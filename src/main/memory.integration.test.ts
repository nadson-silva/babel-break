/**
 * Reset de memória: "entrar pela primeira vez" com o banco limpo — perfil,
 * currículo, trilhas, caderno de erros, cards, progresso e conversas somem,
 * e um onboarding novo (até em outro idioma) volta a ser aceito.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { count } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { getDb, initDatabase, schema } from './db'
import { completeOnboarding, generateCurriculum, resetMemory } from './learning'

beforeAll(() => {
  initDatabase()
})

const MEMORY_TABLES: Array<[name: string, table: SQLiteTable]> = [
  ['reviews', schema.reviews],
  ['cards', schema.cards],
  ['errors', schema.errors],
  ['attempts', schema.attempts],
  ['scenarioRuns', schema.scenarioRuns],
  ['contentReports', schema.contentReports],
  ['messages', schema.messages],
  ['conversations', schema.conversations],
  ['studySessions', schema.studySessions],
  ['lessonProgress', schema.lessonProgress],
  ['trackLessons', schema.trackLessons],
  ['exercises', schema.exercises],
  ['lessonItems', schema.lessonItems],
  ['lessons', schema.lessons],
  ['units', schema.units],
  ['focusTracks', schema.focusTracks],
  ['skillsState', schema.skillsState]
]

function memoryRowCounts(): Record<string, number> {
  const db = getDb()
  const counts: Record<string, number> = {}
  for (const [name, table] of MEMORY_TABLES) {
    counts[name] = db.select({ n: count() }).from(table).get()!.n
  }
  return counts
}

describe('reset de memória', () => {
  it('volta o app ao estado de primeiro acesso', async () => {
    const onboarded = completeOnboarding({ goal: 'entrevista para dev', cefr: 'A2' })
    await generateCurriculum()

    const db = getDb()
    const profileId = onboarded.profile.id
    const lesson = db.select({ id: schema.lessons.id }).from(schema.lessons).get()
    expect(lesson).toBeDefined()

    // Memória de aluno: estimativas (já semeadas pelo onboarding), caderno,
    // fila SRS e progresso de lição.
    db.insert(schema.errors)
      .values({
        profileId,
        category: 'exercise',
        tag: 'tense',
        original: 'I go yesterday',
        corrected: 'I went yesterday',
        createdAt: Date.now(),
        lastSeenAt: Date.now()
      })
      .run()
    const card = db
      .insert(schema.cards)
      .values({ profileId, content: 'deck — baralho', due: Date.now(), createdAt: Date.now() })
      .returning()
      .get()
    db.insert(schema.reviews).values({ cardId: card.id, rating: 3, reviewedAt: Date.now() }).run()
    db.insert(schema.lessonProgress)
      .values({ profileId, lessonId: lesson!.id, status: 'completed', score: 1 })
      .run()

    expect(Object.values(memoryRowCounts()).some((value) => value > 0)).toBe(true)

    const state = resetMemory()

    // Perfil recreatedo do zero: onboarding por fazer, sem nível, sem objetivo.
    expect(state.profile.onboardingComplete).toBe(false)
    expect(state.profile.goal).toBeNull()
    expect(state.profile.cefr).toBeNull()
    expect(state.skills).toHaveLength(0)
    expect(state.curriculumReady).toBe(false)

    const totals = memoryRowCounts()
    expect(Object.values(totals).every((value) => value === 0)).toBe(true)

    // O banco só guarda o perfil padrão recém-criado pelo próprio reset.
    const profiles = db.select({ n: count() }).from(schema.profiles).get()!.n
    expect(profiles).toBe(1)
  })

  it('libera a escolha de outro idioma no novo onboarding', () => {
    // Antes do reset isso esbarraria em "idioma só no primeiro onboarding";
    // memória limpa, o acesso volta a ser o primeiro.
    const state = completeOnboarding({ goal: 'viagem', cefr: 'B1', targetLang: 'es', nativeLang: 'pt-BR' })

    expect(state.profile.targetLang).toBe('es')
    expect(state.profile.onboardingComplete).toBe(true)
  })
})
