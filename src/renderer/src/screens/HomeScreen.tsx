import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GuidedSession, HomeState, LessonSummary, SettingsPayload } from '../../../shared/types'
import { t } from '../i18n/pt-BR'
import { GUIDED_ORDER, guidedStepPosition, guidedStepTitle } from '../components/guidedSteps'

interface HomeScreenProps {
  settings: SettingsPayload
  onOpenLesson: (lessonId: number) => void
  onOpenCatalog: () => void
  onOpenTracks: () => void
  onOpenSettings: () => void
  onOpenTutor: (conversationId?: number) => void
  /** Abre um roleplay direto (tema avulso ou lição de foco). */
  onOpenScenario: (input: { lessonId?: number; topic?: string }) => void
  onOpenReview: () => void
  onOpenNotebook: () => void
  onStartGuided: (session: GuidedSession) => void
  onResumeGuided: (session: GuidedSession) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusLabel(lesson: LessonSummary): string {
  if (lesson.status === 'completed') return t.lessons.statusCompleted
  if (lesson.status === 'in_progress') return t.lessons.statusInProgress
  return t.lessons.statusNotStarted
}

function statusColor(lesson: LessonSummary): string {
  if (lesson.status === 'completed') return 'bg-accent'
  if (lesson.status === 'in_progress') return 'bg-warn'
  return 'bg-faint/50'
}

function EntryCard({
  title,
  body,
  cta,
  onClick,
  disabled,
  accent
}: {
  title: string
  body: string
  cta: string
  onClick: () => void
  disabled?: boolean
  accent?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col rounded-2xl border p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        accent
          ? 'border-accent/40 bg-accent-soft/30 hover:bg-accent-soft/50'
          : 'border-line bg-panel hover:bg-panel-2'
      }`}
    >
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-muted">{body}</p>
      <span className={`mt-3 text-xs font-medium ${accent ? 'text-accent' : 'text-muted'}`}>{cta} →</span>
    </button>
  )
}

export function HomeScreen({
  settings,
  onOpenLesson,
  onOpenCatalog,
  onOpenTracks,
  onOpenSettings,
  onOpenTutor,
  onOpenScenario,
  onOpenReview,
  onOpenNotebook,
  onStartGuided,
  onResumeGuided
}: HomeScreenProps): JSX.Element {
  const [data, setData] = useState<HomeState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [startingGuided, setStartingGuided] = useState(false)
  const started = useRef(false)

  const model = settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel

  async function load(): Promise<void> {
    setData(await window.api.learning.home.get())
  }

  async function generate(): Promise<void> {
    setGenerating(true)
    setError(null)

    try {
      await window.api.learning.curriculum.generate()
      await load()
    } catch (generateError) {
      setError(messageOf(generateError))
    } finally {
      setGenerating(false)
    }
  }

  async function startGuided(): Promise<void> {
    setStartingGuided(true)
    setError(null)
    try {
      const session = await window.api.guided.start()
      onStartGuided(session)
    } catch (guidedError) {
      setError(messageOf(guidedError))
    } finally {
      setStartingGuided(false)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true

    let alive = true

    void (async () => {
      try {
        const state = await window.api.learning.home.get()
        if (!alive) return
        setData(state)

        if (!state.curriculumReady && model) {
          setGenerating(true)
          await window.api.learning.curriculum.generate()
          const next = await window.api.learning.home.get()
          if (alive) setData(next)
        }
      } catch (loadError) {
        if (alive) setError(messageOf(loadError))
      } finally {
        if (alive) setGenerating(false)
      }
    })()

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const profile = data?.profile
  const total = data?.totalCount ?? 0
  const done = data?.completedCount ?? 0
  const progress = total > 0 ? Math.round((done / total) * 100) : 0
  const due = data?.review.due ?? 0
  const openErrors = data?.notebook.open ?? 0

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div>
          <h1 className="text-base font-semibold">{t.home.title}</h1>
          <p className="text-xs text-muted">{t.home.subtitle}</p>
        </div>
        {profile && (
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted">
              {t.home.level} <span className="font-semibold text-accent">{profile.cefr}</span>
            </div>
            {profile.goal && (
              <div className="max-w-56 truncate rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted">
                {profile.goal}
              </div>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl space-y-5 pb-8">
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
              <div className="leading-relaxed">{error}</div>
              <button
                type="button"
                onClick={() => void generate()}
                className="mt-2 underline underline-offset-2"
              >
                {t.player.retry}
              </button>
            </div>
          )}

          {!model && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-xs text-warn">
              <span>{t.home.noModel}</span>
              <button
                type="button"
                onClick={onOpenSettings}
                className="shrink-0 rounded-lg border border-warn/40 px-3 py-1.5 font-medium transition-colors hover:bg-warn/10"
              >
                {t.common.openSettings}
              </button>
            </div>
          )}

          {!data ? (
            <div className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted">
              {t.home.curriculumBody}
            </div>
          ) : !data.curriculumReady ? (
            <section className="rounded-2xl border border-line bg-panel p-8">
              <h2 className="text-lg font-semibold">{t.home.curriculumTitle}</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{t.home.curriculumBody}</p>
              <button
                type="button"
                onClick={() => void generate()}
                disabled={generating || !model}
                className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? t.home.generating : t.home.generateCta}
              </button>
            </section>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {data.continueLesson && (
                  <section className="rounded-2xl border border-accent/40 bg-accent-soft/30 p-5">
                    <div className="text-[10px] uppercase tracking-wider text-accent">
                      {t.home.continueTitle}
                    </div>
                    <h2 className="mt-2 text-base font-semibold">{data.continueLesson.title}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {t.home.continueBody.replace('{title}', data.continueLesson.title)}
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenLesson(data.continueLesson!.id)}
                      className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                    >
                      {t.home.continueCta}
                    </button>
                  </section>
                )}

                {data.guided && data.guided.recap === null ? (
                  <section className="rounded-2xl border border-accent/40 bg-accent-soft/30 p-5">
                    <div className="text-[10px] uppercase tracking-wider text-accent">{t.guided.title}</div>
                    <h2 className="mt-2 text-base font-semibold">{guidedStepTitle(data.guided.step)}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {t.guided.stepOf
                        .replace('{current}', String(guidedStepPosition(data.guided.step)))
                        .replace('{total}', String(GUIDED_ORDER.length))}{' '}
                      · {data.guided.lessonTitle ?? t.guided.stepLesson}
                    </p>
                    <button
                      type="button"
                      onClick={() => onResumeGuided(data.guided!)}
                      className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                    >
                      {t.home.continueCta}
                    </button>
                  </section>
                ) : (
                  data.suggestion && (
                    <section className="rounded-2xl border border-line bg-panel p-5">
                      <div className="text-[10px] uppercase tracking-wider text-faint">{t.home.nextTitle}</div>
                      <h2 className="mt-2 text-base font-semibold">{data.suggestion.lesson.title}</h2>
                      <p className="mt-1 text-xs text-muted">
                        {t.home.nextBody
                          .replace('{title}', data.suggestion.lesson.title)
                          .replace('{level}', data.suggestion.lesson.level)}{' '}
                        · {data.suggestion.reason}
                      </p>
                      {data.suggestion.origin === 'focus' && (
                        <span className="mt-2 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
                          {t.home.nextFromTrack}
                        </span>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenLesson(data.suggestion!.lesson.id)}
                          className="rounded-lg border border-line px-4 py-2 text-xs font-medium text-ink transition-colors hover:border-accent/50 hover:text-accent"
                        >
                          {data.suggestion.lesson.isScenario ? t.tracks.scenarioCta : t.home.nextCta}
                        </button>
                        {data.suggestion.lesson.isScenario && (
                          <button
                            type="button"
                            onClick={() => onOpenScenario({ lessonId: data.suggestion!.lesson.id })}
                            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                          >
                            {t.scenario.start}
                          </button>
                        )}
                      </div>
                    </section>
                  )
                )}

                {data.continueConversation && (
                  <section className="rounded-2xl border border-line bg-panel p-5">
                    <div className="text-[10px] uppercase tracking-wider text-faint">
                      {t.home.continueChatTitle}
                    </div>
                    <h2 className="mt-2 text-base font-semibold">
                      {data.continueConversation.topic ?? data.continueConversation.lessonTitle ?? t.tutor.title}
                    </h2>
                    <p className="mt-1 text-xs text-muted">
                      {t.home.continueChatBody.replace(
                        '{topic}',
                        data.continueConversation.topic ?? t.tutor.title
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenTutor(data.continueConversation!.id)}
                      className="mt-4 rounded-lg border border-line px-4 py-2 text-xs font-medium text-ink transition-colors hover:border-accent/50 hover:text-accent"
                    >
                      {t.home.continueChatCta}
                    </button>
                  </section>
                )}
              </div>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-ink">{t.home.entriesTitle}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <EntryCard
                    title={t.home.entryLesson}
                    body={t.home.entryLessonBody}
                    cta={t.home.nextCta}
                    onClick={onOpenCatalog}
                  />
                  <EntryCard
                    title={t.home.entryChat}
                    body={t.home.entryChatBody}
                    cta={t.home.continueChatCta}
                    onClick={() => onOpenTutor()}
                  />
                  <EntryCard
                    title={t.home.entryTracks}
                    body={
                      (data.tracks.length ?? 0) > 0
                        ? t.home.entryTracksBody
                            .replace('{count}', String(data.tracks.length))
                            .replace('{next}', data.tracks[0]?.nextLesson?.title ?? '—')
                        : t.home.entryTracksBodyEmpty
                    }
                    cta={t.nav.tracks}
                    onClick={onOpenTracks}
                  />
                  <EntryCard
                    title={t.home.entryScenario}
                    body={t.home.entryScenarioBody}
                    cta={t.scenario.start}
                    onClick={() => onOpenScenario({ topic: data.profile.goal ?? 'daily standup' })}
                  />
                  <EntryCard
                    accent
                    title={t.home.entryGuided}
                    body={t.home.entryGuidedBody}
                    cta={startingGuided ? t.guided.starting : t.guided.start}
                    onClick={() => void startGuided()}
                    disabled={startingGuided || !model}
                  />
                  <EntryCard
                    title={t.home.entryReview}
                    body={
                      due > 0
                        ? t.home.entryReviewBody.replace('{count}', String(due))
                        : t.home.entryReviewBodyEmpty
                    }
                    cta={t.review.title}
                    onClick={onOpenReview}
                  />
                  <EntryCard
                    title={t.home.entryNotebook}
                    body={
                      openErrors > 0
                        ? t.home.entryNotebookBody.replace('{count}', String(openErrors))
                        : t.home.entryNotebookBodyEmpty
                    }
                    cta={t.nav.notebook}
                    onClick={onOpenNotebook}
                  />
                  <EntryCard
                    title={t.home.progress}
                    body={t.home.completed
                      .replace('{done}', String(done))
                      .replace('{total}', String(total))}
                    cta={t.home.catalogCta}
                    onClick={onOpenCatalog}
                  />
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-panel p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{t.home.progress}</span>
                  <span className="text-xs text-muted">
                    {t.home.completed.replace('{done}', String(done)).replace('{total}', String(total))}
                  </span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
                </div>
              </section>

              {data.notebook.tags.length > 0 && (
                <section className="rounded-2xl border border-accent/40 bg-accent-soft/30 p-5">
                  <div className="text-[10px] uppercase tracking-wider text-accent">{t.home.focusTitle}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.notebook.tags.map((entry) => (
                      <button
                        key={entry.tag}
                        type="button"
                        onClick={onOpenNotebook}
                        className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-ink transition-colors hover:border-accent/50"
                      >
                        {entry.tag}
                        {entry.occurrences > 1 ? ` · ${entry.occurrences}x` : ''}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {data.tracks.length === 0 && (
                <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel p-5">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">{t.tracks.createTitle}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      {data.profile.goal
                        ? `${t.tracks.emptyBody} (${data.profile.goal})`
                        : t.tracks.emptyBody}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenTracks}
                    className="shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                  >
                    {t.tracks.createCta}
                  </button>
                </section>
              )}

              {data.tracks.length > 0 && (
                <section className="space-y-3">
                  {data.tracks.map((track) => (
                    <div key={track.id} className="rounded-2xl border border-line bg-panel p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-sm font-semibold">{track.title}</h2>
                          <p className="mt-0.5 text-xs text-faint">
                            {t.tracks.progress
                              .replace('{done}', String(track.completedCount))
                              .replace('{total}', String(track.totalCount))}{' '}
                            · {track.levelRange ?? track.lessons[0]?.level ?? '—'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={onOpenTracks}
                          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-accent"
                        >
                          {t.tracks.openTrack}
                        </button>
                      </div>

                      <div className="mt-3 divide-y divide-line-soft">
                        {track.lessons.slice(0, 3).map((lesson) => (
                          <button
                            key={lesson.id}
                            type="button"
                            onClick={() => onOpenLesson(lesson.id)}
                            className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:text-accent"
                          >
                            <span className={`size-1.5 shrink-0 rounded-full ${statusColor(lesson)}`} />
                            <span className="min-w-0 flex-1 truncate text-sm">{lesson.title}</span>
                            {lesson.isScenario && (
                              <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                                {t.scenario.badge}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              <section className="space-y-3">
                {data.units.map((unit) => (
                  <div key={unit.id} className="rounded-2xl border border-line bg-panel p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold">{unit.title}</h2>
                        {unit.description && <p className="mt-0.5 text-xs text-muted">{unit.description}</p>}
                      </div>
                      <span className="shrink-0 rounded-full bg-panel-2 px-2.5 py-1 text-[10px] uppercase tracking-wider text-faint">
                        {unit.level}
                      </span>
                    </div>

                    <div className="mt-3 divide-y divide-line-soft">
                      {unit.lessons.map((lesson) => (
                        <button
                          key={lesson.id}
                          type="button"
                          onClick={() => onOpenLesson(lesson.id)}
                          className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:text-accent"
                        >
                          <span className={`size-1.5 shrink-0 rounded-full ${statusColor(lesson)}`} />
                          <span className="min-w-0 flex-1 truncate text-sm">{lesson.title}</span>
                          <span className="shrink-0 text-[11px] text-faint">
                            {lesson.status === 'completed' && lesson.score != null
                              ? `${Math.round(lesson.score * 100)}%`
                              : statusLabel(lesson)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
