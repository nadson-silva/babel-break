/**
 * Painel de Progresso (M5).
 *
 * É a tela "o que o app aprendeu sobre você": tempo praticado, vocabulário com
 * retenção estimada pelo FSRS, caderno de erros agregado, trilhas com a rubrica
 * separada (tarefa × língua) e a fila de conteúdo ruim que o aluno reportou.
 *
 * A regra do plano (§11) vale aqui mais do que em qualquer outra tela:
 * **frequência livre**. Nada de streak, meta ou dias seguidos — o painel mostra
 * dias com prática e "há quantos dias você não aparece", como informação. Se
 * aparecer culpa no JSX, está errado.
 *
 * A aritmética mora em `core/dashboard.ts` (pura, testável); este arquivo só busca
 * linhas no SQLite e monta o payload.
 */
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { handle } from './ipc-contract'
import type {
  DashboardTrack,
  DashboardView,
  SkillEstimate,
  SkillId,
  StudyKind,
  VocabularyCardView
} from '../shared/types'
import { average, passRateFromReviews, roundedAverage, summarizeTime, toPercent } from '../core/dashboard'
import type { CardPayload } from '../core/srs'
import { cardRetention } from '../core/srs'
import { getDb, getDefaultProfile, schema } from './db'
import { profileView } from './learning'
import { activeTrackViews } from './tracks'
import { reportsSummary } from './reports'
import { cacheStats } from './prewarm'
import { providerStatus } from './provider-status'

const KINDS: StudyKind[] = ['lesson', 'conversation', 'guided', 'review']

function toStudyKind(value: string): StudyKind {
  return (KINDS as string[]).includes(value) ? (value as StudyKind) : 'lesson'
}

function parseCardPayload(json: string): CardPayload | null {
  try {
    return JSON.parse(json) as CardPayload
  } catch {
    return null
  }
}

function skillsOf(profileId: number): SkillEstimate[] {
  return getDb()
    .select()
    .from(schema.skillsState)
    .where(eq(schema.skillsState.profileId, profileId))
    .all()
    .map((row) => ({ skill: row.skill as SkillId, estimate: row.estimate, confidence: row.confidence }))
}

/** Bloco de lições: progresso do currículo + o que já está em cache. */
function lessonBlock(profileId: number): DashboardView['lessons'] {
  const db = getDb()

  const totals = db
    .select({
      total: sql<number>`count(*)`,
      cached: sql<number>`sum(case when ${schema.lessons.content} is not null then 1 else 0 end)`,
      prewarmed: sql<number>`sum(case when ${schema.lessons.prewarmedAt} is not null then 1 else 0 end)`
    })
    .from(schema.lessons)
    .get()

  const progress = db
    .select({ status: schema.lessonProgress.status, score: schema.lessonProgress.score })
    .from(schema.lessonProgress)
    .where(eq(schema.lessonProgress.profileId, profileId))
    .all()

  const completed = progress.filter((row) => row.status === 'completed')

  return {
    completed: completed.length,
    inProgress: progress.filter((row) => row.status === 'in_progress').length,
    total: Number(totals?.total ?? 0),
    averageScore: roundedAverage(
      completed.map((row) => row.score).filter((value): value is number => value != null)
    ),
    cached: Number(totals?.cached ?? 0),
    prewarmed: Number(totals?.prewarmed ?? 0)
  }
}

/** Tempo praticado: sessões fechadas + tentativas + revisões + falas do aluno. */
function timeBlock(profileId: number, now: number): DashboardView['time'] {
  const db = getDb()

  const sessions = db
    .select({
      kind: schema.studySessions.kind,
      startedAt: schema.studySessions.startedAt,
      endedAt: schema.studySessions.endedAt
    })
    .from(schema.studySessions)
    .where(eq(schema.studySessions.profileId, profileId))
    .all()
    .map((row) => ({ kind: toStudyKind(row.kind), startedAt: row.startedAt, endedAt: row.endedAt }))

  // Tentativas chegam até o aluno pelo caminho exercício → lição, e a lição é
  // do perfil por um dos dois donos: unidade do currículo ou trilha de foco.
  const exerciseTimes = db
    .select({ at: schema.attempts.createdAt })
    .from(schema.attempts)
    .innerJoin(schema.exercises, eq(schema.exercises.id, schema.attempts.exerciseId))
    .innerJoin(schema.lessons, eq(schema.lessons.id, schema.exercises.lessonId))
    .leftJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
    .leftJoin(schema.focusTracks, eq(schema.focusTracks.id, schema.lessons.trackId))
    .where(or(eq(schema.units.profileId, profileId), eq(schema.focusTracks.profileId, profileId)))
    .all()
    .map((row) => row.at)

  const reviewTimes = db
    .select({ at: schema.reviews.reviewedAt })
    .from(schema.reviews)
    .all()
    .map((row) => row.at)

  // Falas do aluno nas conversas: prática sem exercício nem sessão fechada.
  const conversationTimes = db
    .select({ at: schema.messages.createdAt })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(and(eq(schema.conversations.profileId, profileId), eq(schema.messages.role, 'user')))
    .all()
    .map((row) => row.at)

  return summarizeTime({ sessions, exerciseTimes, reviewTimes, conversationTimes, now })
}

