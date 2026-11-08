import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ExportFileView, ImportResultView, InspectView, ProfilesView } from '../../../shared/types'
import { t } from '../i18n'
import { targetLabel } from '../lang'
import { ProfileAvatar } from '../components/ProfileAvatar'

interface DataScreenProps {
  profiles: ProfilesView | null
  onImported: () => void
  onOpenProfiles: () => void
}

/** Chaves técnicas viram frase honesta — o usuário não precisa decodificar 'orphan-rows'. */
function failureText(view: Extract<InspectView, { ok: false }>): string {
  switch (view.code) {
    case 'no-source':
      return t.data.noFile
    case 'not-json':
      return t.data.badJson
    case 'unknown-app':
      return t.data.wrongApp
    case 'shape':
      return `${t.data.badShape}: ${view.errors.join('; ')}`
    case 'format-version':
    case 'schema-version':
      return `${t.data.versionMismatch} (${view.errors.join(', ')})`
    case 'orphan-rows':
      return `${t.data.orphanRows} (${view.errors.slice(0, 3).join(', ')})`
    case 'too-large':
      return t.data.tooLarge
    default:
      return t.data.unknownProblem
  }
}

function warningText(warning: string): string {
  if (warning.startsWith('stale-content:')) {
    return t.data.staleContent.replace('{count}', warning.slice('stale-content:'.length))
  }
  if (warning.startsWith('stale-exercises:')) {
    return t.data.staleExercises.replace('{count}', warning.slice('stale-exercises:'.length))
  }
  if (warning.startsWith('prompt:')) {
    return t.data.promptMismatch.replace('{version}', warning.slice('prompt:'.length))
  }
  if (warning === 'no-audio') return t.data.noAudioNote
  return warning
}

function noteText(note: string): string {
  if (note === 'needs-onboarding') return t.data.noteNeedsOnboarding
  if (note === 'no-lessons') return t.data.noteNoLessons
  return note
}

function countLine(counts: Record<string, number>): string {
  const pairs: Array<[string, string]> = [
    ['lessons', t.data.countLessons],
    ['exercises', t.data.countExercises],
    ['attempts', t.data.countAttempts],
    ['cards', t.data.countCards],
    ['errors', t.data.countErrors],
    ['conversations', t.data.countConversations],
    ['focus_tracks', t.data.countTracks],
    ['speech_runs', t.data.countSpeech],
    ['content_reports', t.data.countReports]
  ]
  const parts = pairs
    .filter(([key]) => (counts[key] ?? 0) > 0)
    .map(([key, label]) => `${counts[key]} ${label}`)
  return parts.length > 0 ? parts.join(' · ') : t.data.noteNoLessons
}

/**
 * V2: backup portável. Exporta **um perfil** para um arquivo JSON e importa de
 * volta como perfil novo — com o carimbo de versão decidido na porta, nunca
 * depois de escrever no banco.
 */
