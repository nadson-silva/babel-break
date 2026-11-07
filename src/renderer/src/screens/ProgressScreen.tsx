import { useCallback, useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { DashboardView, ReportItemView, StudyKind } from '../../../shared/types'
import { getUiLanguage, t } from '../i18n'
import { formatBytes } from '../lib/format'

interface ProgressScreenProps {
  /** Vai para Configurações (cache/pré-geração) sem sair do painel. */
  onOpenSettings: () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function kindLabel(kind: StudyKind): string {
  switch (kind) {
    case 'lesson':
      return t.progress.kindLesson
    case 'conversation':
      return t.progress.kindConversation
    case 'guided':
      return t.progress.kindGuided
    default:
      return t.progress.kindReview
  }
}

/** Tempo em "1 h 20 min" ou "45 min" — o painel não mostra números crus de minutos. */
function timeLabel(minutes: number): string {
  if (minutes < 60) return t.progress.minutesUnit.replace('{count}', String(Math.max(0, Math.round(minutes))))
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return t.progress.hoursUnit.replace('{hours}', String(hours)).replace('{minutes}', String(rest))
}

function lastActivityLabel(timestamp: number | null): string {
  if (timestamp == null) return t.progress.lastActivityNone
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (days <= 0) return `${t.progress.lastActivityToday}`
  return t.progress.lastActivityDays.replace('{count}', String(days))
}

function dayLabel(day: string): string {
  // 'aaaa-mm-dd' → dia do mês, sem fuso: o bucket já é local.
  const parts = day.split('-')
  return parts[2] ?? ''
}

function percent(value: number | null | undefined): string {
  return value == null ? '—' : `${value}%`
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-line-soft bg-panel-2 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-1 text-lg font-semibold leading-tight text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** Barras dos últimos 30 dias. Altura = minutos; buraco não é penalidade. */
function ActivityChart({ data }: { data: DashboardView['time']['perDay'] }): JSX.Element {
  const max = Math.max(1, ...data.map((entry) => entry.minutes))

  return (
    <div>
      <div className="flex h-20 items-end gap-1">
        {data.map((entry) => {
          const ratio = entry.minutes / max
          return (
            <div
              key={entry.day}
              title={`${entry.day} · ${timeLabel(entry.minutes)} · ${entry.exercises} ex. · ${entry.reviews} cards`}
              className={`min-w-0 flex-1 rounded-t-sm transition-colors ${
                entry.minutes > 0 ? 'bg-accent/70 hover:bg-accent' : 'bg-panel-2'
              }`}
              style={{ height: `${Math.max(entry.minutes > 0 ? 8 : 3, Math.round(ratio * 100))}%` }}
            />
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-faint">
        <span>{dayLabel(data[0]?.day ?? '')}</span>
        <span>{t.progress.activityHelp}</span>
        <span>{dayLabel(data[data.length - 1]?.day ?? '')}</span>
      </div>
    </div>
  )
}

function Bar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'warn' }): JSX.Element {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
      <div
        className={`h-full rounded-full ${tone === 'accent' ? 'bg-accent' : 'bg-warn'}`}
        style={{ width: `${Math.min(100, Math.max(2, value))}%` }}
      />
    </div>
  )
}

function ReportRow({ report, onUndo }: { report: ReportItemView; onUndo: (id: number) => void }): JSX.Element {
  const reason = (t.reports.reason as Record<string, string>)[report.reason] ?? report.reason
  const effect = (t.reports.effect as Record<string, string>)[report.effect] ?? ''

  return (
    <div className="flex items-start justify-between gap-3 py-2 text-xs">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-ink">{reason}</span>
          {report.targetLabel && <span className="truncate text-faint">· {report.targetLabel}</span>}
          <span className="text-faint">
            · {new Date(report.createdAt).toLocaleDateString(getUiLanguage())}
          </span>
        </div>
        {report.text && (
          <p className="mt-0.5 truncate text-muted" dir="auto">
            {report.text}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-faint">{effect}</p>
      </div>
      {report.undoneAt == null ? (
        <button
          type="button"
          onClick={() => onUndo(report.id)}
          className="shrink-0 text-[11px] text-muted underline underline-offset-2 hover:text-ink"
        >
          {t.progress.reportUndoAll}
        </button>
      ) : (
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-faint">↩</span>
      )}
    </div>
  )
}

export function ProgressScreen({ onOpenSettings }: ProgressScreenProps): JSX.Element {
  const [view, setView] = useState<DashboardView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      setView(await window.api.dashboard.get())
      setError(null)
    } catch (loadError) {
      setError(messageOf(loadError))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function undoReport(reportId: number): Promise<void> {
    await window.api.report.undo(reportId)
    await load()
  }

  const time = view?.time
  const lessons = view?.lessons
  const vocabulary = view?.vocabulary
  const errors = view?.errors

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">{t.progress.title}</h1>
          <p className="truncate text-xs text-muted">{t.progress.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-50"
        >
          {refreshing ? '…' : t.common.refresh}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">{error}</div>
          )}

          {!view ? (
            <div className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted">
              {t.common.loading}
            </div>
          ) : (
            <>
              <Section title={t.progress.timeTitle}>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat label={t.progress.timeTotal} value={timeLabel(time?.totalMinutes ?? 0)} />
                  <Stat label={t.progress.time7} value={timeLabel(time?.last7DaysMinutes ?? 0)} />
                  <Stat label={t.progress.time30} value={timeLabel(time?.last30DaysMinutes ?? 0)} />
                  <Stat
                    label={t.progress.practiceDaysLabel}
                    value={String(time?.practiceDays ?? 0)}
                    hint={t.progress.practiceDaysHelp}
                  />
                </div>

                <p className="mt-3 text-xs text-muted">
                  {t.progress.lastActivity.replace('{when}', lastActivityLabel(time?.lastActivityAt ?? null))}
                </p>

                {time && time.perDay.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-[10px] uppercase tracking-wider text-faint">{t.progress.activityTitle}</div>
                    <ActivityChart data={time.perDay} />
                  </div>
                )}

                {(time?.byKind.length ?? 0) > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-faint">{t.progress.byKindTitle}</div>
                    {time?.byKind.map((entry) => {
                      const total = Math.max(1, time.totalMinutes)
                      return (
                        <div key={entry.kind} className="flex items-center gap-3 text-xs">
                          <span className="w-32 shrink-0 text-muted">{kindLabel(entry.kind)}</span>
                          <div className="min-w-0 flex-1">
                            <Bar value={(entry.minutes / total) * 100} />
                          </div>
                          <span className="w-24 shrink-0 text-right text-faint">
                            {timeLabel(entry.minutes)} · {entry.sessions}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>

              <div className="grid gap-5 md:grid-cols-2">
                <Section title={t.progress.lessonsTitle}>
                  <div className="text-sm text-ink">
                    {t.progress.lessonsProgress
                      .replace('{done}', String(lessons?.completed ?? 0))
                      .replace('{total}', String(lessons?.total ?? 0))}
                  </div>
                  <div className="mt-3">
                    <Bar
                      value={
                        lessons && lessons.total > 0 ? (lessons.completed / Math.max(1, lessons.total)) * 100 : 0
                      }
                    />
                  </div>
                  <ul className="mt-3 space-y-1 text-xs text-muted">
                    <li>{t.progress.lessonsInProgress.replace('{count}', String(lessons?.inProgress ?? 0))}</li>
                    <li>
                      {t.progress.averageScore.replace('{percent}', percent(lessons?.averageScore ?? null))}
                    </li>
                    <li>{t.progress.cacheLessons.replace('{cached}', String(lessons?.cached ?? 0)).replace('{total}', String(lessons?.total ?? 0))}</li>
                    <li>{t.progress.cachePrewarmed.replace('{count}', String(lessons?.prewarmed ?? 0))}</li>
                  </ul>
                </Section>

                <Section title={t.progress.vocabTitle}>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span>{t.progress.vocabCards.replace('{count}', String(vocabulary?.total ?? 0))}</span>
                    <span>{t.progress.vocabMastered.replace('{count}', String(vocabulary?.mastered ?? 0))}</span>
                    <span>{t.progress.vocabLearning.replace('{count}', String(vocabulary?.learning ?? 0))}</span>
                    <span>{t.progress.vocabFresh.replace('{count}', String(vocabulary?.fresh ?? 0))}</span>
                    <span>{t.progress.vocabDue.replace('{count}', String(vocabulary?.due ?? 0))}</span>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    {vocabulary?.passRate == null
                      ? t.progress.passRateNone
                      : t.progress.passRate.replace('{percent}', String(vocabulary.passRate))}
                  </p>

                  {(vocabulary?.strongest.length ?? 0) > 0 && (
                    <div className="mt-4 space-y-2">
                      <div className="text-[10px] uppercase tracking-wider text-faint">{t.progress.strongestTitle}</div>
                      {vocabulary?.strongest.map((card) => (
                        <div key={`${card.term}-${card.reps}`} className="flex items-center gap-3 text-xs">
                          <span className="w-40 min-w-0 shrink-0 truncate text-ink" dir="auto">
                            {card.term}
                          </span>
                          <div className="min-w-0 flex-1">
                            <Bar value={Math.round((card.retention ?? 0) * 100)} />
                          </div>
                          <span className="w-20 shrink-0 text-right text-faint">
                            {t.progress.retentionLabel.replace('{percent}', String(Math.round((card.retention ?? 0) * 100)))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>

              <Section title={t.progress.errorsTitle}>
                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <span>{t.progress.errorsOpen.replace('{count}', String(errors?.open ?? 0))}</span>
                  <span>{t.progress.errorsResolved.replace('{count}', String(errors?.resolved ?? 0))}</span>
                  <span>{t.progress.errorsDisputed.replace('{count}', String(errors?.disputed ?? 0))}</span>
                </div>
                {errors?.resolvedRate != null && (
                  <p className="mt-2 text-xs text-muted">
                    {t.progress.errorsResolvedRate.replace('{percent}', String(errors.resolvedRate))}
                  </p>
                )}
                {errors && errors.bankHits > 0 && (
                  <p className="mt-1 text-xs text-accent">{t.progress.errorsBankHits.replace('{count}', String(errors.bankHits))}</p>
                )}

                {(errors?.topTags.length ?? 0) > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-faint">{t.progress.topTagsTitle}</div>
                    {errors?.topTags.map((tag) => {
                      const max = Math.max(...errors.topTags.map((entry) => entry.occurrences), 1)
                      return (
                        <div key={tag.tag} className="flex items-center gap-3 text-xs">
                          <span className="w-40 shrink-0 truncate text-ink">{tag.tag}</span>
                          <div className="min-w-0 flex-1">
                            <Bar value={(tag.occurrences / max) * 100} tone={tag.disputed ? 'warn' : 'accent'} />
                          </div>
                          <span className="w-24 shrink-0 text-right text-faint">
                            {tag.occurrences}x{tag.disputed ? ` · ${t.progress.disputedBadge}` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>

              <div className="grid gap-5 md:grid-cols-2">
                <Section title={t.progress.tracksTitle}>
                  {view.tracks.length === 0 ? (
                    <p className="text-xs text-muted">{t.progress.trackEmpty}</p>
                  ) : (
                    <div className="space-y-3">
                      {view.tracks.map((track) => (
                        <div key={track.id} className="text-xs">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate font-medium text-ink">{track.title}</span>
                            <span className="shrink-0 text-faint">
                              {t.progress.trackProgress
                                .replace('{done}', String(track.completed))
                                .replace('{total}', String(track.total))}
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <Bar value={track.total > 0 ? (track.completed / track.total) * 100 : 0} />
                          </div>
                          {track.scenarios > 0 && (
                            <p className="mt-1 text-[11px] text-muted">
                              {t.progress.trackScenarios.replace('{count}', String(track.scenarios))}
                              {track.avgContentScore != null
                                ? ` · ${t.progress.trackScores
                                    .replace('{content}', percent(track.avgContentScore))
                                    .replace('{language}', percent(track.avgLanguageScore))}`
                                : ''}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title={t.progress.scenariosTitle}>
                  <p className="text-xs text-ink">
                    {view.scenarios.runs === 0
                      ? t.progress.scenarioNone
                      : t.progress.scenarioRuns.replace('{count}', String(view.scenarios.runs))}
                  </p>
                  {view.scenarios.runs > 0 && (
                    <p className="mt-1 text-xs text-muted">
                      {t.progress.scenarioAvg
                        .replace('{content}', percent(view.scenarios.avgContentScore))
                        .replace('{language}', percent(view.scenarios.avgLanguageScore))}
                    </p>
                  )}

                  <div className="mt-4">
                    <div className="text-[10px] uppercase tracking-wider text-faint">{t.progress.cacheTitle}</div>
                    <p className="mt-1 text-xs text-muted">
                      {t.cache.stats
                        .replace('{cached}', String(view.cache.lessonsCached))
                        .replace('{total}', String(view.cache.lessonsTotal))
                        .replace('{exercises}', String(view.cache.exercisesCached))
                        .replace('{prewarmed}', String(view.cache.prewarmedLessons))}
                    </p>
                    <p className="mt-1 text-[11px] text-faint">{t.cache.size.replace('{size}', formatBytes(view.cache.dbBytes, getUiLanguage()))}</p>
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="mt-2 rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-accent"
                    >
                      {t.common.openSettings}
                    </button>
                  </div>
                </Section>
              </div>

              <Section title={t.progress.reportsTitle}>
                {view.reports.recent.length === 0 ? (
                  <p className="text-xs text-muted">{t.progress.reportsEmpty}</p>
                ) : (
                  <div className="divide-y divide-line-soft">
                    <p className="pb-2 text-[11px] text-faint">
                      {t.progress.reportsCount.replace('{count}', String(view.reports.total))}
                    </p>
                    {view.reports.recent.map((report) => (
                      <ReportRow key={report.id} report={report} onUndo={(id) => void undoReport(id)} />
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
