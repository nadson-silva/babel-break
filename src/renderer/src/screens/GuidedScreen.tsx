import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  CardView,
  GuidedSession,
  GuidedStep,
  LessonDetail,
  ReviewRating,
  SettingsPayload
} from '../../../shared/types'
import { t } from '../i18n'
import { ExercisePlayer } from '../components/ExercisePlayer'
import { ReviewQueue } from '../components/ReviewQueue'
import { TutorPanel } from '../components/TutorPanel'
import { ScenarioFeedbackPanel } from '../components/ScenarioPanel'
import { GUIDED_ORDER, guidedStepPosition, guidedStepTitle } from '../components/guidedSteps'

interface GuidedScreenProps {
  settings: SettingsPayload
  session: GuidedSession
  onExit: () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function GuidedScreen({ settings, session, onExit }: GuidedScreenProps): JSX.Element {
  const [current, setCurrent] = useState<GuidedSession>(session)
  const [step, setStep] = useState<GuidedStep>(session.step)
  const [due, setDue] = useState<CardView[]>([])
  const [reviewed, setReviewed] = useState(0)
  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [lessonError, setLessonError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (step !== 'review') return
    let cancelled = false

    void window.api.review
      .state(12)
      .then((state) => {
        if (!cancelled) setDue(state.due)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(messageOf(loadError))
      })

    return () => {
      cancelled = true
    }
  }, [step])

  useEffect(() => {
    if (step !== 'lesson' && step !== 'practice') return
    if (lesson || current.lessonId == null) return

    setLessonError(null)
    void window.api.learning.lesson
      .open(current.lessonId)
      .then((detail) => {
        if (alive.current) setLesson(detail)
      })
      .catch((loadError: unknown) => {
        if (alive.current) setLessonError(messageOf(loadError))
      })
  }, [step, lesson, current.lessonId])

  async function go(next: GuidedStep): Promise<void> {
    setBusy(true)
    try {
      const updated =
        next === 'tutor' ? await window.api.guided.tutor() : await window.api.guided.step(next)
      if (!alive.current) return
      setCurrent(updated)
      setStep(next)
    } catch (stepError) {
      if (alive.current) setError(messageOf(stepError))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  async function answerReview(cardId: number, rating: ReviewRating): Promise<void> {
    await window.api.review.answer({ cardId, rating })
    const nextDue = due.filter((card) => card.id !== cardId)
    const done = reviewed + 1

    setDue(nextDue)
    setReviewed(done)
    await window.api.guided.reviewCount(done)
  }

  async function finishPractice(correct: number, total: number): Promise<void> {
    if (lesson) {
      await window.api.learning.lesson.finish({ lessonId: lesson.lesson.id, sessionId: lesson.sessionId })
    }
    await window.api.guided.practice({ correct, total })
    await go('tutor')
  }

  async function recap(): Promise<void> {
    setBusy(true)
    try {
      const finished = await window.api.guided.finish({
        reviewDone: reviewed,
        practice: current.practice
      })
      if (!alive.current) return
      setCurrent(finished)
      setStep('recap')
    } catch (finishError) {
      if (alive.current) setError(messageOf(finishError))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  async function abandonSession(): Promise<void> {
    // M6 (B3): "Encerrar sessão" encerra de verdade no banco — sem isto o
    // handler `guided:abandon` existia sem nenhum call site na UI e a sessão
    // ficava ativa para sempre (aparecia como "retomar" na home).
    try {
      await window.api.guided.abandon()
    } catch (abandonError) {
      setError(messageOf(abandonError))
      return
    }
    onExit()
  }

  const position = guidedStepPosition(step)
  const model = settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{t.guided.title}</h1>
          <p className="truncate text-xs text-muted">
            {t.guided.stepOf.replace('{current}', String(position)).replace('{total}', String(GUIDED_ORDER.length))} ·{' '}
            {guidedStepTitle(step)}
            {current.lessonTitle ? ` · ${current.lessonTitle}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void abandonSession()}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {t.guided.abandon}
          </button>
        </div>
      </header>

      <div className="mb-6 h-1 overflow-hidden rounded-full bg-panel-2">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${(position / GUIDED_ORDER.length) * 100}%` }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-2">
        <div className="mx-auto max-w-3xl space-y-5 pb-8">
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
              {error}
            </div>
          )}

          {!model && (
            <div className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-xs text-warn">
              {t.common.noModel}
            </div>
          )}

          {step === 'review' && (
            <section className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold">{t.guided.stepReview}</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t.guided.reviewHelp}</p>
              </div>

              {due.length === 0 ? (
                <div className="rounded-2xl border border-line bg-panel p-6 text-center text-sm text-muted">
                  {t.review.emptyTitle}
                </div>
              ) : (
                <ReviewQueue
                  cards={due}
                  onAnswer={answerReview}
                  onSkip={() => void go('lesson')}
                  skipLabel={t.common.skip}
                  dense
                />
              )}

              {(due.length === 0 || reviewed > 0) && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void go('lesson')}
                    className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
                  >
                    {due.length === 0 ? t.guided.lessonCta : `${t.common.skip} (${t.guided.reviewDone.replace('{done}', String(reviewed)).replace('{due}', String(current.review.dueCount))})`}
                  </button>
                </div>
              )}
            </section>
          )}

          {step === 'lesson' && (
            <LessonRead
              lesson={lesson}
              error={lessonError}
              onRetry={() => {
                setLesson(null)
                void window.api.learning.lesson
                  .open(current.lessonId ?? 0)
                  .then((detail) => setLesson(detail))
                  .catch((retryError: unknown) => setLessonError(messageOf(retryError)))
              }}
              onContinue={() => void go('practice')}
              busy={busy}
            />
          )}

