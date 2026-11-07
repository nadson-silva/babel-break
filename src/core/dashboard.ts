/**
 * Painel de Progresso (M5) — aritmética pura do dashboard.
 *
 * O processo main só busca linhas e chama estas funções; tudo aqui é determinístico
 * e testável sem banco. A regra de produto que mora neste arquivo é a do plano §11:
 * **frequência livre, sem streak**. O app conta *dias com prática* e tempo total —
 * nunca "dias seguidos", que criaria quebra, culpa e meta expirada.
 */
import type { DashboardActivityDay, DashboardTime, StudyKind } from '../shared/types'

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Sessão aberta e esquecida não é duas horas de estudo. Acima disto, a linha é
 * tratada como aba abandonada e o tempo é creditado só até o teto.
 */
export const SESSION_CAP_MINUTES = 90

export interface SessionRow {
  kind: StudyKind
  startedAt: number
  endedAt: number | null
}

export interface DayInput {
  /** Dia-âncora do evento (para sessões, o fim). */
  at: number
  minutes: number
}

/** 'aaaa-mm-dd' no fuso local — o mesmo dia que o aluno viu no relógio. */
export function dayKey(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Duração de uma sessão em minutos: 0 se ainda aberta, teto em `capMinutes`. */
export function minutesOf(session: SessionRow, capMinutes = SESSION_CAP_MINUTES): number {
  if (session.endedAt == null) return 0
  const raw = (session.endedAt - session.startedAt) / 60000
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.min(raw, capMinutes)
}

export function timeByKind(sessions: SessionRow[], capMinutes = SESSION_CAP_MINUTES): {
  kind: StudyKind
  minutes: number
  sessions: number
}[] {
  const kinds: StudyKind[] = ['lesson', 'conversation', 'guided', 'review']
  const buckets = new Map<StudyKind, { minutes: number; sessions: number }>()

  for (const session of sessions) {
    const minutes = minutesOf(session, capMinutes)
    const entry = buckets.get(session.kind) ?? { minutes: 0, sessions: 0 }
    entry.minutes += minutes
    // Uma sessão aberta continua sendo prática registrada (o aluno esteve ali),
    // só não contribui tempo — por isso counting é separado do tempo.
    entry.sessions += 1
    buckets.set(session.kind, entry)
  }

  return kinds
    .filter((kind) => buckets.has(kind))
    .map((kind) => ({ kind, ...buckets.get(kind)! }))
    .sort((a, b) => b.minutes - a.minutes || a.kind.localeCompare(b.kind))
}

/** Dias de calendário entre dois timestamps (mesma "virada de dia" do aluno). */
export function calendarDaysBetween(from: number, to: number): number {
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS))
}

/** Média honesta: [] → null (a UI diz "sem dados ainda", não "0%"). */
export function average(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return null
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

export function roundedAverage(values: number[], digits = 2): number | null {
  const mean = average(values)
  if (mean == null) return null
  const factor = 10 ** digits
  return Math.round(mean * factor) / factor
}

/**
 * Taxa de acerto do SRS: conta como "lembrou" qualquer nota acima de "de novo"
 * (rating 1 = Again nas notas do FSRS). Só olha a janela de `windowDays`.
 */
export function passRateFromReviews(
  reviews: Array<{ rating: number; reviewedAt: number }>,
  windowDays = 30,
  now = Date.now()
): { rate: number | null; count: number } {
  const from = now - windowDays * DAY_MS
  const recent = reviews.filter((review) => review.reviewedAt >= from)
  if (recent.length === 0) return { rate: null, count: 0 }
  const remembered = recent.filter((review) => review.rating >= 2).length
  return { rate: remembered / recent.length, count: recent.length }
}

/** Percentual arredondado para exibição; null vira null (a UI mostra '—'). */
export function toPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 100)
}

/**
 * Série dos últimos `days` dias (incluindo hoje), zerada nos dias sem prática —
 * é isso que faz o gráfico contar "você apareceu 4 dias este mês" em vez de
 * sugerir que os outros 26 foram falha.
 */
export function buildDayBuckets(input: {
  minutes: DayInput[]
  exerciseTimes: number[]
  reviewTimes: number[]
  now: number
  days?: number
}): DashboardActivityDay[] {
  const days = input.days ?? 30
  const buckets = new Map<string, DashboardActivityDay>()

  const touch = (at: number): DashboardActivityDay | null => {
    const day = dayKey(at)
    if (!day) return null
    const existing = buckets.get(day)
    if (existing) return existing
    const created: DashboardActivityDay = { day, minutes: 0, exercises: 0, reviews: 0 }
    buckets.set(day, created)
    return created
  }

  for (const entry of input.minutes) {
    const bucket = touch(entry.at)
    if (bucket) bucket.minutes += entry.minutes
  }
  for (const at of input.exerciseTimes) {
    const bucket = touch(at)
    if (bucket) bucket.exercises += 1
  }
  for (const at of input.reviewTimes) {
    const bucket = touch(at)
    if (bucket) bucket.reviews += 1
  }

  const window: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    window.push(dayKey(input.now - offset * DAY_MS))
  }

  return window.map((day) => {
    const bucket = buckets.get(day)
    return {
      day,
      minutes: bucket ? Math.round(bucket.minutes) : 0,
      exercises: bucket?.exercises ?? 0,
      reviews: bucket?.reviews ?? 0
    }
  })
}

export interface TimeSummaryInput {
  sessions: SessionRow[]
  exerciseTimes: number[]
  reviewTimes: number[]
  conversationTimes: number[]
  now: number
  windowDays?: number
}

/**
 * O bloco de tempo do dashboard: total, últimos 7/30 dias, dias com prática e
 * "há quantos dias você não aparece" — informação, sem cobrança.
 */
export function summarizeTime(input: TimeSummaryInput): DashboardTime {
  const now = input.now
  const windowDays = input.windowDays ?? 30

  const closed = input.sessions.filter((session) => session.endedAt != null)
  const minutes = closed.map((session) => ({ at: session.endedAt as number, minutes: minutesOf(session) }))

  const perDay = buildDayBuckets({
    minutes,
    exerciseTimes: input.exerciseTimes,
    reviewTimes: input.reviewTimes,
    now,
    days: windowDays
  })

  const activityDays = new Set<string>()
  for (const at of [
    ...closed.map((session) => session.endedAt as number),
    ...input.exerciseTimes,
    ...input.reviewTimes,
    ...input.conversationTimes
  ]) {
    const day = dayKey(at)
    if (day) activityDays.add(day)
  }

  const allStamps = [
    ...input.sessions.map((session) => session.startedAt),
    ...closed.map((session) => session.endedAt as number),
    ...input.exerciseTimes,
    ...input.reviewTimes,
    ...input.conversationTimes
  ].filter((value) => Number.isFinite(value) && value > 0)

  const lastActivityAt = allStamps.length > 0 ? Math.max(...allStamps) : null

  const within = (days: number): number => {
    const from = now - days * DAY_MS
    return minutes
      .filter((entry) => entry.at >= from)
      .reduce((sum, entry) => sum + entry.minutes, 0)
  }

  return {
    totalMinutes: Math.round(minutes.reduce((sum, entry) => sum + entry.minutes, 0)),
    last7DaysMinutes: Math.round(within(7)),
    last30DaysMinutes: Math.round(within(30)),
    practiceDays: activityDays.size,
    daysSinceLastActivity:
      lastActivityAt == null ? null : calendarDaysBetween(lastActivityAt, now),
    lastActivityAt,
    perDay,
    byKind: timeByKind(input.sessions)
  }
}
