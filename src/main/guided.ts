/**
 * Sessão guiada opcional (M2) — 15 a 20 minutos, só quando o aluno pede.
 *
 * Revisão (pulável) → lição → prática → tutor → fechamento com recapitulação
 * das correções, novos cards e tags no caderno. O estado vive em
 * `study_sessions.summary`, então a sessão sobrevive a fechar o app no meio.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Correction, GuidedSession, GuidedStep, RecapView, ScenarioFeedbackView } from '../shared/types'
import { pickRecommendationOrigin } from '../core/tracks'
import { emitStudentEvent } from './events'
import { getDb, schema } from './db'
import { openLesson } from './learning'
import { dueCount } from './review'
import { finishScenarioRun, startScenarioRun } from './scenario'
import { buildRecap, closeConversation, createConversation } from './tutor'
import { openTrackLessons } from './tracks'
import { getSettings } from './settings'

const STEPS: GuidedStep[] = ['review', 'lesson', 'practice', 'tutor', 'recap']

interface GuidedSummary {
  lessonId: number | null
  lessonTitle: string | null
  conversationId: number | null
  step: GuidedStep
  review: { dueCount: number; done: number }
  practice: { correct: number; total: number }
  recap: RecapView | null
  /** Lição de trilha marcada para roleplay: o passo 4 vira cenário. */
  isScenario?: boolean
}

type SessionRow = typeof schema.studySessions.$inferSelect

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readSummary(row: SessionRow): GuidedSummary {
  try {
    const parsed = JSON.parse(row.summary ?? '') as GuidedSummary
    if (parsed && STEPS.includes(parsed.step)) {
      return {
        lessonId: parsed.lessonId ?? null,
        lessonTitle: parsed.lessonTitle ?? null,
        conversationId: parsed.conversationId ?? null,
        step: parsed.step,
        review: parsed.review ?? { dueCount: 0, done: 0 },
        practice: parsed.practice ?? { correct: 0, total: 0 },
        recap: parsed.recap ?? null,
        isScenario: parsed.isScenario ?? false
      }
    }
  } catch {
    // sessão antiga ou corrompida: recomeça do passo de revisão
  }

  return {
    lessonId: null,
    lessonTitle: null,
    conversationId: null,
    step: 'review',
    review: { dueCount: 0, done: 0 },
    practice: { correct: 0, total: 0 },
    recap: null
  }
}

function writeSummary(row: SessionRow, summary: GuidedSummary): GuidedSummary {
  getDb()
    .update(schema.studySessions)
    .set({ summary: JSON.stringify(summary) })
    .where(eq(schema.studySessions.id, row.id))
    .run()

  return summary
}

function toView(row: SessionRow, summary: GuidedSummary): GuidedSession {
  return {
    id: row.id,
    step: summary.step,
    lessonId: summary.lessonId,
    lessonTitle: summary.lessonTitle,
    conversationId: summary.conversationId,
    review: summary.review,
    practice: summary.practice,
    startedAt: row.startedAt,
    recap: summary.recap,
    isScenario: summary.isScenario ?? false
  }
}

export function activeGuidedSession(profileId: number): GuidedSession | null {
  const row = getDb()
    .select()
    .from(schema.studySessions)
    .where(
      and(
        eq(schema.studySessions.profileId, profileId),
        eq(schema.studySessions.kind, 'guided'),
        isNull(schema.studySessions.endedAt)
      )
    )
    .orderBy(desc(schema.studySessions.id))
    .limit(1)
    .get()

  if (!row) return null
  return toView(row, readSummary(row))
}

/**
 * Lição da sessão: a que está em andamento (base ou trilha); senão a próxima do
 * lado decidido pelo `focusMix`. Lição de foco marcada para roleplay chega como
 * cenário — o passo 4 da sessão vira roleplay com rubrica, não chat solto.
 */
function pickLesson(profileId: number): { id: number; title: string; isScenario: boolean } | null {
  const inProgress = lessonInProgress(profileId)
  if (inProgress) return inProgress

  const base = nextBaseLesson(profileId)
  const focus = openTrackLessons(profileId)

  const origin = pickRecommendationOrigin({
    focusMix: getSettings().focusMix,
    history: recentOrigins(profileId),
    hasBase: base != null,
    hasFocus: focus.length > 0
  })

  if (origin === 'focus') {
    const lesson = focus[0]
    return { id: lesson.id, title: lesson.title, isScenario: lesson.isScenario }
  }

  if (base) return { ...base, isScenario: false }

  const lesson = focus[0]
  return lesson ? { id: lesson.id, title: lesson.title, isScenario: lesson.isScenario } : null
}

