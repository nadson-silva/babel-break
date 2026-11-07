/**
 * SRS em TS puro: templates determinísticos de card + agendamento FSRS.
 *
 * Cards nascem de vocabulário de lição e de erros do caderno, quase sempre por
 * template (sem gastar token). O agendamento usa `ts-fsrs`, e o estado do
 * algoritmo é guardado serializado no banco — as colunas espelhadas (due,
 * stability, difficulty, reps, lapses, state) servem só para ordenar em SQL.
 */
import { Rating, State, createEmptyCard, fsrs, type Card, type Grade } from 'ts-fsrs'

export type CardKind = 'vocab' | 'phrase' | 'error'

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface CardPayload {
  kind: CardKind
  /** O que aparece na frente do card. */
  front: string
  /** O que aparece no verso. */
  back: string
  /** Instrução em PT-BR sobre o que fazer com o card. */
  hint?: string
  /** Tag de erro associada (para cards vindos do caderno). */
  tag?: string
  /** Vocabulário estruturado, para o aluno refazer o cloze. */
  term?: string
  translation?: string
  example?: string
  lessonId?: number | null
}

const RATING_BY_REVIEW: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
}

const scheduler = fsrs()

export function vocabCard(
  item: { term: string; translation: string; example: string },
  lessonId?: number | null
): CardPayload {
  const blanked = blankTerm(item.example, item.term)

  return {
    kind: 'vocab',
    front: blanked ?? `${item.term} — ${item.translation}`,
    back: `${item.term} · ${item.translation}${blanked ? `\n${item.example}` : ''}`,
    hint: blanked ? 'Complete a frase com a palavra correta.' : 'Diga o termo em inglês.',
    term: item.term,
    translation: item.translation,
    example: item.example,
    lessonId
  }
}

export function phraseCard(example: string, translation: string, lessonId?: number | null): CardPayload {
  return {
    kind: 'phrase',
    front: `Traduza para o inglês: ${translation}`,
    back: example,
    hint: 'Fale ou escreva a frase em inglês antes de virar o card.',
    lessonId
  }
}

export function errorCard(error: {
  original: string
  corrected: string
  tag: string
  note?: string | null
}): CardPayload {
  return {
    kind: 'error',
    front: `Corrija a frase: “${error.original}”`,
    back: `${error.corrected}${error.note ? `\n\n${error.note}` : ''}`,
    hint: 'Diga a versão correta em voz alta antes de virar o card.',
    tag: error.tag
  }
}

/** Substitui o termo na frase de exemplo por ___ (cloze determinístico). */
function blankTerm(example: string, term: string): string | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`\\b${escaped}(s|es|ing|ed)?\\b`, 'i')
  if (!regex.test(example)) return null
  return example.replace(regex, '___')
}

export function cardDedupeKey(payload: CardPayload): string {
  const basis =
    payload.kind === 'vocab'
      ? `vocab:${payload.term?.toLowerCase() ?? payload.front.toLowerCase()}`
      : payload.kind === 'error'
        ? `error:${payload.tag?.toLowerCase() ?? 'tag'}:${payload.front.toLowerCase()}`
        : `phrase:${payload.front.toLowerCase()}`

  return basis.slice(0, 180)
}

// --- FSRS -------------------------------------------------------------------

export interface StoredSchedule {
  /** JSON serializado do card FSRS. */
  schedule: string
  due: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: CardState
}

export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export function newStateName(state: State): CardState {
  if (state === State.Review) return 'review'
  if (state === State.Relearning) return 'relearning'
  if (state === State.Learning) return 'learning'
  return 'new'
}

function toState(value: CardState | string | number | null | undefined): State {
  const name = typeof value === 'number' ? [State.New, State.Learning, State.Review, State.Relearning][value] : value
  switch (name) {
    case State.Review:
    case 'review':
      return State.Review
    case State.Relearning:
    case 'relearning':
      return State.Relearning
    case State.Learning:
    case 'learning':
      return State.Learning
    default:
      return State.New
  }
}

export function freshSchedule(now = new Date()): Card {
  return createEmptyCard(now)
}

