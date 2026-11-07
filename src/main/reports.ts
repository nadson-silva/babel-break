/**
 * Reportar conteúdo ruim (M5).
 *
 * O botão não abre um ticket: ele **mexe no que o app mostra e no que os prompts
 * leem**, e registra o pedido no banco local.
 *
 * | tipo             | efeito                                                            |
 * |------------------|-------------------------------------------------------------------|
 * | `exercise`       | sai da prática (some do player e da contagem), histórico preservado |
 * | `lesson_content` | o cache é marcado velho: a próxima abertura regenera a explicação   |
 * | `correction`     | o erro sai do **foco de prompt** das próximas lições (recalibra)     |
 * | demais           | registrado, com o botão de regenerar da própria tela como saída      |
 *
 * Todo efeito é reversível (`undoReport`): o aluno pode se arrepender sem precisar
 * de SQL. O desbloqueio só acontece quando não sobra nenhum report aberto sobre o
 * mesmo alvo — dois "esse exercício está errado" continuam valendo.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { handle } from './ipc-contract'
import type { ReportInput, ReportItemView, ReportsSummary } from '../shared/types'
import type { ReportKind } from '../shared/report-reasons'
import { effectFor, isReportKind, isReportReason, reasonFor, snapshotText } from '../core/reports'
import { normalizeTag } from './notebook'
import { getDb, getDefaultProfile, schema } from './db'

// M6 (C7): as rotinas de escrita aceitam o handle do banco OU uma transação.
type DbHandle = ReturnType<typeof getDb>
type TxHandle = Parameters<Parameters<DbHandle['transaction']>[0]>[0]

type ReportRow = typeof schema.contentReports.$inferSelect

interface Context {
  text?: string
  replacement?: string
  tag?: string
}

function parseContext(row: ReportRow): Context {
  if (!row.context) return {}
  try {
    return JSON.parse(row.context) as Context
  } catch {
    return {}
  }
}

function now(): number {
  return Date.now()
}

/** Rótulo do alvo no momento do report — o registro precisa fazer sentido sozinho. */
function labelForTarget(kind: ReportInput['kind'], targetId: number | null): string | null {
  if (targetId == null) return null
  const db = getDb()

  if (kind === 'exercise') {
    const row = db
      .select({
        type: schema.exercises.type,
        lessonTitle: schema.lessons.title,
        prompt: schema.exercises.payload
      })
      .from(schema.exercises)
      .innerJoin(schema.lessons, eq(schema.lessons.id, schema.exercises.lessonId))
      .where(eq(schema.exercises.id, targetId))
      .get()
    if (!row) return null
    return `${row.lessonTitle} · ${row.type}`
  }

  if (kind === 'lesson_content' || kind === 'scenario') {
    return db.select({ title: schema.lessons.title }).from(schema.lessons).where(eq(schema.lessons.id, targetId)).get()
      ?.title ?? null
  }

  if (kind === 'correction') {
    const error = db
      .select({ tag: schema.errors.tag })
      .from(schema.errors)
      .where(eq(schema.errors.id, targetId))
      .get()
    return error?.tag ?? null
  }

  if (kind === 'track_plan') {
    return db
      .select({ title: schema.focusTracks.title })
      .from(schema.focusTracks)
      .where(eq(schema.focusTracks.id, targetId))
      .get()?.title ?? null
  }

  if (kind === 'chat_reply') {
    const conversation = db
      .select({ topic: schema.conversations.topic, lessonTitle: schema.lessons.title })
      .from(schema.conversations)
      .leftJoin(schema.lessons, eq(schema.lessons.id, schema.conversations.lessonId))
      .where(eq(schema.conversations.id, targetId))
      .get()
    return conversation?.topic ?? conversation?.lessonTitle ?? null
  }

  return null
}

/** Alvo existe? Report sem alvo válido é registrado, mas sem efeito. */
function targetExists(kind: ReportInput['kind'], targetId: number | null): boolean {
  if (targetId == null) return false
  const db = getDb()

  switch (kind) {
    case 'exercise':
      return db.select({ id: schema.exercises.id }).from(schema.exercises).where(eq(schema.exercises.id, targetId)).get() != null
    case 'correction':
      return db.select({ id: schema.errors.id }).from(schema.errors).where(eq(schema.errors.id, targetId)).get() != null
    case 'track_plan':
      return (
        db
          .select({ id: schema.focusTracks.id })
          .from(schema.focusTracks)
          .where(eq(schema.focusTracks.id, targetId))
          .get() != null
      )
    case 'chat_reply':
      return (
        db
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, targetId))
          .get() != null
      )
    default:
      return db.select({ id: schema.lessons.id }).from(schema.lessons).where(eq(schema.lessons.id, targetId)).get() != null
  }
}

