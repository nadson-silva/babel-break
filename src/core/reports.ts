/**
 * Reportar conteúdo ruim (M5) — o que o **main** faz com um report.
 *
 * A taxonomia (tipos, motivos, efeitos) mora em `shared/report-reasons.ts` porque
 * o menu do renderer e o efeito do processo main precisam das mesmas chaves. Aqui
 * fica o resto: reexportos para o lado do main e o recorte de texto que vai no
 * registro do banco.
 */
export {
  REPORT_KINDS,
  REPORT_REASONS,
  REASONS_BY_KIND,
  effectFor,
  isReportKind,
  isReportReason,
  reasonFor
} from '../shared/report-reasons'

export type { ReportEffect, ReportKind, ReportReason } from '../shared/report-reasons'

/** Recorte do texto reportado que vai no registro (evita banco gigante). */
export function snapshotText(value: string | null | undefined, limit = 240): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed
}