/** Lição em andamento do perfil, vindo da base ou de uma trilha. */
function lessonInProgress(profileId: number): { id: number; title: string; isScenario: boolean } | null {
  const db = getDb()

  const row = db
    .select({
      id: schema.lessons.id,
      title: schema.lessons.title,
      trackId: schema.lessons.trackId,
      scenario: schema.lessons.scenario
    })
    .from(schema.lessonProgress)
    .innerJoin(schema.lessons, eq(schema.lessons.id, schema.lessonProgress.lessonId))
    .leftJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
    .leftJoin(schema.focusTracks, eq(schema.focusTracks.id, schema.lessons.trackId))
    .where(
      and(
        eq(schema.lessonProgress.profileId, profileId),
        eq(schema.lessonProgress.status, 'in_progress'),
        sql`coalesce(${schema.units.profileId}, ${schema.focusTracks.profileId}) = ${profileId}`
      )
    )
    .orderBy(desc(schema.lessonProgress.lastOpenedAt))
    .limit(1)
    .get()

  if (!row) return null
  return { id: row.id, title: row.title, isScenario: row.trackId != null && Boolean(row.scenario) }
}

/** Próxima lição do currículo base: a não iniciada mais à frente; senão a primeira. */
function nextBaseLesson(profileId: number): { id: number; title: string } | null {
  const db = getDb()

  const next = db
    .select({ id: schema.lessons.id, title: schema.lessons.title })
    .from(schema.lessons)
    .innerJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
    .leftJoin(
      schema.lessonProgress,
      and(eq(schema.lessonProgress.lessonId, schema.lessons.id), eq(schema.lessonProgress.profileId, profileId))
    )
    .where(and(eq(schema.units.profileId, profileId), isNull(schema.lessonProgress.lessonId)))
    .orderBy(asc(schema.units.position), asc(schema.lessons.position), asc(schema.lessons.id))
    .limit(1)
    .get()

  if (next) return next

  return (
    db
      .select({ id: schema.lessons.id, title: schema.lessons.title })
      .from(schema.lessons)
      .innerJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
      .where(eq(schema.units.profileId, profileId))
      .orderBy(asc(schema.units.position), asc(schema.lessons.position), asc(schema.lessons.id))
      .limit(1)
      .get() ?? null
  )
}

/** O que o aluno abriu por último, por camada — alimenta o mix sem criar cota. */
function recentOrigins(profileId: number): ('base' | 'focus')[] {
  const db = getDb()

  return db
    .select({ trackId: schema.lessons.trackId })
    .from(schema.lessonProgress)
    .innerJoin(schema.lessons, eq(schema.lessons.id, schema.lessonProgress.lessonId))
    .where(eq(schema.lessonProgress.profileId, profileId))
    .orderBy(desc(schema.lessonProgress.lastOpenedAt))
    .limit(6)
    .all()
    .reverse()
    .map((row) => (row.trackId != null ? 'focus' : 'base'))
}

export async function startGuidedSession(profileId: number): Promise<GuidedSession> {
  const db = getDb()
  const lesson = pickLesson(profileId)

  if (!lesson) {
    throw new Error('Gere o currículo primeiro: a sessão guiada precisa de uma lição para seguir.')
  }

  const existing = activeGuidedSession(profileId)
  if (existing && existing.lessonId === lesson.id && existing.recap === null) return existing

  const now = Date.now()
  const due = dueCount(profileId)

  const row = db
    .insert(schema.studySessions)
    .values({
      profileId,
      kind: 'guided',
      startedAt: now,
      summary: null
    })
    .returning()
    .get()

  // Abre a lição (gera conteúdo/exercícios se preciso) já no início, para o
  // aluno não esperar na etapa 2.
  try {
    await openLesson(lesson.id)
  } catch (error) {
    console.warn('[guided] não foi possível preparar a lição:', errorMessage(error))
  }

  const summary = writeSummary(row, {
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    conversationId: null,
    step: due > 0 ? 'review' : 'lesson',
    review: { dueCount: due, done: 0 },
    practice: { correct: 0, total: 0 },
    recap: null,
    isScenario: lesson.isScenario
  })

  return toView(row, summary)
}

export function advanceGuidedSession(profileId: number, step: GuidedStep): GuidedSession {
  const row = requireActive(profileId)
  const summary = readSummary(row)
  return toView(row, writeSummary(row, { ...summary, step }))
}

/** Marca quantos cards o aluno revisou nesta sessão. */
export function recordGuidedReview(profileId: number, done: number): GuidedSession {
  const row = requireActive(profileId)
  const summary = readSummary(row)
  return toView(row, writeSummary(row, { ...summary, review: { ...summary.review, done } }))
}

