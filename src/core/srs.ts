/**
 * SRS em TS puro: templates determinísticos de card + agendamento FSRS.
 *
 * Cards nascem de vocabulário de lição e de erros do caderno, quase sempre por
 * template (sem gastar token). O agendamento usa `ts-fsrs`, e o estado do
 * algoritmo é guardado serializado no banco — as colunas espelhadas (due,
 * stability, difficulty, reps, lapses, state) servem só para ordenar em SQL.
 */
import { Rating, State, createEmptyCard, fsrs, type Card, type Grade } from 'ts-fsrs'
import type { PromptLocale } from './languages'
import { DEFAULT_LOCALE } from './prompts'

export type CardKind = 'vocab' | 'phrase' | 'error'

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface CardPayload {
  kind: CardKind
  /** O que aparece na frente do card. */
  front: string
  /** O que aparece no verso. */
  back: string
  /** Instrução na língua nativa do aluno sobre o que fazer com o card. */
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
  lessonId?: number | null,
  locale: PromptLocale = DEFAULT_LOCALE
): CardPayload {
  const cloze = clozeFromExample(item.example, item.term, locale.target.tokenization)

  return {
    kind: 'vocab',
    front: cloze?.blanked ?? `${item.term} — ${item.translation}`,
    back: `${item.term} · ${item.translation}${cloze ? `\n${item.example}` : ''}`,
    hint: cloze ? clozeHint(item.translation) : `Diga o termo em ${locale.targetName}.`,
    term: item.term,
    translation: item.translation,
    example: item.example,
    lessonId
  }
}

/**
 * Um cloze só é respondível se o aluno souber QUAL palavra a atividade espera —
 * "It is a ___ situation" aceita dezenas de respostas. A dica de sempre é a
 * tradução do termo.
 */
function clozeHint(translation: string): string {
  return `Complete a frase com a palavra que significa “${translation}”.`
}

/**
 * Hint na hora de exibir: cards de cloze antigos foram gravados com a instrução
 * genérica ("complete com a palavra correta") e não dizem qual palavra esperam.
 * Re-derivamos da tradução salva no payload para corrigir também a fila legada,
 * sem migração de banco.
 */
export function cardHint(payload: CardPayload): string | undefined {
  if (payload.kind === 'vocab' && payload.front.includes('___') && payload.translation) {
    return clozeHint(payload.translation)
  }
  return payload.hint
}

export function phraseCard(
  example: string,
  translation: string,
  lessonId?: number | null,
  locale: PromptLocale = DEFAULT_LOCALE
): CardPayload {
  return {
    kind: 'phrase',
    front: `Traduza para o ${locale.targetName}: ${translation}`,
    back: example,
    hint: `Fale ou escreva a frase em ${locale.targetName} antes de virar o card.`,
    lessonId
  }
}

export function errorCard(
  error: {
    original: string
    corrected: string
    tag: string
    note?: string | null
  },
  locale: PromptLocale = DEFAULT_LOCALE
): CardPayload {
  return {
    kind: 'error',
    front: `Corrija a frase: “${error.original}”`,
    back: `${error.corrected}${error.note ? `\n\n${error.note}` : ''}`,
    hint: `Diga a versão correta em ${locale.targetName} antes de virar o card.`,
    tag: error.tag
  }
}

export interface ClozeParts {
  /** Frase de exemplo com o termo substituído por `___`. */
  blanked: string
  /** Texto exato que foi ocultado — é isso que o aluno deve escrever. */
  matched: string
}

/**
 * Cloze determinístico a partir de uma frase de exemplo. Exportado para o
 * fallback montar exercícios de completar já com a dica de tradução.
 * M4: fronteiras de palavra (`\b`) só fazem sentido em escrita separada por
 * espaço; para CJK o match é por substring (o segmentador cuida do resto).
 */
export function clozeFromExample(
  example: string,
  term: string,
  tokenization: 'space' | 'cjk' = 'space'
): ClozeParts | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex =
    tokenization === 'cjk'
      ? new RegExp(escaped, 'i')
      : new RegExp(`\\b${escaped}(s|es|ing|ed)?\\b`, 'i')
  const match = example.match(regex)
  if (!match || match.index === undefined) return null

  return { blanked: example.replace(regex, '___'), matched: match[0] }
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
