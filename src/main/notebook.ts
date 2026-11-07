/**
 * Caderno de erros (M2) — par de idiomas no M4.
 *
 * Toda correção — de exercício, de chat com o tutor ou do banco de
 * interferência — cai aqui, agregada por (tag, frase original) com contador de
 * recorrência. É esta tabela que faz a lição #2 ser diferente da #1.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import type { Correction, NotebookTag, NotebookView } from '../shared/types'
import { errorFocus, type ErrorFocusEntry, type NotebookRow } from '../core/adapt'
import { bankEntries } from '../core/interference'
import type { ErrorHint } from '../core/prompts'
import { getDefaultProfile, getDb, schema } from './db'
import { profileInterferenceRules } from './locale'

type ErrorRow = typeof schema.errors.$inferSelect

export function normalizeTag(tag: string): string {
  const cleaned = tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'general'
}

function compact(value: string): string {
  // Unicode-aware (M4): dedupe de erros em qualquer escrita.
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Registra correções no caderno. Repetição do mesmo erro soma recorrência em
 * vez de criar linha nova — é a recorrência que gera exercício direcionado.
 */
export function recordCorrections(
  profileId: number,
  corrections: Correction[],
  input: { category: string; context?: string | null }
): number {
  if (corrections.length === 0) return 0

  const now = Date.now()
  let recorded = 0

  // M6 (C7): o caderno inteiro é uma escrita só — meio registro gravado e meio
  // não não pode existir.
  return getDb().transaction((db) => {
  for (const correction of corrections) {
    const tag = normalizeTag(correction.tag)
    const original = correction.original.trim()
    const corrected = (correction.corrected || correction.original).trim()
    if (!original || !corrected) continue
    if (compact(original) === compact(corrected)) continue

    const existing = db
      .select()
      .from(schema.errors)
      .where(
        and(
          eq(schema.errors.profileId, profileId),
          eq(schema.errors.tag, tag),
          isNull(schema.errors.resolvedAt)
        )
      )
      .orderBy(desc(schema.errors.lastSeenAt))
      .limit(20)
      .all()
      .find((row) => compact(row.original) === compact(original))

    if (existing) {
      db.update(schema.errors)
        .set({
          occurrences: existing.occurrences + 1,
          lastSeenAt: now,
          corrected,
          note: correction.note?.trim() || existing.note,
          source: correction.source ?? existing.source
        })
        .where(eq(schema.errors.id, existing.id))
        .run()
      recorded += 1
      continue
    }

    db.insert(schema.errors)
      .values({
        profileId,
        category: input.category,
        tag,
        original,
        corrected,
        context: input.context ?? null,
        note: correction.note?.trim() || null,
        occurrences: 1,
        source: correction.source ?? null,
        createdAt: now,
        lastSeenAt: now
      })
      .run()
    recorded += 1
  }

    return recorded
  })
}

function rowsToNotebookRows(rows: ErrorRow[]): NotebookRow[] {
  return rows.map((row) => ({
    tag: row.tag,
    category: row.category,
    original: row.original,
    corrected: row.corrected,
    note: row.note,
    occurrences: row.occurrences,
    lastSeen: row.lastSeenAt || row.createdAt,
    resolvedAt: row.resolvedAt,
    disputedAt: row.disputedAt
  }))
}

/** Todos os erros abertos, mais recorrentes primeiro. */
export function openErrors(profileId: number, limit = 40): ErrorRow[] {
  return getDb()
    .select()
    .from(schema.errors)
    .where(and(eq(schema.errors.profileId, profileId), isNull(schema.errors.resolvedAt)))
    .orderBy(desc(schema.errors.occurrences), desc(schema.errors.lastSeenAt))
    .limit(limit)
    .all()
}

/** Foco de adaptação: caderno do aluno, ancorado no banco do par quando fino. */
export function focusFor(profileId: number, limit = 5): ErrorFocusEntry[] {
  const db = getDb()
  const rows = db
    .select()
    .from(schema.errors)
    .where(eq(schema.errors.profileId, profileId))
    .orderBy(desc(schema.errors.occurrences), desc(schema.errors.lastSeenAt))
    .limit(60)
    .all()

  const anchor = bankEntries(profileInterferenceRules())
  return errorFocus(rowsToNotebookRows(rows), limit, anchor)
}

