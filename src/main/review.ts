/**
 * Revisão SRS (M2) — FSRS em modo pull.
 *
 * Cards são gerados por template (vocabulário da lição + erros recorrentes),
 * vencidos acumulam em silêncio e são oferecidos quando o aluno abre uma aula,
 * uma conversa ou pede "revisar". Nunca viram cobrança.
 */
import { and, asc, eq, lte, sql } from 'drizzle-orm'
import type {
  CardView,
  LessonVocabularyItem,
  ReviewRating,
  ReviewResult,
  ReviewState
} from '../shared/types'
import {
  applyRating,
  cardDedupeKey,
  dueLabel,
  errorCard,
  freshSchedule,
  fullSchedule,
  phraseCard,
  previewIntervals,
  vocabCard,
  type CardPayload
} from '../core/srs'
import { recurringErrors } from './notebook'
import { profileLocale } from './locale'
import { getDb, schema } from './db'

type CardRow = typeof schema.cards.$inferSelect

const QUEUE_LIMIT = 20

function toView(row: CardRow, now = Date.now()): CardView {
  const payload = parseContent(row.content)

  return {
    id: row.id,
    kind: (row.kind as CardView['kind']) ?? 'vocab',
    front: payload?.front ?? row.content,
    back: payload?.back ?? '',
    hint: payload?.hint ?? null,
    tag: payload?.tag ?? null,
    lessonId: row.lessonId,
    state: (row.state as CardView['state']) ?? 'new',
    due: row.due,
    dueLabel: dueLabel(row.due, now),
    reps: row.reps,
    lapses: row.lapses,
    intervals: previewIntervals(row.schedule, new Date(now))
  }
}

function parseContent(json: string): CardPayload | null {
  try {
    return JSON.parse(json) as CardPayload
  } catch {
    return null
  }
}

function startOfDay(now = Date.now()): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Cria um card se ele ainda não existe para este perfil. */
export function createCard(
  profileId: number,
  payload: CardPayload,
  source: 'lesson' | 'error' | 'conversation' | 'guided' | 'bank',
  lessonId: number | null = null
): boolean {
  const db = getDb()
  const dedupeKey = cardDedupeKey(payload)

  const existing = db
    .select({ id: schema.cards.id })
    .from(schema.cards)
    .where(and(eq(schema.cards.profileId, profileId), eq(schema.cards.dedupeKey, dedupeKey)))
    .get()

  if (existing) return false

  const now = new Date()
  const schedule = fullSchedule(freshSchedule(now))

  db.insert(schema.cards)
    .values({
      profileId,
      content: JSON.stringify(payload),
      kind: payload.kind,
      source,
      lessonId,
      dedupeKey,
      schedule: schedule.schedule,
      stability: schedule.stability,
      difficulty: schedule.difficulty,
      due: schedule.due,
      reps: schedule.reps,
      lapses: schedule.lapses,
      state: schedule.state,
      createdAt: now.getTime()
    })
    .run()

  return true
}

/** Cards de vocabulário de uma lição já gerada (template, sem IA). */
export function cardsForLesson(profileId: number, lessonId: number, vocabulary: LessonVocabularyItem[]): number {
  let created = 0
  const locale = profileLocale()

  for (const item of vocabulary.slice(0, 8)) {
    if (createCard(profileId, vocabCard(item, lessonId, locale), 'lesson', lessonId)) created += 1
  }

  return created
}

/** Cards a partir dos erros recorrentes do caderno. */
export function cardsForRecurringErrors(profileId: number, limit = 6): number {
  let created = 0
  const locale = profileLocale()

  for (const error of recurringErrors(profileId, 2, limit)) {
    if (
      createCard(
        profileId,
        errorCard(
          { original: error.original, corrected: error.corrected, tag: error.tag, note: error.note },
          locale
        ),
        'error'
      )
    ) {
      created += 1
    }
  }

  return created
}

export function cardsForErrorsFrom(
  profileId: number,
  errors: { original: string; corrected: string; tag: string; note?: string | null }[]
): number {
  let created = 0
  const locale = profileLocale()
  for (const error of errors) {
    if (createCard(profileId, errorCard(error, locale), 'error')) created += 1
  }
  return created
}

