/**
 * M6 (C5/C6): a migração 0006 colocou FK com `ON DELETE CASCADE` nas arestas
 * de risco e índices nos caminhos quentes. Teste vivo: apagar o pai leva os
 * filhos (nada de órfão) — exatamente o que export/import da v2 precisa.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { getDb, initDatabase, schema } from './db'

beforeAll(() => {
  initDatabase()
})

describe('FK com cascade + índices (M6/C5/C6)', () => {
  it('lição apagada leva lesson_items; card apagado leva reviews', () => {
    const db = getDb()
    const now = Date.now()

    const lesson = db
      .insert(schema.lessons)
      .values({ title: 'FK probe', level: 'A1', position: 999, createdAt: now })
      .returning()
      .get()
    const item = db
      .insert(schema.lessonItems)
      .values({ lessonId: lesson.id, kind: 'vocab', payload: '{}' })
      .returning()
      .get()
    const card = db
      .insert(schema.cards)
      .values({ profileId: 1, content: 'probe', kind: 'vocab', source: 'lesson', due: now, createdAt: now })
      .returning()
      .get()
    const review = db
      .insert(schema.reviews)
      .values({ cardId: card.id, rating: 3, reviewedAt: now })
      .returning()
      .get()

    db.delete(schema.lessons).where(eq(schema.lessons.id, lesson.id)).run()
    db.delete(schema.cards).where(eq(schema.cards.id, card.id)).run()

    expect(
      db.select().from(schema.lessonItems).where(inArray(schema.lessonItems.id, [item.id])).all()
    ).toHaveLength(0)
    expect(
      db.select().from(schema.reviews).where(inArray(schema.reviews.id, [review.id])).all()
    ).toHaveLength(0)
  })

  it('conversa apagada leva mensagens; exercício apagado leva tentativas', () => {
    const db = getDb()
    const now = Date.now()

    const conversation = db
      .insert(schema.conversations)
      .values({ profileId: 1, mode: 'free', createdAt: now })
      .returning()
      .get()
    const message = db
      .insert(schema.messages)
      .values({ conversationId: conversation.id, role: 'user', content: 'oi', createdAt: now })
      .returning()
      .get()

    const exercise = db
      .insert(schema.exercises)
      .values({ lessonId: 1, type: 'cloze', payload: '{}', answerKey: '{"answer":"x"}', createdAt: now })
      .returning()
      .get()
    const attempt = db
      .insert(schema.attempts)
      .values({ exerciseId: exercise.id, response: 'x', correct: true, createdAt: now })
      .returning()
      .get()

    db.delete(schema.conversations).where(eq(schema.conversations.id, conversation.id)).run()
    db.delete(schema.exercises).where(eq(schema.exercises.id, exercise.id)).run()

    expect(db.select().from(schema.messages).where(eq(schema.messages.id, message.id)).all()).toHaveLength(0)
    expect(db.select().from(schema.attempts).where(eq(schema.attempts.id, attempt.id)).all()).toHaveLength(0)
  })

  it('índices novos existem no banco', () => {
    const db = getDb()
    const rows = db.all(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%\_idx'`)
    const indexed = rows.map((row) => String(row.name))

    for (const name of [
      'exercises_lesson_idx',
      'attempts_exercise_idx',
      'lesson_items_lesson_idx',
      'messages_conversation_idx',
      'reviews_card_idx',
      'reviews_time_idx'
    ]) {
      expect(indexed, name).toContain(name)
    }
  })
})