function vocabularyBlock(profileId: number, now: number): DashboardView['vocabulary'] {
  const db = getDb()

  const counts = db
    .select({
      total: sql<number>`count(*)`,
      fresh: sql<number>`sum(case when ${schema.cards.state} = 'new' then 1 else 0 end)`,
      learning: sql<number>`sum(case when ${schema.cards.state} in ('learning','relearning') then 1 else 0 end)`,
      mastered: sql<number>`sum(case when ${schema.cards.state} = 'review' then 1 else 0 end)`,
      due: sql<number>`sum(case when ${schema.cards.due} <= ${now} then 1 else 0 end)`
    })
    .from(schema.cards)
    .where(eq(schema.cards.profileId, profileId))
    .get()

  const pass = passRateFromReviews(
    db
      .select({ rating: schema.reviews.rating, reviewedAt: schema.reviews.reviewedAt })
      .from(schema.reviews)
      .innerJoin(schema.cards, eq(schema.cards.id, schema.reviews.cardId))
      .where(eq(schema.cards.profileId, profileId))
      .all(),
    30,
    now
  )

  const strongest: VocabularyCardView[] = db
    .select({
      kind: schema.cards.kind,
      content: schema.cards.content,
      schedule: schema.cards.schedule,
      reps: schema.cards.reps,
      lapses: schema.cards.lapses,
      stability: schema.cards.stability
    })
    .from(schema.cards)
    .where(and(eq(schema.cards.profileId, profileId), sql`${schema.cards.reps} > 0`))
    .orderBy(desc(schema.cards.stability))
    .limit(40)
    .all()
    .map((row) => {
      const payload = parseCardPayload(row.content)
      return {
        term: payload?.term ?? payload?.front ?? row.kind,
        translation: payload?.translation ?? payload?.back?.split('\n')[0] ?? '',
        reps: row.reps,
        lapses: row.lapses,
        stability: row.stability ?? 0,
        retention: cardRetention(row.schedule, new Date(now))
      }
    })
    .filter((entry) => entry.retention != null && entry.term.trim().length > 0)
    .sort((a, b) => (b.retention ?? 0) - (a.retention ?? 0))
    .slice(0, 8)

  return {
    total: Number(counts?.total ?? 0),
    fresh: Number(counts?.fresh ?? 0),
    learning: Number(counts?.learning ?? 0),
    mastered: Number(counts?.mastered ?? 0),
    due: Number(counts?.due ?? 0),
    reviews30Days: pass.count,
    passRate: toPercent(pass.rate),
    strongest
  }
}

