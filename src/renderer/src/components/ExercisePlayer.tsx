import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ExerciseType, ExerciseView, GradeFeedback } from '../../../shared/types'
import { t } from '../i18n'
import { targetIsCjk, targetLabel, targetLanguage } from '../lang'

interface ExercisePlayerProps {
  exercises: ExerciseView[]
  /** Chamado ao passar do último exercício, com o placar da rodada. */
  onComplete: (result: { correct: number; total: number }) => void | Promise<void>
  onSkip?: () => void
  completeLabel?: string
  dense?: boolean
  /** Índice atual, para a barra de progresso de quem hospeda o player. */
  onProgress?: (index: number, total: number) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Rótulos no idioma da interface (M4) — o "inglês" fixo virou o idioma do perfil. */
function typeLabel(type: ExerciseType): string {
  const lang = targetLabel()
  switch (type) {
    case 'multiple_choice':
      return t.player.typeMultipleChoice
    case 'cloze':
      return t.player.typeCloze
    case 'translate':
      return t.player.typeTranslate.replace('{lang}', lang)
    case 'order':
      return t.player.typeOrder
    case 'free_production':
      return t.player.typeFreeProduction
    default:
      return type
  }
}

export function ExercisePlayer({
  exercises,
  onComplete,
  onSkip,
  completeLabel,
  dense,
  onProgress
}: ExercisePlayerProps): JSX.Element {
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [feedback, setFeedback] = useState<GradeFeedback | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<boolean[]>([])
  const [sending, setSending] = useState(false)
  const startedAt = useRef(Date.now())

  const exercise = exercises[index]
  const isOrder = exercise?.type === 'order'
  const total = exercises.length

  useEffect(() => {
    onProgress?.(index, total)
  }, [index, total, onProgress])

  function resetAnswer(): void {
    setAnswer('')
    setPicked([])
    setFeedback(null)
    setError(null)
    startedAt.current = Date.now()
  }

  function toggleToken(tokenIndex: number): void {
    if (feedback) return
    setError(null)
    setPicked((previous) =>
      previous.includes(tokenIndex)
        ? previous.filter((entry) => entry !== tokenIndex)
        : [...previous, tokenIndex]
    )
  }

  async function check(): Promise<void> {
    if (!exercise) return

    // Em escrita CJK as unidades se juntam sem espaço (o gabarito não tem espaços).
    const response = isOrder
      ? picked.map((tokenIndex) => exercise.tokens[tokenIndex]).join(targetIsCjk() ? '' : ' ')
      : answer.trim()

    if (!response) {
      setError(t.player.emptyAnswer)
      return
    }

    setChecking(true)
    setError(null)

    try {
      const graded = await window.api.learning.lesson.answer({
        exerciseId: exercise.id,
        response,
        latencyMs: Date.now() - startedAt.current
      })
      setFeedback(graded)
      setResults((previous) => [...previous, graded.correct])
    } catch (loadError) {
      setError(messageOf(loadError))
    } finally {
      setChecking(false)
    }
  }

  async function advance(): Promise<void> {
    if (!exercise) return

    if (index < total - 1) {
      setIndex((value) => value + 1)
      resetAnswer()
      return
    }

    setSending(true)
    try {
      await onComplete({ correct: results.filter(Boolean).length, total })
    } finally {
      setSending(false)
    }
  }

  if (!exercise) {
    return (
      <div className="rounded-2xl border border-line bg-panel p-6 text-center text-sm text-muted">
        {t.home.noLessons}
      </div>
    )
  }

  return (
    <section className={`rounded-2xl border border-line bg-panel ${dense ? 'p-4' : 'p-6'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-panel-2 px-2.5 py-1 text-[10px] uppercase tracking-wider text-faint">
          {typeLabel(exercise.type)}
        </span>
        <span className="text-[11px] text-faint">
          {t.player.exercise} {index + 1} {t.player.of} {total}
        </span>
      </div>

      {exercise.targetTags.length > 0 && (
        <p className="mt-3 text-[11px] text-accent">
          {t.player.focusTag.replace('{tags}', exercise.targetTags.join(', '))}
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted">{exercise.instruction}</p>
      <p className="mt-2 text-lg font-medium leading-relaxed text-ink" dir="auto" lang={targetLanguage()}>
        {exercise.prompt}
      </p>

      <div className="mt-5">
        {exercise.type === 'multiple_choice' && (
          <div className="space-y-2">
            {exercise.options.map((option, optionIndex) => {
              const selected = answer === option
              return (
                <button
                  key={`${option}-${optionIndex}`}
                  type="button"
                  disabled={Boolean(feedback)}
                  onClick={() => {
                    setAnswer(option)
                    setError(null)
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default ${
                    selected
                      ? 'border-accent/60 bg-accent-soft text-ink'
                      : 'border-line bg-panel-2 text-muted hover:border-line/80 hover:text-ink'
                  }`}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full border text-[11px] ${
                      selected ? 'border-accent text-accent' : 'border-line text-faint'
                    }`}
                  >
                    {String.fromCharCode(65 + optionIndex)}
                  </span>
                  <span dir="auto" lang={targetLanguage()}>
                    {option}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {isOrder && (
          <div>
            <div className="min-h-12 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-ink" dir="auto" lang={targetLanguage()}>
              {picked.length === 0 ? (
                <span className="text-faint">{t.player.orderHint}</span>
              ) : (
                picked.map((tokenIndex, position) => (
                  <button
                    key={`${tokenIndex}-${position}`}
                    type="button"
                    onClick={() => toggleToken(tokenIndex)}
                    disabled={Boolean(feedback)}
                    className="mr-1.5 inline-block rounded-md bg-accent-soft px-2 py-0.5 text-accent transition-colors hover:bg-accent/20"
                  >
                    {exercise.tokens[tokenIndex]}
                  </button>
                ))
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {exercise.tokens.map((token, tokenIndex) => {
                const used = picked.includes(tokenIndex)
                return (
                  <button
                    key={`${token}-${tokenIndex}`}
                    type="button"
                    onClick={() => toggleToken(tokenIndex)}
                    disabled={used || Boolean(feedback)}
                    className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm text-ink transition-colors hover:border-accent/50 disabled:opacity-30"
                  >
                    {token}
                  </button>
                )
              })}
            </div>

            {picked.length > 0 && !feedback && (
              <button
                type="button"
                onClick={() => setPicked([])}
                className="mt-3 text-xs text-muted underline underline-offset-2 hover:text-ink"
              >
                {t.player.clear}
              </button>
            )}
          </div>
        )}

        {(exercise.type === 'cloze' || exercise.type === 'translate') && (
          <input
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value)
              setError(null)
            }}
            disabled={Boolean(feedback)}
            placeholder={t.player.answerPlaceholder.replace('{lang}', targetLabel())}
            className="w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50 disabled:opacity-70"
          />
        )}

        {exercise.type === 'free_production' && (
          <textarea
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value)
              setError(null)
            }}
            disabled={Boolean(feedback)}
            rows={4}
            placeholder={t.player.answerPlaceholder.replace('{lang}', targetLabel())}
            className="w-full resize-none rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm leading-relaxed text-ink outline-none placeholder:text-faint focus:border-accent/50 disabled:opacity-70"
          />
        )}
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      {feedback && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            feedback.correct
              ? 'border-accent/40 bg-accent-soft/50 text-ink'
              : 'border-danger/40 bg-danger-soft text-ink'
          }`}
        >
          <div className={`text-xs font-semibold ${feedback.correct ? 'text-accent' : 'text-danger'}`}>
            {feedback.correct ? t.player.correct : t.player.incorrect}
          </div>
          <p className="mt-1 leading-relaxed text-ink/90">{feedback.feedback}</p>
          {feedback.corrected && feedback.corrected.trim() !== (isOrder ? picked.map((tokenIndex) => exercise.tokens[tokenIndex]).join(targetIsCjk() ? '' : ' ') : answer.trim()) && (
            <div className="mt-2 text-xs text-muted">
              <span className="text-faint">{t.player.expected}: </span>
              <span dir="auto" lang={targetLanguage()}>{feedback.corrected}</span>
            </div>
          )}
          {feedback.errorTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {feedback.errorTags.map((tag) => (
                <span key={tag} className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-faint">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        {onSkip && !feedback ? (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted underline underline-offset-2 hover:text-ink"
          >
            {t.common.skip}
          </button>
        ) : (
          <span />
        )}

        {!feedback ? (
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {checking ? t.player.checking : t.player.check}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void advance()}
            disabled={sending}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {index < total - 1 ? t.player.next : sending ? t.common.saving : (completeLabel ?? t.player.finish)}
          </button>
        )}
      </div>
    </section>
  )
}