/**
 * O aluno reporta uma correção inline sem saber o id da linha do caderno: resolve
 * pelo par (tag, frase original) a anotação aberta mais recente. É a mesma
 * normalização que o caderno usa para agrupar recorrência.
 */
function resolveCorrectionErrorId(tag: string | undefined, original: string | undefined): number | null {
  const wanted = (original ?? '').trim()
  if (!wanted) return null
  const normalized = normalizeTag(tag ?? '')
  const compact = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

  const rows = getDb()
    .select({ id: schema.errors.id, tag: schema.errors.tag, original: schema.errors.original })
    .from(schema.errors)
    .where(and(isNull(schema.errors.resolvedAt), isNull(schema.errors.disputedAt)))
    .orderBy(desc(schema.errors.lastSeenAt))
    .limit(80)
    .all()

  const byPhrase = rows.find((row) => compact(row.original) === compact(wanted))
  if (byPhrase) return byPhrase.id
  return rows.find((row) => row.tag === normalized)?.id ?? null
}

function toView(row: ReportRow): ReportItemView {
  const context = parseContext(row)
  return {
    id: row.id,
    kind: row.kind as ReportItemView['kind'],
    targetId: row.targetId,
    reason: row.reason as ReportItemView['reason'],
    note: row.note,
    effect: row.effect as ReportItemView['effect'],
    targetLabel: row.targetLabel,
    text: context.text ?? null,
    replacement: context.replacement ?? null,
    createdAt: row.createdAt,
    undoneAt: row.undoneAt
  }
}

/** Aplica o efeito do report no banco. Retorna o efeito realmente aplicado. */
function applyEffect(
  input: ReportInput,
  targetId: number | null,
  db: DbHandle | TxHandle = getDb()
): ReportItemView['effect'] {
  const declared = effectFor(input.kind)
  if (declared === 'logged') return 'logged'
  if (!targetExists(input.kind, targetId)) return 'logged'

  const stamp = now()

  if (input.kind === 'exercise') {
    db.update(schema.exercises).set({ blocked: true }).where(eq(schema.exercises.id, targetId!)).run()
    return 'exercise-removed'
  }

  if (input.kind === 'lesson_content') {
    db.update(schema.lessons).set({ staleAt: stamp }).where(eq(schema.lessons.id, targetId!)).run()
    return 'content-regenerates'
  }

  if (input.kind === 'correction') {
    db.update(schema.errors).set({ disputedAt: stamp }).where(eq(schema.errors.id, targetId!)).run()
    return 'error-unfocused'
  }

  return 'logged'
}

/** Ainda há algum report aberto pedindo a mesma coisa? (o undo respeita a maioria) */
function stillReported(kind: ReportInput['kind'], targetId: number | null, exceptId: number): boolean {
  if (targetId == null) return false
  const row = getDb()
    .select({ value: sql<number>`count(*)` })
    .from(schema.contentReports)
    .where(
      and(
        eq(schema.contentReports.kind, kind),
        eq(schema.contentReports.targetId, targetId),
        sql`${schema.contentReports.id} <> ${exceptId}`,
        isNull(schema.contentReports.undoneAt)
      )
    )
    .get()
  return Number(row?.value ?? 0) > 0
}