function errorBlock(profileId: number): DashboardView['errors'] {
  const db = getDb()

  const rows = db
    .select({
      tag: schema.errors.tag,
      occurrences: schema.errors.occurrences,
      createdAt: schema.errors.createdAt,
      lastSeenAt: schema.errors.lastSeenAt,
      source: schema.errors.source,
      resolvedAt: schema.errors.resolvedAt,
      disputedAt: schema.errors.disputedAt
    })
    .from(schema.errors)
    .where(eq(schema.errors.profileId, profileId))
    .all()

  const byTag = new Map<string, { occurrences: number; lastSeenAt: number; disputed: boolean }>()
  for (const row of rows) {
    const entry = byTag.get(row.tag) ?? { occurrences: 0, lastSeenAt: 0, disputed: false }
    entry.occurrences += row.occurrences
    entry.lastSeenAt = Math.max(entry.lastSeenAt, row.lastSeenAt || row.createdAt)
    if (row.disputedAt != null && row.resolvedAt == null) entry.disputed = true
    byTag.set(row.tag, entry)
  }

  const resolved = rows.filter((row) => row.resolvedAt != null)

  const bankHits = Number(
    db
      .select({ value: sql<number>`coalesce(sum(${schema.errors.occurrences}), 0)` })
      .from(schema.errors)
      .where(and(eq(schema.errors.profileId, profileId), eq(schema.errors.source, 'bank')))
      .get()?.value ?? 0
  )

  return {
    open: rows.filter((row) => row.resolvedAt == null).length,
    resolved: resolved.length,
    disputed: rows.filter((row) => row.disputedAt != null).length,
    bankHits,
    resolvedRate: rows.length > 0 ? toPercent(resolved.length / rows.length) : null,
    topTags: [...byTag.entries()]
      .map(([tag, entry]) => ({ tag, occurrences: entry.occurrences, lastSeenAt: entry.lastSeenAt, disputed: entry.disputed }))
      .sort(
        (a, b) =>
          Number(a.disputed) - Number(b.disputed) ||
          b.occurrences - a.occurrences ||
          b.lastSeenAt - a.lastSeenAt
      )
      .slice(0, 10)
  }
}

/** Trilhas: progresso próprio + média das duas rubricas (tarefa × língua). */
function trackBlock(profileId: number): DashboardTrack[] {
  const db = getDb()

  const runs = db
    .select({
      trackId: schema.lessons.trackId,
      contentScore: schema.scenarioRuns.contentScore,
      languageScore: schema.scenarioRuns.languageScore
    })
    .from(schema.scenarioRuns)
    .leftJoin(schema.lessons, eq(schema.lessons.id, schema.scenarioRuns.lessonId))
    .all()

  const lastOpened = db
    .select({ lessonId: schema.lessonProgress.lessonId, lastOpenedAt: schema.lessonProgress.lastOpenedAt })
    .from(schema.lessonProgress)
    .where(eq(schema.lessonProgress.profileId, profileId))
    .all()

  return activeTrackViews(profileId).map((track) => {
    const lessonIds = new Set(track.lessons.map((lesson) => lesson.id))
    const trackRuns = runs.filter((run) => run.trackId === track.id)
    const opened = lastOpened
      .filter((row) => lessonIds.has(row.lessonId))
      .map((row) => row.lastOpenedAt ?? 0)

    return {
      id: track.id,
      title: track.title,
      completed: track.completedCount,
      total: track.totalCount,
      scenarios: trackRuns.length,
      avgContentScore: toPercent(
        average(trackRuns.map((run) => run.contentScore).filter((value): value is number => value != null))
      ),
      avgLanguageScore: toPercent(
        average(trackRuns.map((run) => run.languageScore).filter((value): value is number => value != null))
      ),
      lastActivityAt: opened.length > 0 ? Math.max(...opened) : track.approvedAt
    }
  })
}

function scenarioBlock(): DashboardView['scenarios'] {
  const runs = getDb()
    .select({ contentScore: schema.scenarioRuns.contentScore, languageScore: schema.scenarioRuns.languageScore })
    .from(schema.scenarioRuns)
    .all()

  return {
    runs: runs.length,
    avgContentScore: toPercent(
      average(runs.map((row) => row.contentScore).filter((value): value is number => value != null))
    ),
    avgLanguageScore: toPercent(
      average(runs.map((row) => row.languageScore).filter((value): value is number => value != null))
    )
  }
}

export function dashboardView(now = Date.now()): DashboardView {
  const profile = getDefaultProfile()

  return {
    generatedAt: now,
    profile: profileView(profile),
    skills: skillsOf(profile.id),
    lessons: lessonBlock(profile.id),
    time: timeBlock(profile.id, now),
    vocabulary: vocabularyBlock(profile.id, now),
    errors: errorBlock(profile.id),
    tracks: trackBlock(profile.id),
    scenarios: scenarioBlock(),
    reports: reportsSummary(profile.id, 8),
    cache: cacheStats(),
    ai: providerStatus()
  }
}

export function registerDashboardIpc(): void {
  handle('dashboard:get', (): DashboardView => dashboardView())
}
