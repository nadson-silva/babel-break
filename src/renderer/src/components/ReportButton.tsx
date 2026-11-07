import { useState } from 'react'
import type { JSX } from 'react'
import type { ReportEffect, ReportInput, ReportItemView, ReportKind, ReportReason } from '../../../shared/types'
import { REASONS_BY_KIND } from '../../../shared/report-reasons'
import { t } from '../i18n'

interface ReportButtonProps {
  kind: ReportKind
  targetId?: number | null
  /** Trecho que o aluno está contestando (enunciado, frase corrigida…). */
  text?: string
  replacement?: string
  tag?: string
  /** Rótulo curto alternativo para espaços apertados. */
  compact?: boolean
  onReported?: (report: ReportItemView) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Tradução do motivo, indexada pela chave estável (nunca por parse de texto). */
function reasonLabel(reason: ReportReason): string {
  return (t.reports.reason as Record<string, string>)[reason] ?? reason
}

function effectMessage(effect: ReportEffect): string {
  return (t.reports.effect as Record<string, string>)[effect] ?? t.reports.sent
}

/**
 * Botão de "reportar conteúdo ruim" (M5). Um clique abre o menu de motivos; o
 * report tem efeito imediato (remover exercício, marcar a explicação para
 * reescrever, tirar a correção do foco) e é reversível — o aviso de confirmação
 * traz o "desfazer".
 */
export function ReportButton({
  kind,
  targetId = null,
  text,
  replacement,
  tag,
  compact,
  onReported
}: ReportButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason>(REASONS_BY_KIND[kind][0])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<ReportItemView | null>(null)

  async function send(): Promise<void> {
    setBusy(true)
    setError(null)

    const input: ReportInput = {
      kind,
      targetId,
      reason,
      note: note.trim() || undefined,
      context: { text, replacement, tag }
    }

    try {
      const report = await window.api.report.submit(input)
      setDone(report)
      setOpen(false)
      onReported?.(report)
    } catch (submitError) {
      setError(messageOf(submitError))
    } finally {
      setBusy(false)
    }
  }

  async function undo(): Promise<void> {
    if (!done) return
    try {
      await window.api.report.undo(done.id)
      setDone(null)
      setNote('')
    } catch (undoError) {
      setError(messageOf(undoError))
    }
  }

  if (done) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-accent">
        <span>{effectMessage(done.effect)}</span>
        <button
          type="button"
          onClick={() => void undo()}
          className="underline underline-offset-2 text-muted hover:text-ink"
        >
          {t.reports.undo}
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t.reports.button}
        className="inline-flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-warn"
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-3.5" aria-hidden="true">
          <path
            d="M7 10.5 4.8 20h2.4l1-4.5M7 10.5h7.4c1 0 1.9-.7 2-1.7l.6-4.2c.2-1.4-.9-2.6-2.3-2.6L13 4l-1 3.5H7v3Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M7 15.5h9.6c1.2 0 2.2-1 2.2-2.2V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {compact ? t.reports.buttonShort : t.reports.button}
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-warn/40 bg-warn-soft/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warn">{t.reports.title}</div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {REASONS_BY_KIND[kind].map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setReason(entry)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
              reason === entry
                ? 'border-warn/60 bg-warn/15 text-ink'
                : 'border-line bg-panel text-muted hover:text-ink'
            }`}
          >
            {reasonLabel(entry)}
          </button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        placeholder={t.reports.notePlaceholder}
        className="mt-2 w-full resize-none rounded-lg border border-line bg-panel px-3 py-2 text-xs text-ink outline-none placeholder:text-faint focus:border-warn/50"
      />

      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}

      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          className="rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
        >
          {t.reports.cancel}
        </button>
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy}
          className="rounded-lg bg-warn px-3 py-1.5 text-xs font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t.common.saving : t.reports.send}
        </button>
      </div>
    </div>
  )
}
