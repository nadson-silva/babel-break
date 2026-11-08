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
import { runtimeTextForLocale, localizeDecimal, runtimeText } from './runtime-text'

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

/**
 * V2 (D11): retenção pedida ao FSRS é decisão do aluno, não constante do pacote.
 *
 * 0,9 é o padrão do algoritmo; quem tem muita fila costuma baixar para 0,85 e
 * receber intervalos maiores. O scheduler é memoizado por valor — criar um `fsrs()`
 * por chamada custaria alocação em toda revisão.
 */
export const DEFAULT_REQUEST_RETENTION = 0.9
export const MIN_REQUEST_RETENTION = 0.7
export const MAX_REQUEST_RETENTION = 0.97

const schedulers = new Map<number, ReturnType<typeof fsrs>>()

export function normalizeRetention(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_REQUEST_RETENTION
  return Math.min(MAX_REQUEST_RETENTION, Math.max(MIN_REQUEST_RETENTION, value))
}

function schedulerFor(requestRetention: number): ReturnType<typeof fsrs> {
  const retention = normalizeRetention(requestRetention)
  const cached = schedulers.get(retention)
  if (cached) return cached
  const created = fsrs({ request_retention: retention })
  schedulers.set(retention, created)
  return created
}

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
    hint: cloze
      ? clozeHint(item.translation, locale)
      : runtimeTextForLocale(locale, 'card.vocabHint', { target: locale.targetName }),
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
function clozeHint(translation: string, locale: PromptLocale = DEFAULT_LOCALE): string {
  return runtimeTextForLocale(locale, 'card.clozeHint', { translation })
}

/**
 * Hint na hora de exibir: cards de cloze antigos foram gravados com a instrução
 * genérica ("complete com a palavra correta") e não dizem qual palavra esperam.
 * Re-derivamos da tradução salva no payload para corrigir também a fila legada,
 * sem migração de banco.
 */