          {step === 'practice' && lesson && (
            <section className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold">{t.guided.stepPractice}</h2>
                <p className="mt-1 text-xs text-muted">{lesson.lesson.title}</p>
              </div>
              <ExercisePlayer
                exercises={lesson.exercises}
                completeLabel={t.guided.tutorCta}
                onComplete={async ({ correct, total }) => {
                  await finishPractice(correct, total)
                }}
              />
            </section>
          )}

          {step === 'practice' && !lesson && (
            <div className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted">
              {lessonError ?? t.common.loading}
            </div>
          )}

          {step === 'tutor' && current.conversationId && (
            <section className="flex min-h-[520px] flex-col rounded-2xl border border-line bg-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    {current.isScenario ? t.scenario.start : t.guided.stepTutor}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">{t.guided.tutorHelp}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void recap()}
                  className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-50"
                >
                  {t.guided.recapCta}
                </button>
              </div>
              <TutorPanel
                conversationId={current.conversationId}
                variant="compact"
                onClosed={() => void recap()}
                onScenarioClosed={() => void recap()}
              />
            </section>
          )}

          {step === 'tutor' && !current.conversationId && (
            <div className="rounded-2xl border border-line bg-panel p-6 text-center">
              <p className="text-sm text-muted">{t.guided.tutorHelp}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void go('tutor')}
                className="mt-4 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {t.guided.tutorCta}
              </button>
            </div>
          )}

          {step === 'recap' && (
            <section className="rounded-2xl border border-accent/40 bg-panel p-8">
              <div className="text-xs uppercase tracking-wider text-faint">{t.guided.recapTitle}</div>
              <p className="mt-3 text-sm leading-relaxed text-ink">{current.recap?.message ?? t.guided.recapTitle}</p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line bg-panel-2 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-faint">{t.guided.stepReview}</div>
                  <div className="mt-1 text-sm font-medium text-ink">
                    {t.guided.recapReview.replace('{count}', String(current.recap?.reviewDone ?? reviewed))}
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-panel-2 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-faint">{t.guided.stepPractice}</div>
                  <div className="mt-1 text-sm font-medium text-ink">
                    {t.guided.recapPractice
                      .replace('{correct}', String(current.recap?.practice?.correct ?? current.practice.correct))
                      .replace('{total}', String(current.recap?.practice?.total ?? current.practice.total))}
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-panel-2 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-faint">{t.review.title}</div>
                  <div className="mt-1 text-sm font-medium text-ink">
                    {t.guided.recapCards.replace('{count}', String(current.recap?.cardsCreated ?? 0))}
                  </div>
                </div>
              </div>

              {current.recap && current.recap.tags.length > 0 && (
                <p className="mt-4 text-xs text-muted">
                  {t.guided.recapTags.replace('{tags}', current.recap.tags.join(', '))}
                </p>
              )}

              {current.recap?.levelChange && (
                <p className="mt-2 text-xs text-accent">
                  {t.player.summaryLevel
                    .replace('{from}', current.recap.levelChange.from)
                    .replace('{to}', current.recap.levelChange.to)}
                </p>
              )}

              {current.recap?.scenario && (
                <div className="mt-4">
                  <ScenarioFeedbackPanel run={current.recap.scenario} />
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={onExit}
                  className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                >
                  {t.guided.backHome}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function LessonRead({
  lesson,
  error,
  onRetry,
  onContinue,
  busy
}: {
  lesson: LessonDetail | null
  error: string | null
  onRetry: () => void
  onContinue: () => void
  busy: boolean
}): JSX.Element {
  if (error) {
    return (
      <div className="rounded-2xl border border-danger/40 bg-danger-soft p-6 text-center">
        <p className="text-sm text-danger">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-line bg-panel px-4 py-2 text-xs text-ink transition-colors hover:bg-panel-2"
        >
          {t.player.retry}
        </button>
      </div>
    )
  }

  if (!lesson) {
    return (
      <div className="rounded-2xl border border-line bg-panel p-8 text-center">
        <div className="mx-auto mb-3 size-8 animate-pulse rounded-full border-2 border-accent/30 border-t-accent" />
        <h2 className="text-sm font-semibold">{t.player.loadingTitle}</h2>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">{t.player.loadingBody}</p>
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-line bg-panel p-6">
        <div className="text-[10px] uppercase tracking-wider text-faint">{t.player.objective}</div>
        <p className="mt-1.5 text-sm font-medium text-ink">{lesson.content.objective}</p>
        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {lesson.content.explanation}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-6">
        <h2 className="text-sm font-semibold">{t.player.vocabulary}</h2>
        <div className="mt-3 divide-y divide-line-soft">
          {lesson.content.vocabulary.slice(0, 6).map((item, index) => (
            <div key={`${item.term}-${index}`} className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-sm text-ink">
                <span className="font-medium">{item.term}</span>
                <span className="ml-2 text-xs text-muted">{item.translation}</span>
              </span>
              <span className="truncate text-xs italic text-faint">{item.example}</span>
            </div>
          ))}
        </div>
      </div>

      {lesson.focus.length > 0 && (
        <div className="rounded-2xl border border-accent/40 bg-accent-soft/30 p-5">
          <div className="text-[10px] uppercase tracking-wider text-accent">{t.home.focusTitle}</div>
          <div className="mt-2 space-y-1.5">
            {lesson.focus.slice(0, 3).map((entry) => (
              <p key={entry.tag} className="text-xs leading-relaxed text-ink">
                <span className="font-medium">{entry.tag}</span>: {entry.original} →{' '}
                <span className="text-accent">{entry.corrected}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={onContinue}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {t.guided.practiceCta}
        </button>
      </div>
    </section>
  )
}