export function cardsForPhrases(
  profileId: number,
  phrases: { target: string; native: string }[],
  lessonId: number | null = null
): number {
  let created = 0
  const locale = profileLocale()
  for (const phrase of phrases.slice(0, 3)) {
    if (createCard(profileId, phraseCard(phrase.target, phrase.native, lessonId, locale), 'lesson', lessonId)) created += 1
  }
  return created
}

/** Fila de revisão: vencidos (mais atrasados primeiro) + contadores. */
export function reviewState(profileId: number, limit = QUEUE_LIMIT): ReviewState {
  const db = getDb()
  const now = Date.now()

  const dueRows = db
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.profileId, profileId), lte(schema.cards.due, now)))
    .orderBy(asc(schema.cards.due))
    .all()

  const counts = db
    .select({
      total: sql<number>`count(*)`,
      fresh: sql<number>`sum(case when ${schema.cards.state} = 'new' then 1 else 0 end)`,
      learning: sql<number>`sum(case when ${schema.cards.state} in ('learning','relearning') then 1 else 0 end)`
    })
    .from(schema.cards)
    .where(eq(schema.cards.profileId, profileId))
    .get()

  const reviewedToday = db
    .select({ value: sql<number>`count(*)` })
    .from(schema.reviews)
    .innerJoin(schema.cards, eq(schema.cards.id, schema.reviews.cardId))
    .where(and(eq(schema.cards.profileId, profileId), gteToday(now)))
    .get()?.value ?? 0

  return {
    due: dueRows.slice(0, limit).map((row) => toView(row, now)),
    dueCount: dueRows.length,
    newCount: Number(counts?.fresh ?? 0),
    learningCount: Number(counts?.learning ?? 0),
    total: Number(counts?.total ?? 0),
    reviewedToday: Number(reviewedToday)
  }
}

function gteToday(now: number) {
  return sql`${schema.reviews.reviewedAt} >= ${startOfDay(now)}`
}

export function dueCount(profileId: number): number {
  const row = getDb()
    .select({ value: sql<number>`count(*)` })
    .from(schema.cards)
    .where(and(eq(schema.cards.profileId, profileId), lte(schema.cards.due, Date.now())))
    .get()

  return Number(row?.value ?? 0)
}

/** Aplica a nota ao card e grava o review. */
export function answerReview(profileId: number, cardId: number, rating: ReviewRating): ReviewResult {
  const db = getDb()

  const card = db
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.id, cardId), eq(schema.cards.profileId, profileId)))
    .get()

  if (!card) throw new Error('Card não encontrado.')

  const now = new Date()
  const outcome = applyRating(card.schedule, rating, now)

  db.transaction((tx) => {
    tx.update(schema.cards)
      .set({
        schedule: outcome.schedule,
        stability: outcome.stability,
        difficulty: outcome.difficulty,
        due: outcome.due,
        reps: outcome.reps,
        lapses: outcome.lapses,
        state: outcome.state,
        lastReviewAt: now.getTime()
      })
      .where(eq(schema.cards.id, cardId))
      .run()

    tx.insert(schema.reviews)
      .values({ cardId, rating: ratingOf(rating), reviewedAt: now.getTime() })
      .run()
  })

  return {
    cardId,
    rating,
    nextDueLabel: dueLabel(outcome.due, now.getTime()),
    dueCount: dueCount(profileId),
    reviewedToday: Number(
      db
        .select({ value: sql<number>`count(*)` })
        .from(schema.reviews)
        .innerJoin(schema.cards, eq(schema.cards.id, schema.reviews.cardId))
        .where(and(eq(schema.cards.profileId, profileId), gteToday(now.getTime())))
        .get()?.value ?? 0
    )
  }
}

function ratingOf(rating: ReviewRating): number {
  switch (rating) {
    case 'again':
      return 1
    case 'hard':
      return 2
    case 'good':
      return 3
    default:
      return 4
  }
}
