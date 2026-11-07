import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { NotebookTag, NotebookView } from '../../../shared/types'
import { t } from '../i18n'
import { pairCodeLabel, nativeLabel } from '../lang'
import { TargetText } from '../components/TargetText'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function categoryLabel(category: string): string {
  if (category === 'conversation') return t.notebook.fromChat
  if (category === 'exercise') return t.notebook.fromExercise
  return category
}

function sourceLabel(source: string | null): string | null {
  if (source === 'local') return t.notebook.fromLocal
  if (source === 'bank') return t.notebook.fromBank.replace('{pair}', pairCodeLabel())
  return null
}

function bankTitle(view: NotebookView | null): string {
  const pair = view?.bankPair
    ? `${view.bankPair.native.toUpperCase()}→${view.bankPair.target.toUpperCase()}`
    : pairCodeLabel()
  return t.notebook.bankTitle.replace('{pair}', pair)
}

function TagGroup({
  tag,
  onToggle
}: {
  tag: NotebookTag
  onToggle: (errorId: number, resolved: boolean) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-2xl border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{tag.tag}</span>
            <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-faint">
              {t.notebook.occurrences.replace('{count}', String(tag.occurrences))}
            </span>
            {tag.resolved && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent">
                {t.notebook.resolved}
              </span>
            )}
          </div>
          {!open && tag.examples[0] && (
            <p className="mt-1 truncate text-xs text-muted">
              {tag.examples[0].original} → {tag.examples[0].corrected}
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs text-faint">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line-soft px-5 py-4">
          {tag.examples.map((example) => (
            <div key={example.id} className="rounded-xl bg-panel-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                <TargetText className="text-danger/90 line-through decoration-danger/40">{example.original}</TargetText>
                <span className="text-faint">→</span>
                <TargetText className="font-medium text-accent">{example.corrected}</TargetText>
              </div>
              {example.note && <p className="mt-1 text-xs leading-relaxed text-muted">{example.note}</p>}
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-wider text-faint">
                  {categoryLabel(example.category)}
                  {sourceLabel(example.source) ? ` · ${sourceLabel(example.source)}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => onToggle(example.id, !tag.resolved)}
                  className="text-[11px] text-muted underline underline-offset-2 hover:text-ink"
                >
                  {tag.resolved ? t.notebook.reopen : t.notebook.markResolved}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function NotebookScreen(): JSX.Element {
  const [view, setView] = useState<NotebookView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showBank, setShowBank] = useState(false)
  const [filter, setFilter] = useState<'open' | 'all'>('open')

  const load = useCallback(async (): Promise<void> => {
    try {
      setView(await window.api.notebook.get())
      setError(null)
    } catch (loadError) {
      setError(messageOf(loadError))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(errorId: number, resolved: boolean): Promise<void> {
    await window.api.notebook.resolve(errorId, resolved)
    await load()
  }

  const tags = (view?.tags ?? []).filter((tag) => (filter === 'open' ? !tag.resolved : true))

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div>
          <h1 className="text-base font-semibold">{t.notebook.title}</h1>
          <p className="text-xs text-muted">{t.notebook.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-line bg-panel p-0.5 text-xs">
            {(['open', 'all'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`rounded-md px-3 py-1 transition-colors ${
                  filter === option ? 'bg-panel-2 text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {option === 'open' ? t.notebook.open : t.notebook.filterAll}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowBank((value) => !value)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {bankTitle(view)}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
              {error}
            </div>
          )}

          {showBank && (
            <section className="rounded-2xl border border-line bg-panel p-5">
              <h2 className="text-sm font-semibold">{bankTitle(view)}</h2>
              {view && view.bankPair === null ? (
                <p className="mt-1 text-xs leading-relaxed text-muted">{t.notebook.bankEmpty}</p>
              ) : (
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {t.notebook.bankHelp.replace('{native}', nativeLabel())}
                </p>
              )}
              {view && view.bankHits > 0 && (
                <p className="mt-2 text-xs text-accent">
                  {t.notebook.bankHits.replace('{count}', String(view.bankHits))}
                </p>
              )}
              <div className="mt-4 space-y-2">
                {view?.bank.map((entry) => (
                  <div key={entry.wrong} className="rounded-xl bg-panel-2 px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                      <TargetText className="text-danger/90 line-through decoration-danger/40">{entry.wrong}</TargetText>
                      <span className="text-faint">→</span>
                      <TargetText className="font-medium text-accent">{entry.right}</TargetText>
                      <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] text-faint">{entry.tag}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{entry.note}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!view ? (
            <div className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted">
              {t.common.loading}
            </div>
          ) : tags.length === 0 ? (
            <section className="rounded-2xl border border-line bg-panel p-8 text-center">
              <h2 className="text-base font-semibold">{t.notebook.emptyTitle}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{t.notebook.emptyBody}</p>
            </section>
          ) : (
            <>
              <div className="text-xs text-faint">
                {t.notebook.tagCount.replace('{count}', String(view.openCount))}
              </div>
              {tags.map((tag) => (
                <TagGroup key={tag.tag} tag={tag} onToggle={(id, resolved) => void toggle(id, resolved)} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
