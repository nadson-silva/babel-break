/**
 * Taxonomia de "reportar conteúdo ruim" (M5) — em `shared/` porque os dois lados
 * do app precisam dela: o main para aplicar o efeito e o renderer para montar o
 * menu, sem esperar um round-trip de IPC.
 *
 * Os textos exibidos não moram aqui: cada motivo é uma chave estável, traduzida
 * pelos dicionários do renderer (`t.reports.reason.*`).
 */
export type ReportKind =
  | 'exercise'
  | 'lesson_content'
  | 'correction'
  | 'scenario'
  | 'track_plan'
  | 'chat_reply'

export type ReportReason =
  | 'wrong_answer'
  | 'unfair_correction'
  | 'confusing'
  | 'off_topic'
  | 'level_mismatch'
  | 'duplicate'
  | 'broken_text'
  | 'not_helpful'
  | 'other'

/** O que o app faz com cada report (o renderer traduz por chave). */
export type ReportEffect = 'exercise-removed' | 'content-regenerates' | 'error-unfocused' | 'logged'

export const REPORT_KINDS: ReportKind[] = [
  'exercise',
  'lesson_content',
  'correction',
  'scenario',
  'track_plan',
  'chat_reply'
]

/** Ordem canônica dos motivos; a UI filtra por tipo e mostra nesta ordem. */
export const REPORT_REASONS: ReportReason[] = [
  'wrong_answer',
  'unfair_correction',
  'confusing',
  'level_mismatch',
  'off_topic',
  'duplicate',
  'broken_text',
  'not_helpful',
  'other'
]

/**
 * Motivos que fazem sentido para cada alvo — menus curtos, cada um com efeito
 * conhecido. Reportar gabarito errado num roleplay não teria consequência.
 */
export const REASONS_BY_KIND: Record<ReportKind, ReportReason[]> = {
  exercise: ['wrong_answer', 'level_mismatch', 'confusing', 'duplicate', 'broken_text', 'off_topic'],
  lesson_content: ['confusing', 'wrong_answer', 'level_mismatch', 'off_topic', 'broken_text'],
  correction: ['unfair_correction', 'wrong_answer', 'confusing', 'broken_text'],
  scenario: ['off_topic', 'confusing', 'level_mismatch', 'not_helpful'],
  track_plan: ['off_topic', 'level_mismatch', 'not_helpful', 'duplicate'],
  chat_reply: ['not_helpful', 'confusing', 'off_topic', 'broken_text']
}

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === 'string' && (REPORT_KINDS as string[]).includes(value)
}

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as string[]).includes(value)
}

/** Motivo válido para o tipo; cai no primeiro da lista quando não bate. */
export function reasonFor(kind: ReportKind, reason: unknown): ReportReason {
  const candidates = REASONS_BY_KIND[kind]
  return isReportReason(reason) && candidates.includes(reason) ? reason : candidates[0]
}

/**
 * O que o app faz com cada tipo. `logged` é honesto: o report entra na fila do
 * painel e o botão de regenerar da própria tela é a saída.
 */
export function effectFor(kind: ReportKind): ReportEffect {
  switch (kind) {
    case 'exercise':
      return 'exercise-removed'
    case 'lesson_content':
      return 'content-regenerates'
    case 'correction':
      return 'error-unfocused'
    default:
      return 'logged'
  }
}