/** Hints prontos para ir dentro dos prompts de geração. */
export function errorHints(profileId: number, limit = 6): ErrorHint[] {
  return focusFor(profileId, limit).map((entry) => ({
    tag: entry.tag,
    original: entry.original,
    corrected: entry.corrected,
    note: entry.note,
    occurrences: entry.occurrences,
    source: entry.source
  }))
}

export function notebookView(profileId: number): NotebookView {
  const db = getDb()

  const rows = db
    .select()
    .from(schema.errors)
    .where(eq(schema.errors.profileId, profileId))
    .orderBy(desc(schema.errors.occurrences), desc(schema.errors.lastSeenAt))
    .limit(200)
    .all()

  const tags: NotebookTag[] = []
  const byTag = new Map<string, ErrorRow[]>()

  for (const row of rows) {
    const list = byTag.get(row.tag) ?? []
    list.push(row)
    byTag.set(row.tag, list)
  }

  for (const [tag, list] of byTag) {
    const occurrences = list.reduce((sum, row) => sum + row.occurrences, 0)
    const open = list.filter((row) => row.resolvedAt === null)
    tags.push({
      tag,
      occurrences,
      resolved: open.length === 0,
      lastSeenAt: Math.max(...list.map((row) => row.lastSeenAt || row.createdAt)),
      examples: list
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          original: row.original,
          corrected: row.corrected,
          note: row.note,
          lastSeenAt: row.lastSeenAt || row.createdAt,
          category: row.category,
          source: row.source,
          disputed: row.disputedAt != null
        }))
    })
  }

  tags.sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.occurrences - a.occurrences || b.lastSeenAt - a.lastSeenAt)

  const bankHits = db
    .select({ value: sql<number>`coalesce(sum(${schema.errors.occurrences}), 0)` })
    .from(schema.errors)
    .where(and(eq(schema.errors.profileId, profileId), eq(schema.errors.source, 'bank')))
    .get()?.value ?? 0

  const bankRules = profileInterferenceRules()
  const profile = getDefaultProfile()
  const bankPair =
    bankRules.length > 0
      ? { native: profile.nativeLang, target: profile.targetLang }
      : null

  return {
    tags,
    openCount: rows.filter((row) => row.resolvedAt === null).length,
    resolvedCount: rows.filter((row) => row.resolvedAt !== null).length,
    disputedCount: rows.filter((row) => row.disputedAt !== null).length,
    bank: bankEntries(bankRules),
    bankHits: Number(bankHits),
    bankPair
  }
}

export function setErrorResolved(errorId: number, resolved: boolean): void {
  getDb()
    .update(schema.errors)
    .set({ resolvedAt: resolved ? Date.now() : null })
    .where(eq(schema.errors.id, errorId))
    .run()
}

/** Marca como resolvidos os erros abertos de uma tag (usado no fechamento). */
export function resolveTagErrors(profileId: number, tags: string[]): number {
  if (tags.length === 0) return 0

  const db = getDb()
  const rows = db
    .select({ id: schema.errors.id })
    .from(schema.errors)
    .where(
      and(
        eq(schema.errors.profileId, profileId),
        inArray(schema.errors.tag, tags.map(normalizeTag)),
        isNull(schema.errors.resolvedAt)
      )
    )
    .all()

  if (rows.length === 0) return 0

  db.update(schema.errors)
    .set({ resolvedAt: Date.now() })
    .where(
      inArray(
        schema.errors.id,
        rows.map((row) => row.id)
      )
    )
    .run()

  return rows.length
}

/** Erros que viraram card de revisão (recorrentes e ainda abertos). */
export function recurringErrors(profileId: number, minOccurrences = 2, limit = 10): ErrorRow[] {
  return getDb()
    .select()
    .from(schema.errors)
    .where(
      and(
        eq(schema.errors.profileId, profileId),
        isNull(schema.errors.resolvedAt),
        // M5: correção que o aluno marcou como injusta não vira card nem foco.
        isNull(schema.errors.disputedAt),
        gte(schema.errors.occurrences, minOccurrences)
      )
    )
    .orderBy(desc(schema.errors.occurrences), desc(schema.errors.lastSeenAt))
    .limit(limit)
    .all()
}
