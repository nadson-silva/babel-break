import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  FocusTrackView,
  LessonSummary,
  SettingsPayload,
  TrackPlanLesson,
  TracksView
} from '../../../shared/types'
import { t } from '../i18n'

interface TracksScreenProps {
  settings: SettingsPayload
  onOpenLesson: (lessonId: number) => void
  /** Abre o roleplay de uma lição de foco (tela do tutor em modo cenário). */
  onOpenScenario: (lessonId: number) => void
  onOpenSettings: () => void
  /** Objetivo vindo do onboarding: pré-enche o campo de trilha. */
  initialObjective?: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusDot(lesson: LessonSummary): string {
  if (lesson.status === 'completed') return 'bg-accent'
  if (lesson.status === 'in_progress') return 'bg-warn'
  return 'bg-faint/50'
}

function statusLabel(lesson: LessonSummary): string {
  if (lesson.status === 'completed') return t.lessons.statusCompleted
  if (lesson.status === 'in_progress') return t.lessons.statusInProgress
  return t.lessons.statusNotStarted
}

function planLessons(track: FocusTrackView): TrackPlanLesson[] {
  return (
    track.plan?.lessons ??
    track.lessons.map((lesson) => ({ title: lesson.title, objective: '', focusVocabulary: [] }))
  )
}

/** Rascunho em revisão: o aluno mexe no esboço antes de ele virar lição. */
function DraftEditor({
  track,
  lessons,
  onChange,
  onApprove,
  onDiscard,
  onRegenerate,
  busy
}: {
  track: FocusTrackView
  lessons: TrackPlanLesson[]
  onChange: (lessons: TrackPlanLesson[]) => void
  onApprove: () => void
  onDiscard: () => void
  onRegenerate: () => void
  busy: boolean
}): JSX.Element {
  function update(index: number, patch: Partial<TrackPlanLesson>): void {
    onChange(lessons.map((lesson, position) => (position === index ? { ...lesson, ...patch } : lesson)))
  }

  return (
    <section className="rounded-2xl border border-accent/40 bg-accent-soft/20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-accent">{t.tracks.draftTitle}</div>
          <h2 className="mt-1 text-base font-semibold">{track.title}</h2>
          {track.objective && <p className="mt-0.5 text-xs text-muted">{track.objective}</p>}
        </div>
        <span className="shrink-0 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] text-muted">
          {t.tracks.level} {track.levelRange ?? '—'}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted">{t.tracks.draftHelp}</p>
      {track.plan?.source === 'fallback' && (
        <p className="mt-1 text-[11px] text-faint">{t.tracks.sourceLocal}</p>
      )}

      <ol className="mt-4 space-y-3">
        {lessons.map((lesson, index) => (
          <li key={`${index}-${lesson.title}`} className="rounded-xl border border-line bg-panel p-3">
            <div className="flex items-start gap-3">
              <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-panel-2 text-[11px] font-semibold text-muted">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  value={lesson.title}
                  onChange={(event) => update(index, { title: event.target.value })}
                  placeholder={t.tracks.lessonTitle}
                  className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent/50"
                />
                <input
                  value={lesson.objective}
                  onChange={(event) => update(index, { objective: event.target.value })}
                  placeholder={t.tracks.lessonObjective}
                  className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-muted outline-none focus:border-accent/50"
                />
                {lesson.focusVocabulary.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-faint">{t.tracks.vocabulary}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {lesson.focusVocabulary.map((term) => (
                        <span
                          key={term}
                          className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] text-ink"
                        >
                          {term}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onChange(lessons.filter((_, position) => position !== index))}
                disabled={lessons.length <= 3}
                className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-40"
              >
                {t.tracks.removeLesson}
              </button>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-[11px] text-faint">{t.tracks.addLessonHint}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy || lessons.length < 3}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? t.tracks.approving : t.tracks.approve}
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          className="rounded-xl border border-line px-4 py-2 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-50"
        >
          {t.tracks.regenerate}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="rounded-xl border border-line px-4 py-2 text-xs text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
        >
          {t.tracks.discard}
        </button>
      </div>
    </section>
  )
}

/** Cartão de trilha: progresso, lições e o cenário de fechamento. */
function TrackCard({
  track,
  expanded,
  onToggle,
  onOpenLesson,
  onOpenScenario,
  onArchive,
  onReactivate
}: {
  track: FocusTrackView
  expanded: boolean
  onToggle: () => void
  onOpenLesson: (lessonId: number) => void
  onOpenScenario: (lessonId: number) => void
  onArchive: () => void
  onReactivate: () => void
}): JSX.Element {
  const progress = track.totalCount > 0 ? Math.round((track.completedCount / track.totalCount) * 100) : 0

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onToggle} className="min-w-0 text-left">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{track.title}</h2>
            <span className="shrink-0 rounded-full bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-faint">
              {track.levelRange ?? '—'}
            </span>
          </div>
          {track.objective && <p className="mt-0.5 truncate text-xs text-muted">{track.objective}</p>}
          <p className="mt-1 text-[11px] text-faint">
            {t.tracks.progress
              .replace('{done}', String(track.completedCount))
              .replace('{total}', String(track.totalCount))}
          </p>
        </button>

        {track.status === 'active' ? (
          <button
            type="button"
            onClick={onArchive}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted transition-colors hover:text-ink"
          >
            {t.tracks.archive}
          </button>
        ) : (
          <button
            type="button"
            onClick={onReactivate}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted transition-colors hover:text-ink"
          >
            {t.tracks.reactivate}
          </button>
        )}
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>

      {expanded && (
        <div className="mt-4 space-y-2">
          {track.lessons.map((lesson) => (
            <div
              key={lesson.id}
              className="flex items-center gap-3 rounded-xl border border-line-soft bg-panel-2/50 px-4 py-3"
            >
              <span className={`size-1.5 shrink-0 rounded-full ${statusDot(lesson)}`} />
              <button
                type="button"
                onClick={() => onOpenLesson(lesson.id)}
                className="min-w-0 flex-1 text-left transition-colors hover:text-accent"
              >
                <div className="truncate text-sm font-medium">{lesson.title}</div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {statusLabel(lesson)} · {lesson.level}
                </div>
              </button>
              {lesson.isScenario && (
                <button
                  type="button"
                  onClick={() => onOpenScenario(lesson.id)}
                  className="shrink-0 rounded-lg border border-accent/40 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent-soft"
                >
                  {t.tracks.scenarioCta}
                </button>
              )}
            </div>
          ))}
          <p className="pt-1 text-[11px] leading-relaxed text-faint">{t.tracks.scenarioHint}</p>
        </div>
      )}
    </section>
  )
}

export function TracksScreen({
  settings,
  onOpenLesson,
  onOpenScenario,
  onOpenSettings,
  initialObjective
}: TracksScreenProps): JSX.Element {
  const [view, setView] = useState<TracksView | null>(null)
  const [objective, setObjective] = useState(initialObjective?.trim() ?? '')
  const [draft, setDraft] = useState<FocusTrackView | null>(null)
  const [lessons, setLessons] = useState<TrackPlanLesson[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [busy, setBusy] = useState<'create' | 'approve' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  const model = settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel

  const refresh = useCallback(async (): Promise<TracksView> => {
    const next = await window.api.tracks.list()
    setView(next)
    return next
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true

    void (async () => {
      try {
        const next = await refresh()
        const openDraft = next.drafts[0] ?? null
        if (openDraft) {
          setDraft(openDraft)
          setLessons(planLessons(openDraft))
        }
      } catch (loadError) {
        setError(messageOf(loadError))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function create(replaceId?: number): Promise<void> {
    const text = objective.trim() || view?.suggestions[0]?.objective || ''
    if (!text) return

    setBusy('create')
    setError(null)
    try {
      const track = await window.api.tracks.draft({ objective: text, replaceId })
      setObjective('')
      await refresh()
      setDraft(track)
      setLessons(planLessons(track))
    } catch (createError) {
      setError(messageOf(createError))
    } finally {
      setBusy(null)
    }
  }

  async function approve(): Promise<void> {
    if (!draft) return

    setBusy('approve')
    setError(null)
    try {
      await window.api.tracks.revise({ trackId: draft.id, lessons })
      await window.api.tracks.approve(draft.id)
      setDraft(null)
      setLessons([])
      await refresh()
    } catch (approveError) {
      setError(messageOf(approveError))
    } finally {
      setBusy(null)
    }
  }

  async function discard(): Promise<void> {
    if (!draft) return
    try {
      await window.api.tracks.discard(draft.id)
      setDraft(null)
      setLessons([])
      await refresh()
    } catch (discardError) {
      setError(messageOf(discardError))
    }
  }

  async function setStatus(trackId: number, status: 'active' | 'archived'): Promise<void> {
    try {
      await window.api.tracks.status({ trackId, status })
      await refresh()
    } catch (statusError) {
      setError(messageOf(statusError))
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">{t.tracks.title}</h1>
          <p className="text-xs text-muted">{t.tracks.subtitle}</p>
        </div>
        {view && (
          <span className="shrink-0 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted">
            {t.tracks.mixHint.replace('{percent}', String(Math.round(view.focusMix * 100)))}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-4 pb-8">
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
              <div className="font-medium">{t.tracks.errorTitle}</div>
              <div className="mt-1 leading-relaxed">{error}</div>
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

          <section className="rounded-2xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">{t.tracks.createTitle}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t.tracks.help}</p>

            <div className="mt-3 flex gap-2">
              <input
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void create()
                }}
                placeholder={t.tracks.createPlaceholder}
                className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50"
              />
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy !== null}
                className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {busy === 'create' ? t.tracks.creating : t.tracks.createCta}
              </button>
            </div>

            {view && view.suggestions.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wider text-faint">{t.tracks.suggestions}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {view.suggestions.map((suggestion) => (
                    <button
                      key={suggestion.title}
                      type="button"
                      onClick={() => {
                        setObjective(suggestion.objective)
                        void create()
                      }}
                      disabled={busy !== null}
                      className="rounded-full border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink transition-colors hover:border-accent/50 disabled:opacity-50"
                    >
                      {suggestion.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {draft && (
            <DraftEditor
              track={draft}
              lessons={lessons}
              onChange={setLessons}
              onApprove={() => void approve()}
              onDiscard={() => void discard()}
              onRegenerate={() => void create(draft.id)}
              busy={busy === 'approve'}
            />
          )}

          {view && view.active.length === 0 && view.drafts.length === 0 && view.archived.length === 0 && (
            <section className="rounded-2xl border border-line bg-panel p-8 text-center">
              <h2 className="text-base font-semibold">{t.tracks.emptyTitle}</h2>
              <p className="mt-1 text-sm text-muted">{t.tracks.emptyBody}</p>
            </section>
          )}

          {view?.active.map((track) => (
            <TrackCard
              key={track.id}
              track={track}
              expanded={expanded === track.id}
              onToggle={() => setExpanded(expanded === track.id ? null : track.id)}
              onOpenLesson={onOpenLesson}
              onOpenScenario={onOpenScenario}
              onArchive={() => void setStatus(track.id, 'archived')}
              onReactivate={() => void setStatus(track.id, 'active')}
            />
          ))}

          {view && view.archived.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-ink">{t.tracks.archivedTitle}</h2>
              {view.archived.map((track) => (
                <TrackCard
                  key={track.id}
                  track={track}
                  expanded={expanded === track.id}
                  onToggle={() => setExpanded(expanded === track.id ? null : track.id)}
                  onOpenLesson={onOpenLesson}
                  onOpenScenario={onOpenScenario}
                  onArchive={() => void setStatus(track.id, 'archived')}
                  onReactivate={() => void setStatus(track.id, 'active')}
                />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
