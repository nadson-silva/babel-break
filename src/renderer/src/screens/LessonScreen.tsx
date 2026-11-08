import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { CardView, LessonDetail, LessonResultView, ReviewRating } from '../../../shared/types'
import { t } from '../i18n'
import { nativeLabel } from '../lang'
import { ExercisePlayer } from '../components/ExercisePlayer'
import { jobPercent, useJob } from '../lib/jobs'
import { ReportButton } from '../components/ReportButton'
import { ReviewQueue } from '../components/ReviewQueue'
import { TargetText } from '../components/TargetText'

interface LessonScreenProps {
  lessonId: number
  onBack: () => void
  onCompleted: () => void
  /** Lição de trilha marcada para roleplay: fechar a lição em cenário. */
  onOpenScenario?: (lessonId: number) => void
}

type Phase = 'content' | 'exercises' | 'summary'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function LessonScreen({ lessonId, onBack, onCompleted, onOpenScenario }: LessonScreenProps): JSX.Element {
  const [detail, setDetail] = useState<LessonDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('content')
  const [finished, setFinished] = useState<LessonResultView | null>(null)
  const [doneCount, setDoneCount] = useState(0)
  const [due, setDue] = useState<CardView[]>([])
  const [reviewing, setReviewing] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const alive = useRef(true)
  // V2 (E9): progresso/cancelamento da geração desta lição.
  const job = useJob('lesson:generate')

  async function load(): Promise<void> {
    setLoadError(null)
    setDetail(null)

    try {
      const [opened, review] = await Promise.all([
        window.api.learning.lesson.open(lessonId),
        window.api.review.state(8)
      ])
      if (!alive.current) return
      setDetail(opened)
      setDue(review.due)
      setReviewing(false)
      setPhase('content')
      setFinished(null)
      setDoneCount(0)
    } catch (error) {
      if (alive.current) setLoadError(messageOf(error))
    }
  }

  async function answerReview(cardId: number, rating: ReviewRating): Promise<void> {
    const result = await window.api.review.answer({ cardId, rating })
    const next = await window.api.review.state(8)
    if (!alive.current) return

    setDue(next.due)
    if (result.dueCount === 0) setReviewing(false)
  }

  /**
   * Troca o bloco de exercícios da lição (enunciado ruim, repetido, resposta
   * impossível de deduzir). O índice e as respostas são estado interno do
   * player, então ele é remontado e a prática recomeça do zero.
   */
  async function regenerate(): Promise<void> {
    if (regenerating) return

    setRegenerating(true)
    setActionError(null)

    try {
      const opened = await window.api.learning.lesson.regenerate(lessonId)
      if (!alive.current) return
      setDetail(opened)
      setDoneCount(0)
      setFinished(null)
    } catch (error) {
      if (alive.current) setActionError(messageOf(error))
    } finally {
      if (alive.current) setRegenerating(false)
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

  if (!detail) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex items-center justify-between border-b border-line px-8 py-4">
          <h1 className="text-base font-semibold">{t.player.loadingTitle}</h1>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {t.player.back}
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 size-10 animate-pulse rounded-full border-2 border-accent/30 border-t-accent" />
            <h2 className="text-sm font-semibold">{t.player.loadingTitle}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{t.player.loadingBody}</p>

            {/* V2 (E9): geração longa tem nome, progresso e saída. */}
            {job.event && (
              <div className="mt-5">
                <p className="text-xs text-ink">{job.event.label}</p>
                <div className="mx-auto mt-2 h-1 w-56 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.max(6, jobPercent(job.event))}%` }}
                  />
                </div>
                <button
                  type="button"
                  onClick={job.cancel}
                  className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
                >
                  {t.jobs.cancel}
                </button>
              </div>
            )}
            {job.event?.state === 'error' && (
              <p role="alert" className="mt-3 text-xs text-danger">
                {job.event.message}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const content = detail.content
  const total = detail.exercises.length
  const usedFallback =
    content.source === 'fallback' || detail.exercises.some((entry) => entry.source === 'fallback')

  async function completePractice(): Promise<void> {
    try {
      const result = await window.api.learning.lesson.finish({
        lessonId,
        sessionId: detail!.sessionId
      })
      setFinished(result)
      setPhase('summary')
    } catch (error) {
      setLoadError(messageOf(error))
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{detail.lesson.title}</h1>
          <p className="truncate text-xs text-muted">
            {detail.lesson.unitTitle ? `${detail.lesson.unitTitle} · ` : ''}
            {detail.lesson.trackTitle
              ? `${t.player.trackBadge.replace('{title}', detail.lesson.trackTitle)} · `
              : ''}
            {detail.lesson.level}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {phase !== 'summary' && (
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={regenerating}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-60"
            >
              {regenerating ? t.player.regenerating : t.player.regenerate}
            </button>
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
          {actionError && (
            <div className="mb-5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-2.5 text-xs leading-relaxed text-ink">
              {actionError}
            </div>
          )}

          {phase !== 'summary' && (
            <div className="mb-6 h-1 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${phase === 'exercises' ? Math.round(((doneCount + 1) / Math.max(1, total)) * 100) : 0}%`
                }}
              />
            </div>
          )}

          {usedFallback && (
            <div className="mb-5 rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-xs leading-relaxed text-warn">
              {t.player.fallbackNotice}
            </div>
          )}

          {phase === 'content' && (
            <article className="space-y-5">
              {due.length > 0 && (
                <section className="rounded-2xl border border-line bg-panel p-5">
                  {reviewing ? (
                    <div className="space-y-4">
                      <ReviewQueue
                        cards={due}
                        onAnswer={answerReview}
                        onSkip={() => setReviewing(false)}
                        skipLabel={t.common.skip}
                        dense
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted">
                        {t.tutor.reviewBanner.replace('{count}', String(due.length))}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setReviewing(true)}
                          className="rounded-lg border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
                        >
                          {t.tutor.reviewBannerCta}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDue([])}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
                        >
                          {t.common.skip}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {detail.focus.length > 0 && (
                <section className="rounded-2xl border border-accent/40 bg-accent-soft/30 p-5">
                  <div className="text-[10px] uppercase tracking-wider text-accent">{t.home.focusTitle}</div>
                  <div className="mt-2 space-y-1.5">
                    {detail.focus.slice(0, 4).map((entry) => (
                      <p key={`${entry.tag}-${entry.source}`} className="text-xs leading-relaxed text-ink">
                        <span className="font-medium">{entry.tag}</span>
                        {entry.occurrences > 1 ? ` (${entry.occurrences}x)` : ''}: {entry.original} →{' '}
                        <span className="text-accent">{entry.corrected}</span>
                      </p>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-line bg-panel p-6">
                <div className="text-[10px] uppercase tracking-wider text-faint">{t.player.objective}</div>
                <p className="mt-1.5 text-sm font-medium text-ink">{content.objective}</p>
                <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                  {content.explanation}
                </div>
                {/* M5: "essa explicação está ruim" → o cache envelhece e a
                    próxima abertura reescreve o conteúdo da lição. */}
                <div className="mt-3 border-t border-line-soft pt-2">
                  <ReportButton kind="lesson_content" targetId={detail.lesson.id} text={content.explanation} compact />
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-panel p-6">
                <h2 className="text-sm font-semibold">{t.player.examples}</h2>
                <ul className="mt-3 space-y-3">
                  {content.examples.map((example, exampleIndex) => (
                    <li key={`${example.target}-${exampleIndex}`} className="rounded-xl bg-panel-2 px-4 py-3">
                      <TargetText className="block text-sm text-ink">{example.target}</TargetText>
                      <div className="mt-1 text-xs text-muted">{example.native}</div>
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
                            · <TargetText>{example}</TargetText>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              {content.pitfalls && content.pitfalls.length > 0 && (
                <section className="rounded-2xl border border-warn/30 bg-panel p-6">
                  <h2 className="text-sm font-semibold">{t.player.pitfalls.replace('{native}', nativeLabel())}</h2>
                  <div className="mt-3 space-y-3">
                    {content.pitfalls.map((pitfall, index) => (
                      <div key={`${pitfall.tag}-${index}`} className="rounded-xl bg-panel-2 px-4 py-3">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                          <TargetText className="text-danger/90 line-through decoration-danger/40">{pitfall.wrong}</TargetText>
                          <span className="text-faint">→</span>
                          <TargetText className="font-medium text-accent">{pitfall.right}</TargetText>
                          <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] text-faint">
                            {pitfall.tag}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted">{pitfall.note}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-line bg-panel p-6">
                <h2 className="text-sm font-semibold">{t.player.vocabulary}</h2>
                <div className="mt-3 divide-y divide-line-soft">
                  {content.vocabulary.map((item, itemIndex) => (
                    <div
                      key={`${item.term}-${itemIndex}`}
                      className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:justify-between"
                    >
                      <div>
                        <TargetText className="text-sm font-medium text-ink">{item.term}</TargetText>
                        <span className="ml-2 text-xs text-muted">{item.translation}</span>
                      </div>
                      <TargetText className="text-xs italic text-faint">{item.example}</TargetText>
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setPhase('exercises')}
                  className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                >
                  {t.player.practiceCta}
                </button>
              </div>
            </article>
          )}

          {phase === 'exercises' && (
            <ExercisePlayer
              // Id do primeiro exercício: regenerar troca os ids e remonta o
              // player, que guarda índice e respostas no próprio estado.
              key={detail.exercises[0]?.id ?? lessonId}
              exercises={detail.exercises}
              lessonId={lessonId}
              onProgress={(index) => setDoneCount(index)}
              onComplete={async () => {
                await completePractice()
              }}
            />
          )}

          {phase === 'summary' && (
            <section className="rounded-2xl border border-accent/40 bg-panel p-8 text-center">
              <div className="text-xs uppercase tracking-wider text-faint">{t.player.summaryTitle}</div>
              <div className="mt-3 text-4xl font-semibold text-accent">
                {Math.round((finished?.score ?? 0) * 100)}%
              </div>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
                {t.player.summaryBody
                  .replace('{correct}', String(finished?.correct ?? 0))
                  .replace('{total}', String(finished?.total ?? total))}
              </p>

              {(finished?.cardsCreated ?? 0) > 0 && (
                <p className="mx-auto mt-2 max-w-md text-xs text-accent">
                  {t.player.summaryCards.replace('{count}', String(finished?.cardsCreated))}
                </p>
              )}

              {finished?.levelChange && (
                <p className="mx-auto mt-2 max-w-md text-xs text-muted">
                  {t.player.summaryLevel
                    .replace('{from}', finished.levelChange.from)
                    .replace('{to}', finished.levelChange.to)}
                </p>
              )}

              <div className="mt-6 flex items-center justify-center gap-2">
                {detail.lesson.isScenario && onOpenScenario && (
                  <button
                    type="button"
                    onClick={() => onOpenScenario(detail.lesson.id)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                  >
                    {t.player.scenarioCta}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPhase('content')
                    setFinished(null)
                    setDoneCount(0)
                  }}
                  className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
                >
                  {t.player.restart}
                </button>
                <button
                  type="button"
                  onClick={onCompleted}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                    detail.lesson.isScenario
                      ? 'border border-line text-muted hover:text-ink'
                      : 'bg-accent text-accent-ink hover:bg-accent/90'
                  }`}
                >
                  {t.player.backHome}
                </button>
              </div>

              {detail.lesson.isScenario && (
                <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-faint">{t.player.scenarioBody}</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
