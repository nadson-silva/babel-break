import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  ExerciseView,
  GradeFeedback,
  LessonDetail,
  LessonResultView
} from '../../../shared/types'
import { t } from '../i18n/pt-BR'

interface LessonScreenProps {
  lessonId: number
  onBack: () => void
  onCompleted: () => void
}

type Phase = 'content' | 'exercises' | 'summary'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function typeLabel(type: ExerciseView['type']): string {
  switch (type) {
    case 'multiple_choice':
      return 'Múltipla escolha'
    case 'cloze':
      return 'Complete a frase'
    case 'translate':
      return 'Traduza para o inglês'
    case 'order':
      return 'Ordene a frase'
    case 'free_production':
      return 'Produção livre'
    default:
      return type
  }
}

export function LessonScreen({ lessonId, onBack, onCompleted }: LessonScreenProps): JSX.Element {
  const [detail, setDetail] = useState<LessonDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('content')
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [feedback, setFeedback] = useState<GradeFeedback | null>(null)
  const [checking, setChecking] = useState(false)
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [results, setResults] = useState<boolean[]>([])
  const [finished, setFinished] = useState<LessonResultView | null>(null)
  const [finishing, setFinishing] = useState(false)
  const startedAt = useRef(Date.now())
  const alive = useRef(true)

  async function load(): Promise<void> {
    setLoadError(null)
    setDetail(null)

    try {
      const opened = await window.api.learning.lesson.open(lessonId)
      if (!alive.current) return
      setDetail(opened)
      setPhase('content')
      setIndex(0)
      setAnswer('')
      setPicked([])
      setFeedback(null)
      setResults([])
      setFinished(null)
      startedAt.current = Date.now()
    } catch (error) {
      if (alive.current) setLoadError(messageOf(error))
    }
  }

  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId])

  const exercise = detail?.exercises[index]
  const isOrder = exercise?.type === 'order'

  function resetAnswer(): void {
    setAnswer('')
    setPicked([])
    setFeedback(null)
    setAnswerError(null)
    startedAt.current = Date.now()
  }

  async function check(): Promise<void> {
    if (!exercise) return

    const response = isOrder ? picked.map((tokenIndex) => exercise.tokens[tokenIndex]).join(' ') : answer.trim()

    if (!response) {
      setAnswerError(t.player.emptyAnswer)
      return
    }

    setChecking(true)
    setAnswerError(null)

    try {
      const graded = await window.api.learning.lesson.answer({
        exerciseId: exercise.id,
        response,
        latencyMs: Date.now() - startedAt.current
      })

      if (!alive.current) return
      setFeedback(graded)
      setResults((previous) => [...previous, graded.correct])
    } catch (error) {
      if (alive.current) setAnswerError(messageOf(error))
    } finally {
      if (alive.current) setChecking(false)
    }
  }

  async function advance(): Promise<void> {
    if (!detail || !exercise) return

    if (index < detail.exercises.length - 1) {
      setIndex((value) => value + 1)
      resetAnswer()
      return
    }

    setFinishing(true)

    try {
      const result = await window.api.learning.lesson.finish({
        lessonId,
        sessionId: detail.sessionId
      })
      if (!alive.current) return
      setFinished(result)
      setPhase('summary')
    } catch (error) {
      if (alive.current) setAnswerError(messageOf(error))
    } finally {
      if (alive.current) setFinishing(false)
    }
  }

  function toggleToken(tokenIndex: number): void {
    if (feedback) return
    setAnswerError(null)
    setPicked((previous) =>
      previous.includes(tokenIndex)
        ? previous.filter((entry) => entry !== tokenIndex)
        : [...previous, tokenIndex]
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex items-center justify-between border-b border-line px-8 py-4">
          <h1 className="text-base font-semibold">{t.player.errorTitle}</h1>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
          >
            {t.player.back}
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="max-w-lg text-center">
            <p className="text-sm leading-relaxed text-danger">{loadError}</p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90"
              >
                {t.player.retry}
              </button>
              <button
                type="button"
                onClick={onBack}
                className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
              >
                {t.player.back}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!detail || !exercise) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex items-center justify-between border-b border-line px-8 py-4">
          <h1 className="text-base font-semibold">{t.player.loadingTitle}</h1>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
          >
            {t.player.back}
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 size-10 animate-pulse rounded-full border-2 border-accent/30 border-t-accent" />
            <h2 className="text-sm font-semibold">{t.player.loadingTitle}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{t.player.loadingBody}</p>
          </div>
        </div>
      </div>
    )
  }

  const content = detail.content
  const total = detail.exercises.length
  const progress = phase === 'summary' ? 100 : (index / total) * 100
  const usedFallback =
    content.source === 'fallback' || detail.exercises.some((entry) => entry.source === 'fallback')

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{detail.lesson.title}</h1>
          <p className="truncate text-xs text-muted">
            {detail.lesson.unitTitle ? `${detail.lesson.unitTitle} · ` : ''}
            {detail.lesson.level}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {phase === 'exercises' && (
            <span className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted">
              {t.player.exercise} {index + 1} {t.player.of} {total}
            </span>
          )}
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {t.player.back}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl pb-10">
          {phase !== 'summary' && (
            <div className="mb-6 h-1 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          {usedFallback && (
            <div className="mb-5 rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-xs leading-relaxed text-warn">
              {t.player.fallbackNotice}
            </div>
          )}

          {phase === 'content' && (
            <article className="space-y-5">
              <section className="rounded-2xl border border-line bg-panel p-6">
                <div className="text-[10px] uppercase tracking-wider text-faint">{t.player.objective}</div>
                <p className="mt-1.5 text-sm font-medium text-ink">{content.objective}</p>
                <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                  {content.explanation}
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-panel p-6">
                <h2 className="text-sm font-semibold">{t.player.examples}</h2>
                <ul className="mt-3 space-y-3">
                  {content.examples.map((example, exampleIndex) => (
                    <li key={`${example.en}-${exampleIndex}`} className="rounded-xl bg-panel-2 px-4 py-3">
                      <div className="text-sm text-ink">{example.en}</div>
                      <div className="mt-1 text-xs text-muted">{example.pt}</div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-2xl border border-line bg-panel p-6">
                <h2 className="text-sm font-semibold">{t.player.grammar}</h2>
                <div className="mt-3 space-y-4">
                  {content.grammarPoints.map((point, pointIndex) => (
                    <div key={`${point.title}-${pointIndex}`}>
                      <div className="text-xs font-semibold text-accent">{point.title}</div>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{point.explanation}</p>
                      <ul className="mt-2 space-y-1">
                        {point.examples.map((example, exampleIndex) => (
                          <li key={`${example}-${exampleIndex}`} className="text-sm text-ink">
                            · {example}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-panel p-6">
                <h2 className="text-sm font-semibold">{t.player.vocabulary}</h2>
                <div className="mt-3 divide-y divide-line-soft">
                  {content.vocabulary.map((item, itemIndex) => (
                    <div key={`${item.term}-${itemIndex}`} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:justify-between">
                      <div>
                        <span className="text-sm font-medium text-ink">{item.term}</span>
                        <span className="ml-2 text-xs text-muted">{item.translation}</span>
                      </div>
                      <span className="text-xs italic text-faint">{item.example}</span>
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setPhase('exercises')
                    resetAnswer()
                  }}
                  className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                >
                  {t.player.practiceCta}
                </button>
              </div>
            </article>
          )}

          {phase === 'exercises' && (
            <section className="rounded-2xl border border-line bg-panel p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-panel-2 px-2.5 py-1 text-[10px] uppercase tracking-wider text-faint">
                  {typeLabel(exercise.type)}
                </span>
              </div>

              <p className="mt-4 text-xs leading-relaxed text-muted">{exercise.instruction}</p>
              <p className="mt-2 text-lg font-medium leading-relaxed text-ink">{exercise.prompt}</p>

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
                            setAnswerError(null)
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
                          {option}
                        </button>
                      )
                    })}
                  </div>
                )}

                {isOrder && (
                  <div>
                    <div className="min-h-12 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-ink">
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

                {exercise.type === 'cloze' && (
                  <input
                    value={answer}
                    onChange={(event) => {
                      setAnswer(event.target.value)
                      setAnswerError(null)
                    }}
                    disabled={Boolean(feedback)}
                    placeholder={t.player.answerPlaceholder}
                    className="w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50 disabled:opacity-70"
                  />
                )}

                {exercise.type === 'translate' && (
                  <input
                    value={answer}
                    onChange={(event) => {
                      setAnswer(event.target.value)
                      setAnswerError(null)
                    }}
                    disabled={Boolean(feedback)}
                    placeholder={t.player.answerPlaceholder}
                    className="w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50 disabled:opacity-70"
                  />
                )}

                {exercise.type === 'free_production' && (
                  <textarea
                    value={answer}
                    onChange={(event) => {
                      setAnswer(event.target.value)
                      setAnswerError(null)
                    }}
                    disabled={Boolean(feedback)}
                    rows={4}
                    placeholder={t.player.answerPlaceholder}
                    className="w-full resize-none rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm leading-relaxed text-ink outline-none placeholder:text-faint focus:border-accent/50 disabled:opacity-70"
                  />
                )}
              </div>

              {answerError && <p className="mt-3 text-xs text-danger">{answerError}</p>}

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
                  {feedback.corrected && feedback.corrected.trim() !== answer.trim() && (
                    <div className="mt-2 text-xs text-muted">
                      <span className="text-faint">{t.player.expected}: </span>
                      {feedback.corrected}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5 flex justify-end">
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
                    disabled={finishing}
                    className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
                  >
                    {index < total - 1 ? t.player.next : finishing ? t.common.saving : t.player.finish}
                  </button>
                )}
              </div>
            </section>
          )}

          {phase === 'summary' && (
            <section className="rounded-2xl border border-accent/40 bg-panel p-8 text-center">
              <div className="text-xs uppercase tracking-wider text-faint">{t.player.summaryTitle}</div>
              <div className="mt-3 text-4xl font-semibold text-accent">
                {finished ? `${Math.round(finished.score * 100)}%` : `${Math.round((results.filter(Boolean).length / total) * 100)}%`}
              </div>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
                {t.player.summaryBody
                  .replace('{correct}', String(finished?.correct ?? results.filter(Boolean).length))
                  .replace('{total}', String(finished?.total ?? total))}
              </p>

              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIndex(0)
                    setResults([])
                    setFinished(null)
                    resetAnswer()
                    setPhase('content')
                  }}
                  className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
                >
                  {t.player.restart}
                </button>
                <button
                  type="button"
                  onClick={onCompleted}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                >
                  {t.player.backHome}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