export function serializeSchedule(card: Card): string {
  return JSON.stringify({ ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() ?? null })
}

/** Reconstrói o card FSRS a partir do JSON salvo, tolerando dados antigos. */
export function parseSchedule(json: string | null | undefined, fallbackNow = new Date()): Card {
  if (!json) {
    return createEmptyCard(fallbackNow)
  }

  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const due = typeof raw.due === 'string' || typeof raw.due === 'number' ? new Date(raw.due) : fallbackNow
    const lastReview =
      typeof raw.last_review === 'string' || typeof raw.last_review === 'number'
        ? new Date(raw.last_review)
        : undefined

    return {
      ...(raw as object),
      due: Number.isNaN(due.getTime()) ? fallbackNow : due,
      stability: numberOr(raw.stability, 0),
      difficulty: numberOr(raw.difficulty, 0),
      elapsed_days: numberOr(raw.elapsed_days, 0),
      scheduled_days: numberOr(raw.scheduled_days, 0),
      reps: numberOr(raw.reps, 0),
      lapses: numberOr(raw.lapses, 0),
      learning_steps: numberOr(raw.learning_steps, 0),
      state: toState((raw.state as State | CardState | number | undefined) ?? 'new'),
      last_review: lastReview && !Number.isNaN(lastReview.getTime()) ? lastReview : undefined
    } as Card
  } catch {
    return createEmptyCard(fallbackNow)
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Espelha o card FSRS nas colunas consultáveis da tabela `cards`. */
export function scheduleSnapshot(card: Card): Omit<StoredSchedule, 'schedule'> {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: newStateName(card.state)
  }
}

export function fullSchedule(card: Card): StoredSchedule {
  return { schedule: serializeSchedule(card), ...scheduleSnapshot(card) }
}

export interface ReviewOutcome extends StoredSchedule {
  intervalMs: number
}

/** Aplica uma nota do aluno ao card e devolve o novo estado agendado. */
export function applyRating(json: string | null | undefined, rating: ReviewRating, now = new Date()): ReviewOutcome {
  const card = parseSchedule(json, now)
  const result = scheduler.next(card, now, RATING_BY_REVIEW[rating])
  const next = result.card

  return {
    ...fullSchedule(next),
    intervalMs: Math.max(0, next.due.getTime() - now.getTime())
  }
}

export interface IntervalPreview {
  rating: ReviewRating
  label: string
  minutes: number
}

/**
 * Prévia dos quatro botões ("10 min", "4 dias"), para o aluno decidir
 * com informação. Não grava nada.
 */
export function previewIntervals(json: string | null | undefined, now = new Date()): IntervalPreview[] {
  const card = parseSchedule(json, now)

  try {
    const preview = scheduler.repeat(card, now)

    return (['again', 'hard', 'good', 'easy'] as ReviewRating[]).map((rating) => {
      const next = preview[RATING_BY_REVIEW[rating]].card
      const minutes = Math.max(0, Math.round((next.due.getTime() - now.getTime()) / 60000))
      return { rating, label: formatInterval(minutes), minutes }
    })
  } catch {
    return [
      { rating: 'again', label: 'de novo', minutes: 600 },
      { rating: 'hard', label: 'difícil', minutes: 1440 },
      { rating: 'good', label: 'bom', minutes: 8640 },
      { rating: 'easy', label: 'fácil', minutes: 17280 }
    ]
  }
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h`
  const days = Math.round(minutes / (24 * 60))
  if (days < 31) return `${days} d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} mo`
  return `${(days / 365).toFixed(1).replace('.', ',')} a`
}

/** Texto curto de quando o card vence, para a lista de revisão. */
export function dueLabel(due: number, now = Date.now()): string {
  const minutes = Math.round((due - now) / 60000)
  if (minutes <= 0) return 'agora'
  if (minutes < 60) return `em ${minutes} min`
  if (minutes < 24 * 60) return `em ${Math.round(minutes / 60)} h`
  const days = Math.round(minutes / (24 * 60))
  if (days < 31) return `em ${days} d`
  return `em ${Math.round(days / 30)} mo`
}
