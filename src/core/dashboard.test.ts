/**
 * Painel de Progresso (M5) — a aritmética do dashboard é pura de propósito:
 * é aqui que mora a decisão de produto "frequência livre, sem streak".
 */
import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  SESSION_CAP_MINUTES,
  average,
  buildDayBuckets,
  dayKey,
  minutesOf,
  passRateFromReviews,
  roundedAverage,
  summarizeTime,
  timeByKind,
  toPercent
} from './dashboard'

const NOON = new Date(2026, 10, 7, 12, 0, 0).getTime()

function dayAgo(days: number, at = NOON): number {
  return at - days * DAY_MS
}

describe('dia local', () => {
  it('dayKey usa o fuso do aluno, não UTC', () => {
    expect(dayKey(NOON)).toBe('2026-11-07')
    expect(dayKey(new Date(2026, 0, 5, 9).getTime())).toBe('2026-01-05')
  })

  it('sem timestamp não inventa dia', () => {
    expect(dayKey(null)).toBe('')
    expect(dayKey(Number.NaN)).toBe('')
  })
})

describe('tempo de sessão', () => {
  it('sessão aberta não conta tempo', () => {
    expect(minutesOf({ kind: 'lesson', startedAt: NOON, endedAt: null })).toBe(0)
  })

  it('mede a duração em minutos', () => {
    expect(minutesOf({ kind: 'lesson', startedAt: NOON, endedAt: NOON + 12 * 60_000 })).toBe(12)
  })

  it('aba esquecida não vira 6 horas de estudo', () => {
    const abandoned = minutesOf({ kind: 'conversation', startedAt: NOON, endedAt: NOON + 6 * 60 * 60_000 })
    expect(abandoned).toBe(SESSION_CAP_MINUTES)
  })

  it('relógio backwards não produz tempo negativo', () => {
    expect(minutesOf({ kind: 'lesson', startedAt: NOON, endedAt: NOON - 60_000 })).toBe(0)
  })

  it('agrupa por tipo de prática e ignora kinds desconhecidos no caminho', () => {
    const byKind = timeByKind([
      { kind: 'lesson', startedAt: NOON, endedAt: NOON + 30 * 60_000 },
      { kind: 'lesson', startedAt: NOON, endedAt: NOON + 10 * 60_000 },
      { kind: 'guided', startedAt: NOON, endedAt: NOON + 20 * 60_000 }
    ])

    expect(byKind[0]).toEqual({ kind: 'lesson', minutes: 40, sessions: 2 })
    expect(byKind.find((entry) => entry.kind === 'guided')?.minutes).toBe(20)
  })
})

describe('série diária', () => {
  it('preenche os dias sem prática com zero (buraco não é falha)', () => {
    const buckets = buildDayBuckets({
      minutes: [{ at: NOON, minutes: 25 }],
      exerciseTimes: [NOON, NOON],
      reviewTimes: [],
      now: NOON,
      days: 5
    })

    expect(buckets).toHaveLength(5)
    expect(buckets[4]).toEqual({ day: dayKey(NOON), minutes: 25, exercises: 2, reviews: 0 })
    expect(buckets[0].minutes).toBe(0)
  })

  it('soma minutos do mesmo dia', () => {
    const buckets = buildDayBuckets({
      minutes: [
        { at: NOON, minutes: 10 },
        { at: NOON + 3 * 60_000, minutes: 15 }
      ],
      exerciseTimes: [],
      reviewTimes: [NOON],
      now: NOON,
      days: 2
    })

    expect(buckets[1].minutes).toBe(25)
    expect(buckets[1].reviews).toBe(1)
  })
})

describe('resumo de tempo', () => {
  const input = {
    sessions: [
      { kind: 'lesson' as const, startedAt: dayAgo(0), endedAt: dayAgo(0) + 20 * 60_000 },
      { kind: 'conversation' as const, startedAt: dayAgo(3), endedAt: dayAgo(3) + 15 * 60_000 },
      { kind: 'guided' as const, startedAt: dayAgo(10), endedAt: null }
    ],
    exerciseTimes: [dayAgo(3), dayAgo(3)],
    reviewTimes: [dayAgo(1)],
    conversationTimes: [dayAgo(1)],
    now: NOON
  }

  const summary = summarizeTime(input)

  it('soma o total e as janelas de 7 e 30 dias', () => {
    expect(summary.totalMinutes).toBe(35)
    expect(summary.last7DaysMinutes).toBe(35)
    expect(summary.last30DaysMinutes).toBe(35)
  })

  it('conta dias com prática em vez de streak', () => {
    // hoje (aula, revisão e conversa), ontem (revisão + conversa) e 3 dias atrás:
    // três dias de presença, com buraco no meio — e nada aqui "quebra".
    expect(summary.practiceDays).toBe(3)
    expect(summary.daysSinceLastActivity).toBe(0)
  })

  it('diz há quanto tempo o aluno não aparece', () => {
    const idle = summarizeTime({
      ...input,
      sessions: [{ kind: 'lesson', startedAt: dayAgo(5), endedAt: dayAgo(5) + 60_000 }],
      exerciseTimes: [],
      reviewTimes: [],
      conversationTimes: []
    })

    expect(idle.daysSinceLastActivity).toBe(5)
    expect(idle.practiceDays).toBe(1)
  })

  it('prática nenhuma não vira número negativo nem culpa', () => {
    const empty = summarizeTime({
      sessions: [],
      exerciseTimes: [],
      reviewTimes: [],
      conversationTimes: [],
      now: NOON
    })

    expect(empty.totalMinutes).toBe(0)
    expect(empty.practiceDays).toBe(0)
    expect(empty.lastActivityAt).toBeNull()
    expect(empty.daysSinceLastActivity).toBeNull()
    expect(empty.perDay).toHaveLength(30)
  })
})

describe('estatísticas', () => {
  it('média de lista vazia é null, não 0', () => {
    expect(average([])).toBeNull()
    expect(roundedAverage([])).toBeNull()
    expect(toPercent(null)).toBeNull()
  })

  it('média arredondada para exibição', () => {
    expect(roundedAverage([0.5, 1, 1.25])).toBeCloseTo(0.92, 2)
    expect(toPercent(0.846)).toBe(85)
  })

  it('retenção: nota "de novo" não conta como lembrou', () => {
    const reviews = [
      { rating: 1, reviewedAt: NOON },
      { rating: 3, reviewedAt: NOON },
      { rating: 4, reviewedAt: NOON },
      { rating: 2, reviewedAt: dayAgo(90) } // fora da janela de 30 dias
    ]

    const pass = passRateFromReviews(reviews, 30, NOON)
    expect(pass.count).toBe(3)
    expect(pass.rate).toBeCloseTo(2 / 3, 2)
  })

  it('sem revisão na janela devolve null (a UI diz "sem dados")', () => {
    expect(passRateFromReviews([], 30, NOON)).toEqual({ rate: null, count: 0 })
  })
})