export function cardHint(payload: CardPayload, locale: PromptLocale = DEFAULT_LOCALE): string | undefined {
  if (payload.kind === 'vocab' && payload.front.includes('___') && payload.translation) {
    return clozeHint(payload.translation, locale)
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
    front: runtimeTextForLocale(locale, 'card.phraseFront', {
      target: locale.targetName,
      native: translation
    }),
    back: example,
    hint: runtimeTextForLocale(locale, 'card.phraseHint', { target: locale.targetName }),
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
    front: runtimeTextForLocale(locale, 'card.errorFront', { original: error.original }),
    back: `${error.corrected}${error.note ? `\n\n${error.note}` : ''}`,
    hint: runtimeTextForLocale(locale, 'card.errorHint', { target: locale.targetName }),
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

/** Nome do estado para as colunas espelhadas do SQLite (fonte: o enum, não string). */
export function newStateName(state: State): CardState {
  const name = stateNameOf(state)
  return name === 'review' || name === 'relearning' || name === 'learning' ? name : 'new'
}

/**
 * V2 (D11): estado FSRS lido sem suposição de ordem. A versão anterior indexava
 * um array posicional (`[New, Learning, Review, Relearning][n]`), que quebra no
 * dia que o pacote reordena ou insere um estado. Aqui o nome vem do próprio enum.
 */
// `State`/`Rating` do ts-fsrs são objetos `{ New: 0, Learning: 1, … }` sem
// mapa reverso: os nomes vêm das chaves cujo valor é número.
const STATE_NAMES_BY_VALUE = new Map<number, string>(
  Object.entries(State).flatMap(([key, value]) =>
    typeof value === 'number' ? ([[value, key.toLowerCase()]] as [number, string][]) : []
  )
)

const RATING_VALUES = RATING_BY_NAME()

function RATING_BY_NAME(): Record<ReviewRating, Grade> {
  return {
    again: Rating.Again,
    hard: Rating.Hard,
    good: Rating.Good,
    easy: Rating.Easy
  }
}

/** Valor numérico da nota (mesma fonte do `RATING_BY_REVIEW`, sem número solto). */
export function ratingValue(rating: ReviewRating): number {
  return RATING_VALUES[rating]
}

function stateNameOf(value: unknown): string | null {
  if (typeof value === 'number') return STATE_NAMES_BY_VALUE.get(value) ?? null
  if (typeof value === 'string') return value.toLowerCase()
  return null
}

/** Reconstrói o estado do FSRS a partir do que está salvo (número ou nome). */
function toState(value: CardState | string | number | null | undefined): State {
  switch (stateNameOf(value)) {
    case 'review':
      return State.Review
    case 'relearning':
      return State.Relearning
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
export function applyRating(
  json: string | null | undefined,
  rating: ReviewRating,
  now = new Date(),
  requestRetention = DEFAULT_REQUEST_RETENTION
): ReviewOutcome {
  const card = parseSchedule(json, now)
  const result = schedulerFor(requestRetention).next(card, now, RATING_BY_REVIEW[rating])
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
export function previewIntervals(
  json: string | null | undefined,
  now = new Date(),
  lang: string | null | undefined = 'pt-BR',
  requestRetention = DEFAULT_REQUEST_RETENTION
): IntervalPreview[] {
  const card = parseSchedule(json, now)

  try {
    const preview = schedulerFor(requestRetention).repeat(card, now)

    return (['again', 'hard', 'good', 'easy'] as ReviewRating[]).map((rating) => {
      const next = preview[RATING_BY_REVIEW[rating]].card
      const minutes = Math.max(0, Math.round((next.due.getTime() - now.getTime()) / 60000))
      return { rating, label: formatInterval(minutes, lang), minutes }
    })
  } catch {
    return [
      { rating: 'again', label: runtimeText(lang, 'rating.again'), minutes: 600 },
      { rating: 'hard', label: runtimeText(lang, 'rating.hard'), minutes: 1440 },
      { rating: 'good', label: runtimeText(lang, 'rating.good'), minutes: 8640 },
      { rating: 'easy', label: runtimeText(lang, 'rating.easy'), minutes: 17280 }
    ]
  }
}

/** Tempo até a próxima revisão em unidades curtas ('4 d', '2 h'), no idioma do aluno. */
export function formatInterval(minutes: number, lang: string | null | undefined = 'pt-BR'): string {
  if (minutes < 60) return runtimeText(lang, 'unit.minutes', { value: Math.max(1, minutes) })
  if (minutes < 24 * 60) return runtimeText(lang, 'unit.hours', { value: Math.round(minutes / 60) })
  const days = Math.round(minutes / (24 * 60))
  if (days < 31) return runtimeText(lang, 'unit.days', { value: days })
  const months = Math.round(days / 30)
  if (months < 12) return runtimeText(lang, 'unit.months', { value: months })
  return runtimeText(lang, 'unit.years', {
    value: localizeDecimal((days / 365).toFixed(1), lang)
  })
}

/** Texto curto de quando o card vence, para a lista de revisão. */
export function dueLabel(due: number, now = Date.now(), lang: string | null | undefined = 'pt-BR'): string {
  const minutes = Math.round((due - now) / 60000)
  if (minutes <= 0) return runtimeText(lang, 'due.now')
  if (minutes < 60) return relative(lang, runtimeText(lang, 'unit.minutes', { value: minutes }))
  if (minutes < 24 * 60) return relative(lang, runtimeText(lang, 'unit.hours', { value: Math.round(minutes / 60) }))
  const days = Math.round(minutes / (24 * 60))
  if (days < 31) return relative(lang, runtimeText(lang, 'unit.days', { value: days }))
  return relative(lang, runtimeText(lang, 'unit.months', { value: Math.round(days / 30) }))
}

function relative(lang: string | null | undefined, value: string): string {
  return runtimeText(lang, 'due.relative', { value })
}

/**
 * Retenção estimada do card agora (curva de esquecimento do FSRS), usada pelo
 * painel de Progresso. Card novo não tem curva: devolve null, não 0%.
 */
/**
 * Retenção estimada do card (curva do FSRS) com o scheduler da retenção pedida —
 * painel e fila mostram a mesma conta que o agendamento usou.
 */
export function cardRetention(
  json: string | null | undefined,
  now = new Date(),
  requestRetention = DEFAULT_REQUEST_RETENTION
): number | null {
  const card = parseSchedule(json, now)
  if (card.state === State.New || card.reps === 0 || !card.stability) return null
  if (!card.last_review) return null

  try {
    const value = schedulerFor(requestRetention).retrievability(card, now)
    return Number.isFinite(value) && value > 0 ? Math.min(1, Math.max(0, value)) : null
  } catch {
    return null
  }
}
