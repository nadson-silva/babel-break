/**
 * O "loop" do M2: como o histórico do aluno entra na próxima geração.
 *
 * Tudo aqui é puro e determinístico — é o que garante que a lição #2 seja
 * visivelmente diferente da #1 mesmo sem IA (e mesmo sem frequência).
 */
import type { CefrLevel, SkillEstimate } from '../shared/types'
import { CEFR_LEVELS, levelIndex } from './cefr'
import { bankEntries, type InterferenceEntry } from './interference'

export interface ErrorFocusEntry {
  tag: string
  occurrences: number
  original: string
  corrected: string
  note: string | null
  /** 'student' = saiu do caderno do aluno; 'bank' = âncora do banco PT-BR. */
  source: 'student' | 'bank'
}

export interface NotebookRow {
  tag: string
  category: string
  original: string
  corrected: string
  note: string | null
  occurrences: number
  /** Timestamp da última vez que o erro apareceu. */
  lastSeen: number
  resolvedAt: number | null
}

function toEntry(row: NotebookRow): ErrorFocusEntry {
  return {
    tag: row.tag,
    occurrences: row.occurrences,
    original: row.original,
    corrected: row.corrected,
    note: row.note,
    source: 'student'
  }
}

function bankEntry(entry: InterferenceEntry, occurrences = 0): ErrorFocusEntry {
  return {
    tag: entry.tag,
    occurrences,
    original: entry.wrong,
    corrected: entry.right,
    note: entry.note,
    source: 'bank'
  }
}

/**
 * Prioriza o caderno do aluno; quando ele ainda está vazio, ancora no banco
 * PT-BR para o conteúdo já nascer mirando erros reais de falantes de português.
 */
export function errorFocus(rows: NotebookRow[], limit = 5): ErrorFocusEntry[] {
  const open = rows
    .filter((row) => row.resolvedAt === null)
    .slice()
    .sort((a, b) => b.occurrences - a.occurrences || b.lastSeen - a.lastSeen)

  const picked: ErrorFocusEntry[] = []
  for (const row of open) {
    if (picked.some((entry) => entry.tag === row.tag)) continue
    picked.push(toEntry(row))
    if (picked.length >= limit) return picked
  }

  for (const entry of bankEntries().slice(0, limit * 2)) {
    if (picked.some((pickedEntry) => pickedEntry.tag === entry.tag)) continue
    picked.push(bankEntry(entry))
    if (picked.length >= limit) break
  }

  return picked
}

export function focusTags(entries: ErrorFocusEntry[], limit = 4): string[] {
  return entries.slice(0, limit).map((entry) => entry.tag)
}

/** Uma linha legível: "past-simple (3x) · articles (2x)". */
export function focusDigest(entries: ErrorFocusEntry[], limit = 3): string {
  return entries
    .slice(0, limit)
    .filter((entry) => entry.source === 'student')
    .map((entry) => `${entry.tag}${entry.occurrences > 1 ? ` (${entry.occurrences}x)` : ''}`)
    .join(' · ')
}

// --- Reestimativa de nível ------------------------------------------------

/** Nota 0–5 por habilidade → nível CEFR mais próximo. */
export function levelFromEstimate(estimate: number): CefrLevel {
  if (estimate < 1.5) return 'A1'
  if (estimate < 2.5) return 'A2'
  if (estimate < 3.5) return 'B1'
  if (estimate < 4.5) return 'B2'
  return 'C1'
}

/**
 * Recomenda um novo nível a partir das estimativas por habilidade.
 * Só sugere com confiança acumulada e move no máximo um degrau, para o
 * nível nunca oscilar por causa de uma lição ruim. O piso (0.55) fica acima
 * da confiança que o teste de nivelamento sozinho produz: nível muda com
 * evidência de prática, não com uma prova de 10 questões.
 */
export function reestimateLevel(
  skills: SkillEstimate[],
  current: CefrLevel,
  minConfidence = 0.55
): { cefr: CefrLevel; confidence: number } | null {
  const usable = skills.filter((skill) => skill.confidence >= minConfidence)
  if (usable.length === 0) return null

  const confidence = usable.reduce((sum, skill) => sum + skill.confidence, 0) / usable.length
  const average = usable.reduce((sum, skill) => sum + skill.estimate, 0) / usable.length
  const suggested = levelFromEstimate(average)
  const delta = levelIndex(suggested) - levelIndex(current)

  if (delta === 0) return null

  const bounded = CEFR_LEVELS[levelIndex(current) + Math.sign(delta)]
  return { cefr: bounded, confidence }
}
