/**
 * M6 (C1): mutex por lição — pré-geração e aluno não pagam a mesma geração
 * duas vezes. Sem o mutex, o `version` da lição sobe 2 com aberturas
 * concorrentes; com ele, o trabalho (e a chamada de IA) é um só.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { isRateLimited } from './ai'
import { getDb, initDatabase, schema } from './db'
import { completeOnboarding, curriculumView, generateCurriculum, openLesson } from './learning'

let profileId = 0

beforeAll(async () => {
  initDatabase()
  profileId = completeOnboarding({ goal: 'viajar', cefr: 'A2' }).profile.id
  await generateCurriculum()
})

describe('mutex de geração por lição (M6/C1)', () => {
  it('duas aberturas concorrentes geram o conteúdo uma única vez', async () => {
    const lesson = curriculumView().units[0].lessons[0]
    const db = getDb()

    db.update(schema.lessons)
      .set({ content: null, version: 1, staleAt: null })
      .where(eq(schema.lessons.id, lesson.id))
      .run()

    const started = profileId > 0

    const [left, right] = await Promise.all([openLesson(lesson.id), openLesson(lesson.id)])

    expect(started).toBe(true)
    expect(left.content.title).toBe(right.content.title)

    const row = db
      .select({ version: schema.lessons.version })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lesson.id))
      .get()

    // Um único writer: version 1 → 2. Sem mutex a corrida gravaria 3.
    expect(row?.version).toBe(2)
  })
})

describe('classificador de rate limit (M6/C3)', () => {
  it('reconhece 429 e RESOURCE_EXHAUSTED como fim de linha', () => {
    expect(isRateLimited(new Error('Ollama respondeu 429'))).toBe(true)
    expect(isRateLimited(new Error('429 RESOURCE_EXHAUSTED'))).toBe(true)
    expect(isRateLimited(new Error('rate limit exceeded'))).toBe(true)
    expect(isRateLimited(new Error('connection refused'))).toBe(false)
    expect(isRateLimited('texto solto')).toBe(false)
  })
})