export function recordGuidedPractice(
  profileId: number,
  practice: { correct: number; total: number }
): GuidedSession {
  const row = requireActive(profileId)
  const summary = readSummary(row)
  return toView(row, writeSummary(row, { ...summary, practice }))
}

/**
 * Cria (ou reaproveita) a conversa do passo 4. Em lição de trilha marcada para
 * roleplay, a conversa nasce em modo cenário — persona e critérios da tarefa.
 */
export async function ensureGuidedConversation(profileId: number): Promise<GuidedSession> {
  const row = requireActive(profileId)
  const summary = readSummary(row)

  if (summary.conversationId) return toView(row, { ...summary, step: 'tutor' })

  if (summary.isScenario && summary.lessonId != null) {
    const session = await startScenarioRun(profileId, { lessonId: summary.lessonId })
    return toView(
      row,
      writeSummary(row, {
        ...summary,
        conversationId: session.conversation.id,
        step: 'tutor'
      })
    )
  }

  const conversation = await createConversation(profileId, {
    lessonId: summary.lessonId,
    topic: summary.lessonTitle ? `prática da lição “${summary.lessonTitle}”` : null
  })

  return toView(row, writeSummary(row, { ...summary, conversationId: conversation.conversation.id, step: 'tutor' }))
}

export interface GuidedFinishInput {
  reviewDone?: number
  practice?: { correct: number; total: number }
}

/** Passo 5: recapitulação de correções → cards + tags + reestimativa de nível. */
export async function finishGuidedSession(profileId: number, input: GuidedFinishInput): Promise<GuidedSession> {
  const db = getDb()
  const row = requireActive(profileId)
  const summary = readSummary(row)

  // Cenário: a rubrica do roleplay (conteúdo × língua) é produzida antes do
  // fechamento e vai junto na recapitulação da sessão.
  let scenario: ScenarioFeedbackView | null = null
  if (summary.isScenario && summary.conversationId) {
    try {
      scenario = await finishScenarioRun(profileId, summary.conversationId)
    } catch (error) {
      console.warn('[guided] rubrica de cenário indisponível:', errorMessage(error))
    }
  }

  const corrections: Correction[] = summary.conversationId
    ? db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, summary.conversationId))
        .all()
        .flatMap((message) => parseCorrections(message.corrections))
    : []

  const practice = input.practice ?? summary.practice
  const reviewDone = input.reviewDone ?? summary.review.done

  const recap = buildRecap(profileId, corrections, { reviewDone, practice, scenario })

  if (summary.conversationId) closeConversation(profileId, summary.conversationId)

  const now = Date.now()
  db.update(schema.studySessions)
    .set({
      endedAt: now,
      summary: JSON.stringify({ ...summary, step: 'recap', review: { ...summary.review, done: reviewDone }, practice, recap })
    })
    .where(eq(schema.studySessions.id, row.id))
    .run()

  // M5: o fim de uma sessão guiada é o gatilho natural do aquecimento ocioso —
  // é aqui que o app sabe qual lição vem depois.
  emitStudentEvent('lesson-finished', summary.lessonId ? String(summary.lessonId) : undefined)

  return {
    id: row.id,
    step: 'recap',
    lessonId: summary.lessonId,
    lessonTitle: summary.lessonTitle,
    conversationId: summary.conversationId,
    review: { ...summary.review, done: reviewDone },
    practice,
    startedAt: row.startedAt,
    recap,
    isScenario: summary.isScenario ?? false
  }
}

export function abandonGuidedSession(profileId: number): void {
  const row = getDb()
    .select()
    .from(schema.studySessions)
    .where(
      and(
        eq(schema.studySessions.profileId, profileId),
        eq(schema.studySessions.kind, 'guided'),
        isNull(schema.studySessions.endedAt)
      )
    )
    .orderBy(desc(schema.studySessions.id))
    .limit(1)
    .get()

  if (!row) return

  getDb()
    .update(schema.studySessions)
    .set({ endedAt: Date.now(), summary: JSON.stringify({ ...readSummary(row), abandoned: true }) })
    .where(eq(schema.studySessions.id, row.id))
    .run()
}

function requireActive(profileId: number): SessionRow {
  const row = getDb()
    .select()
    .from(schema.studySessions)
    .where(
      and(
        eq(schema.studySessions.profileId, profileId),
        eq(schema.studySessions.kind, 'guided'),
        isNull(schema.studySessions.endedAt)
      )
    )
    .orderBy(desc(schema.studySessions.id))
    .limit(1)
    .get()

  if (!row) throw new Error('Nenhuma sessão guiada em andamento.')
  return row
}

function parseCorrections(json: string | null): Correction[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as Correction[]) : []
  } catch {
    return []
  }
}
