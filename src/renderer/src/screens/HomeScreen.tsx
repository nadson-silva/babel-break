import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { HomeState, LessonSummary, SettingsPayload } from '../../../shared/types'
import { t } from '../i18n/pt-BR'

interface HomeScreenProps {
  settings: SettingsPayload
  onOpenLesson: (lessonId: number) => void
  onOpenCatalog: () => void
  onOpenSettings: () => void
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

export function HomeScreen({
  settings,
  onOpenLesson,
  onOpenCatalog,
  onOpenSettings
}: HomeScreenProps): JSX.Element {
  const [data, setData] = useState<HomeState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const started = useRef(false)

  const model = settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel

  async function load(): Promise<void> {
    const state = await window.api.learning.home.get()
    setData(state)
    return
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
                {t.chat.openSettings}
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
                {generating ? `${t.home.generating}` : t.home.generateCta}
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

                {data.nextLesson && (
                  <section className="rounded-2xl border border-line bg-panel p-5">
                    <div className="text-[10px] uppercase tracking-wider text-faint">
                      {t.home.nextTitle}
                    </div>
                    <h2 className="mt-2 text-base font-semibold">{data.nextLesson.title}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {t.home.nextBody
                        .replace('{title}', data.nextLesson.title)
                        .replace('{level}', data.nextLesson.level)}
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenLesson(data.nextLesson!.id)}
                      className="mt-4 rounded-lg border border-line px-4 py-2 text-xs font-medium text-ink transition-colors hover:border-accent/50 hover:text-accent"
                    >
                      {t.home.nextCta}
                    </button>
                  </section>
                )}

                {!data.continueLesson && !data.nextLesson && (
                  <section className="rounded-2xl border border-line bg-panel p-5 md:col-span-2">
                    <h2 className="text-base font-semibold">{t.home.emptyTitle}</h2>
                    <p className="mt-1 text-xs text-muted">{t.home.emptyBody}</p>
                  </section>
                )}
              </div>

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

              <section className="space-y-3">
                {data.units.map((unit) => (
                  <div key={unit.id} className="rounded-2xl border border-line bg-panel p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold">{unit.title}</h2>
                        {unit.description && (
                          <p className="mt-0.5 text-xs text-muted">{unit.description}</p>
                        )}
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

              <button
                type="button"
                onClick={onOpenCatalog}
                className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted transition-colors hover:border-accent/40 hover:text-ink"
              >
                {t.home.catalogCta}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
