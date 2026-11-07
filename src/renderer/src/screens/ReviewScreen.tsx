import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { ReviewRating, ReviewState } from '../../../shared/types'
import { t } from '../i18n/pt-BR'
import { ReviewQueue } from '../components/ReviewQueue'

interface ReviewScreenProps {
  /** Aviso para a badge lateral depois de revisar. */
  onChanged?: () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent ? 'text-accent' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

export function ReviewScreen({ onChanged }: ReviewScreenProps): JSX.Element {
  const [state, setState] = useState<ReviewState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const state = await window.api.review.state(20)
      setState(state)
      setError(null)
      onChanged?.()
    } catch (loadError) {
      setError(messageOf(loadError))
    }
  }, [onChanged])

  useEffect(() => {
    void load()
  }, [load])

  async function answer(cardId: number, rating: ReviewRating): Promise<void> {
    try {
      await window.api.review.answer({ cardId, rating })
      await load()
    } catch (answerError) {
      setError(messageOf(answerError))
    }
  }

  async function fromErrors(): Promise<void> {
    setGenerating(true)
    try {
      const created = await window.api.review.fromErrors()
      setNotice(
        created > 0
          ? t.review.created.replace('{count}', String(created))
          : t.notebook.emptyBody
      )
      await load()
    } catch (createError) {
      setError(messageOf(createError))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div>
          <h1 className="text-base font-semibold">{t.review.title}</h1>
          <p className="text-xs text-muted">{t.review.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void fromErrors()}
          disabled={generating}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-50"
        >
          {t.review.fromErrors}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-5">
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
              {error}
            </div>
          )}

          {notice && (
            <div className="rounded-xl border border-accent/40 bg-accent-soft/40 px-4 py-3 text-xs text-ink">
              {notice}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t.review.due} value={state?.dueCount ?? 0} accent />
            <Stat label={t.review.fresh} value={state?.newCount ?? 0} />
            <Stat label={t.review.learning} value={state?.learningCount ?? 0} />
            <Stat label={t.review.today} value={state?.reviewedToday ?? 0} />
          </div>

          {!state ? (
            <div className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted">
              {t.common.loading}
            </div>
          ) : state.due.length === 0 ? (
            <div className="rounded-2xl border border-line bg-panel p-8 text-center">
              <h2 className="text-base font-semibold">{t.review.emptyTitle}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{t.review.emptyBody}</p>
              <div className="mt-4 text-xs text-faint">
                {t.review.total}: <span className="text-ink">{state.total}</span>
              </div>
            </div>
          ) : (
            <ReviewQueue cards={state.due} onAnswer={answer} />
          )}
        </div>
      </div>
    </div>
  )
}