export function DataScreen({ profiles, onImported, onOpenProfiles }: DataScreenProps): JSX.Element {
  const list = profiles?.profiles ?? []
  const [exportId, setExportId] = useState<number>(profiles?.activeProfileId ?? 0)
  const [includeAudio, setIncludeAudio] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<ExportFileView | null>(null)
  const [inspectText, setInspectText] = useState('')
  const [inspected, setInspected] = useState<InspectView | null>(null)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResultView | null>(null)
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
    if (!exportId && profiles?.activeProfileId) setExportId(profiles.activeProfileId)
  }, [exportId, profiles?.activeProfileId])

  const runInspect = useCallback(async (input: { path?: string; json?: string }): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const view = await window.api.data.inspect(input)
      if (!alive.current) return
      setInspected(view)
      if (view.ok) setSourcePath(input.path ?? null)
    } catch (inspectError) {
      if (alive.current) setError(inspectError instanceof Error ? inspectError.message : String(inspectError))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  async function doExport(): Promise<void> {
    setExporting(true)
    setError(null)
    try {
      const view = await window.api.data.export({ profileId: exportId, includeAudio })
      if (!alive.current) return
      setExported(view)
      if (!view.cancelled) setInspected(null)
    } catch (exportError) {
      if (alive.current) setError(exportError instanceof Error ? exportError.message : String(exportError))
    } finally {
      if (alive.current) setExporting(false)
    }
  }

  async function pickAndInspect(): Promise<void> {
    setError(null)
    const picked = await window.api.data.pickFile()
    if (!picked || !alive.current) return
    await runInspect({ path: picked })
  }

  async function doImport(): Promise<void> {
    if (!sourcePath) return
    setBusy(true)
    setError(null)
    try {
      const view = await window.api.data.import({ path: sourcePath })
      if (!alive.current) return
      setResult(view)
      setInspected(null)
      setSourcePath(null)
      setInspectText('')
      onImported()
    } catch (importError) {
      if (alive.current) setError(importError instanceof Error ? importError.message : String(importError))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const okView = inspected?.ok ? inspected : null

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div>
          <h1 className="text-base font-semibold">{t.data.title}</h1>
          <p className="mt-0.5 text-xs text-muted">{t.data.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onOpenProfiles}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
        >
          {t.profiles.title}
        </button>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-8 py-6">
        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
            {error}
          </p>
        )}

        {/* --- exportação --------------------------------------------------- */}
        <section className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">{t.data.exportTitle}</h2>
          <p className="mt-1 text-xs text-muted">{t.data.exportHelp}</p>

          <div className="mt-4 space-y-2">
            {list.map((entry) => (
              <label
                key={entry.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
                  exportId === entry.id ? 'border-accent/60 bg-accent-soft' : 'border-line bg-panel-2 hover:text-ink'
                }`}
              >
                <input
                  type="radio"
                  name="export-profile"
                  checked={exportId === entry.id}
                  onChange={() => setExportId(entry.id)}
                  className="accent-[#4cc2a0]"
                />
                <ProfileAvatar
                  name={entry.name}
                  color={entry.color}
                  targetLang={entry.targetLang}
                  size="sm"
                  active={entry.active}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {entry.name?.trim() || targetLabel(entry.targetLang)}
                </span>
                <span className="shrink-0 text-[10px] text-faint">{countLine({
                  lessons: entry.completedLessons,
                  cards: entry.dueCards,
                  errors: entry.openErrors,
                  focus_tracks: entry.activeTracks
                })}</span>
              </label>
            ))}
          </div>

          <label className="mt-4 flex items-start gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={includeAudio}
              onChange={(event) => setIncludeAudio(event.target.checked)}
              className="mt-0.5 accent-[#4cc2a0]"
            />
            <span>{t.data.includeAudio}</span>
          </label>

          <button
            type="button"
            onClick={() => void doExport()}
            disabled={exporting || exportId === 0}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {exporting ? t.data.exporting : t.data.exportButton}
          </button>

          {exported && !exported.cancelled && (
            <div className="mt-4 rounded-xl border border-line bg-panel-2 p-4 text-xs">
              <p className="font-semibold text-ink">{t.data.savedTo.replace('{path}', exported.path ?? '')}</p>
              <p className="mt-1 text-muted">
                {countLine(exported.manifest.counts)} · {t.data.fileSize.replace('{kb}', String(Math.round(exported.bytes / 1024)))}
              </p>
              <p className="mt-1 text-[10px] text-faint">
                {t.data.formatStamp.replace('{format}', String(exported.manifest.format)).replace('{schema}', String(exported.manifest.schemaVersion)).replace('{app}', exported.manifest.appVersion)}
              </p>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-faint">{t.data.noSecrets}</p>
        </section>

        {/* --- importação --------------------------------------------------- */}
        <section className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">{t.data.importTitle}</h2>
          <p className="mt-1 text-xs text-muted">{t.data.importHelp}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void pickAndInspect()}
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {t.data.pickFile}
            </button>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted transition-colors hover:text-ink">
              {t.data.pasteToggle}
            </summary>
            <textarea
              value={inspectText}
              onChange={(event) => setInspectText(event.target.value)}
              spellCheck={false}
              rows={4}
              placeholder='{ "manifest": { "app": "language-teacher", … } }'
              className="mt-2 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[11px] text-ink outline-none placeholder:text-faint focus:border-accent/50"
            />
            <button
              type="button"
              onClick={() => void runInspect({ json: inspectText })}
              disabled={busy || inspectText.trim().length === 0}
              className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-50"
            >
              {t.data.inspectJson}
            </button>
          </details>

          {inspected && !inspected.ok && (
            <p role="alert" className="mt-4 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
              {failureText(inspected)}
            </p>
          )}

          {okView && (
            <div className="mt-4 space-y-3 rounded-xl border border-warn/30 bg-warn-soft p-4">
              <p className="text-xs font-semibold text-ink">
                {okView.manifest.profile.name?.trim() || targetLabel(okView.manifest.profile.targetLang)} ·{' '}
                {targetLabel(okView.manifest.profile.targetLang)}
              </p>
              <p className="text-xs text-ink">{countLine(okView.counts)}</p>
              <p className="text-[10px] text-muted">
                {t.data.formatStamp
                  .replace('{format}', String(okView.manifest.format))
                  .replace('{schema}', String(okView.manifest.schemaVersion))
                  .replace('{app}', okView.manifest.appVersion)}
              </p>
              {okView.warnings.map((warning) => (
                <p key={warning} className="text-[11px] text-ink">
                  {warningText(warning)}
                </p>
              ))}
              {okView.notes.map((note) => (
                <p key={note} className="text-[11px] text-muted">
                  {noteText(note)}
                </p>
              ))}
              <button
                type="button"
                onClick={() => void doImport()}
                disabled={busy || !sourcePath}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {busy ? t.data.importing : t.data.importButton}
              </button>
              {!sourcePath && <p className="text-[11px] text-muted">{t.data.pasteImportHint}</p>}
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-xl border border-line bg-panel-2 p-4 text-xs">
              <p className="font-semibold text-ink">
                {t.data.imported.replace('{name}', result.name?.trim() || targetLabel(result.targetLang))}
              </p>
              <p className="mt-1 text-muted">{countLine(result.counts)}</p>
              {result.audioSkipped > 0 && (
                <p className="mt-1 text-muted">{t.data.audioSkipped.replace('{count}', String(result.audioSkipped))}</p>
              )}
              {result.stale.lessonContent + result.stale.exercises > 0 && (
                <p className="mt-1 text-muted">
                  {t.data.staleAfterImport.replace(
                    '{count}',
                    String(result.stale.lessonContent + result.stale.exercises)
                  )}
                </p>
              )}
              {result.warnings.length > 0 && (
                <p className="mt-1 text-[11px] text-danger">
                  {t.data.rowsDropped.replace('{count}', String(result.warnings.length))}
                </p>
              )}
              <button
                type="button"
                onClick={onOpenProfiles}
                className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel hover:text-ink"
              >
                {t.profiles.title}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
