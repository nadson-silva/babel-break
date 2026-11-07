import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { CurriculumView, LessonSummary, SettingsPayload } from '../../../shared/types'
import { t } from '../i18n'

interface LessonsScreenProps {
  settings: SettingsPayload
  onOpenLesson: (lessonId: number) => void
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

export function LessonsScreen({ settings, onOpenLesson, onOpenSettings }: LessonsScreenProps): JSX.Element {
  const [curriculum, setCurriculum] = useState<CurriculumView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const started = useRef(false)

  const model = settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel

  async function load(): Promise<void> {
    setCurriculum(await window.api.learning.curriculum.get())
  }

  async function generate(): Promise<void> {
    setGenerating(true)
    setError(null)

    try {
      setCurriculum(await window.api.learning.curriculum.generate())
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
        const view = await window.api.learning.curriculum.get()
        if (!alive) return
        setCurriculum(view)

        if (!view.generated && model) {
          setGenerating(true)
          const generated = await window.api.learning.curriculum.generate()
          if (alive) setCurriculum(generated)
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

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div>
          <h1 className="text-base font-semibold">{t.lessons.title}</h1>
          <p className="text-xs text-muted">{t.lessons.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
        >
          {t.common.refresh}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-4 pb-8">
          {error && (
            <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
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

          {!curriculum || !curriculum.generated ? (
            <section className="rounded-2xl border border-line bg-panel p-8 text-center">
              <h2 className="text-base font-semibold">{t.lessons.emptyTitle}</h2>
              <p className="mt-1 text-sm text-muted">{t.lessons.emptyBody}</p>
              <button
                type="button"
                onClick={() => void generate()}
                disabled={generating || !model}
                className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? t.lessons.generating : t.lessons.generate}
              </button>
            </section>
          ) : (
            curriculum.units.map((unit) => (
              <section key={unit.id} className="rounded-2xl border border-line bg-panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">{unit.title}</h2>
                    {unit.description && <p className="mt-0.5 text-xs text-muted">{unit.description}</p>}
                  </div>
                  <span className="shrink-0 rounded-full bg-panel-2 px-2.5 py-1 text-[10px] uppercase tracking-wider text-faint">
                    {unit.level}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {unit.lessons.map((lesson) => (
                    <button
                      key={lesson.id}
                      type="button"
                      onClick={() => onOpenLesson(lesson.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-line-soft bg-panel-2/50 px-4 py-3 text-left transition-colors hover:border-accent/40 hover:bg-panel-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{lesson.title}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                          <span>{statusLabel(lesson)}</span>
                          {/* M5: conteúdo já no banco = abre sem IA e sem espera. */}
                          {lesson.hasContent && (
                            <span className="rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-faint">
                              {t.lessons.readyOffline}
                            </span>
                          )}
                          {lesson.status === 'completed' && lesson.score != null && (
                            <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-accent">
                              {t.lessons.score} {Math.round(lesson.score * 100)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted">
                        {lesson.status === 'completed' ? t.lessons.review : t.lessons.open} →
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
