import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { CardView, ReviewRating } from '../../../shared/types'
import { t } from '../i18n/pt-BR'

interface ReviewQueueProps {
  cards: CardView[]
  onAnswer: (cardId: number, rating: ReviewRating) => void | Promise<void>
  /** Chamado quando o aluno decide parar antes do fim da fila. */
  onSkip?: () => void
  skipLabel?: string
  /** Mostra a tag do card (usado dentro da sessão guiada). */
  dense?: boolean
}

const RATINGS: ReviewRating[] = ['again', 'hard', 'good', 'easy']

function ratingLabel(rating: ReviewRating): string {
  switch (rating) {
    case 'again':
      return t.review.again
    case 'hard':
      return t.review.hard
    case 'good':
      return t.review.good
    case 'easy':
      return t.review.easy
    default:
      return rating
  }
}

function ratingStyle(rating: ReviewRating): string {
  switch (rating) {
    case 'again':
      return 'border-danger/40 text-danger hover:bg-danger/10'
    case 'hard':
      return 'border-warn/40 text-warn hover:bg-warn/10'
    case 'good':
      return 'border-accent/50 text-accent hover:bg-accent-soft'
    default:
      return 'border-line text-muted hover:border-accent/40 hover:text-ink'
  }
}

function kindLabel(kind: CardView['kind']): string {
  if (kind === 'error') return t.review.kindError
  if (kind === 'phrase') return t.review.kindPhrase
  return t.review.kindVocab
}

export function ReviewQueue({ cards, onAnswer, onSkip, skipLabel, dense }: ReviewQueueProps): JSX.Element {
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)

  const card = cards[index]
  const remaining = cards.length - index

  const intervalByRating = useMemo(() => {
    const map = new Map<ReviewRating, string>()
    for (const interval of card?.intervals ?? []) map.set(interval.rating, interval.label)
    return map
  }, [card])

  async function answer(rating: ReviewRating): Promise<void> {
    if (!card || busy) return
    setBusy(true)
    try {
      await onAnswer(card.id, rating)
      setRevealed(false)
      setIndex((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  if (!card) {
    return (
      <div className="rounded-2xl border border-line bg-panel p-6 text-center">
        <h3 className="text-sm font-semibold">{t.review.doneTitle}</h3>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">{t.review.doneBody}</p>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90"
          >
            {skipLabel ?? t.common.back}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border border-line bg-panel ${dense ? 'p-4' : 'p-6'}`}>
      <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-faint">
        <span>
          {kindLabel(card.kind)}
          {card.tag ? ` · ${card.tag}` : ''}
        </span>
        <span>{t.review.remaining.replace('{count}', String(remaining))}</span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-base font-medium leading-relaxed text-ink">{card.front}</p>
      {card.hint && <p className="mt-2 text-xs text-muted">{card.hint}</p>}

      {revealed ? (
        <div className="mt-4 space-y-4">
          <div className="whitespace-pre-wrap rounded-xl bg-panel-2 px-4 py-3 text-sm leading-relaxed text-ink">
            {card.back}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATINGS.map((rating) => (
              <button
                key={rating}
                type="button"
                disabled={busy}
                onClick={() => void answer(rating)}
                className={`rounded-xl border bg-panel px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-50 ${ratingStyle(rating)}`}
              >
                {ratingLabel(rating)}
                <span className="mt-0.5 block text-[10px] font-normal text-faint">
                  {intervalByRating.get(rating) ?? '—'}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5 flex items-center justify-between gap-3">
          {onSkip ? (
            <button
              type="button"
              onClick={onSkip}
              className="text-xs text-muted underline underline-offset-2 hover:text-ink"
            >
              {skipLabel ?? t.common.skip}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90"
          >
            {t.review.showAnswer}
          </button>
        </div>
      )}
    </div>
  )
}