export function submitReport(input: ReportInput): ReportItemView {
  if (!isReportKind(input.kind)) throw new Error('Tipo de conteúdo desconhecido para reportar.')

  const profile = getDefaultProfile()
  const explicit = typeof input.targetId === 'number' && Number.isFinite(input.targetId) ? input.targetId : null
  const targetId =
    explicit ??
    (input.kind === 'correction' ? resolveCorrectionErrorId(input.context?.tag, input.context?.text) : null)
  const reason = isReportReason(input.reason) ? input.reason : reasonFor(input.kind, input.reason)

  const context: Context = {
    text: snapshotText(input.context?.text) ?? undefined,
    replacement: snapshotText(input.context?.replacement) ?? undefined,
    tag: snapshotText(input.context?.tag, 60) ?? undefined
  }

  // M6 (C7): efeito + registro numa transação só. Antes, uma falha entre os
  // dois deixava exercício bloqueado SEM report gravado — estado não-annulável.
  const row = getDb().transaction((tx) => {
    const effect = applyEffect({ ...input, reason }, targetId, tx)

    return tx
      .insert(schema.contentReports)
      .values({
        profileId: profile.id,
        kind: input.kind,
        targetId,
        reason,
        effect,
        note: snapshotText(input.note, 600) ?? null,
        context: Object.values(context).some(Boolean) ? JSON.stringify(context) : null,
        targetLabel: snapshotText(labelForTarget(input.kind, targetId), 160) ?? null,
        createdAt: now()
      })
      .returning()
      .get()
  })

  return toView(row)
}

export function undoReport(reportId: number, profileId = getDefaultProfile().id): ReportItemView | null {
  const db = getDb()
  // M6 (D2): o report só pode ser desfeito pelo próprio perfil — sem escopo,
  // um report de outro perfil liberaria alheio.
  const report = db
    .select()
    .from(schema.contentReports)
    .where(and(eq(schema.contentReports.id, reportId), eq(schema.contentReports.profileId, profileId)))
    .get()
  if (!report) return null
  if (report.undoneAt != null) return toView(report)

  const stamp = now()
  const kind = report.kind as ReportInput['kind']
  const targetId = report.targetId

  // M6 (C7): marcar como desfeito e reabrir o alvo são um só passo atômico.
  db.transaction((tx) => {
    tx.update(schema.contentReports)
      .set({ undoneAt: stamp })
      .where(eq(schema.contentReports.id, reportId))
      .run()

    if (stillReported(kind, targetId, reportId)) return

    if (kind === 'exercise' && targetId != null) {
      tx.update(schema.exercises).set({ blocked: false }).where(eq(schema.exercises.id, targetId)).run()
    }
    if (kind === 'lesson_content' && targetId != null) {
      tx.update(schema.lessons).set({ staleAt: null }).where(eq(schema.lessons.id, targetId)).run()
    }
    if (kind === 'correction' && targetId != null) {
      tx.update(schema.errors).set({ disputedAt: null }).where(eq(schema.errors.id, targetId)).run()
    }
  })

  return toView({ ...report, undoneAt: stamp })
}

/**
 * Desfaz o report mais recente sobre um alvo (o caderno mostra "reativar correção"
 * sem conhecer o id do report).
 */
export function undoReportForTarget(kind: ReportKind, targetId: number, profileId = getDefaultProfile().id): ReportItemView | null {
  const row = getDb()
    .select({ id: schema.contentReports.id })
    .from(schema.contentReports)
    .where(
      and(
        eq(schema.contentReports.kind, kind),
        eq(schema.contentReports.targetId, targetId),
        eq(schema.contentReports.profileId, profileId),
        isNull(schema.contentReports.undoneAt)
      )
    )
    .orderBy(desc(schema.contentReports.id))
    .limit(1)
    .get()

  return row ? undoReport(row.id, profileId) : null
}

export function reportsSummary(profileId: number, limit = 12): ReportsSummary {
  const db = getDb()

  const rows = db
    .select()
    .from(schema.contentReports)
    .where(eq(schema.contentReports.profileId, profileId))
    .orderBy(desc(schema.contentReports.createdAt), desc(schema.contentReports.id))
    .all()

  const byKind = new Map<string, number>()
  for (const row of rows) {
    byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1)
  }

  return {
    total: rows.length,
    byKind: [...byKind.entries()]
      .map(([kind, count]) => ({ kind: kind as ReportsSummary['byKind'][number]['kind'], count }))
      .sort((a, b) => b.count - a.count),
    recent: rows.slice(0, limit).map(toView)
  }
}

export function registerReportsIpc(): void {
  handle('report:submit', (_event, input: ReportInput): ReportItemView => submitReport(input))
  handle('report:undo', (_event, reportId: number) => undoReport(reportId))
  handle('report:undo-target', (_event, kind: ReportKind, targetId: number) =>
    undoReportForTarget(kind, targetId)
  )
  handle('report:list', (_event, limit?: number) =>
    reportsSummary(getDefaultProfile().id, limit)
  )
}
