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
  /** 'student' = saiu do caderno do aluno; 'bank' = âncora do banco de interferência. */
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
  /**
   * M5: o aluno marcou a correção como injusta. Ela sai do **foco** (não vira
   * exercício nem prioridade de prompt), mas continua no caderno como histórico.
   */
  disputedAt?: number | null
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
 * Prioriza o caderno do aluno; quando ele ainda está vazio, ancora no banco de
 * interferência do par (passado pelo caller) para o conteúdo já nascer mirando
 * erros reais daquele idioma — pares sem banco passam `anchor = []` e o foco
 * nasce só com o que o aluno produziu.
 *
 * M5: erro **disputado** (report "essa correção foi injusta") é tratado como
 * superado para fins de foco — é assim que o botão recalibra a máquina sem
 * apagar o histórico do aluno.
 */
export function errorFocus(
  rows: NotebookRow[],
  limit = 5,
  anchor: InterferenceEntry[] = bankEntries()
): ErrorFocusEntry[] {
  const open = rows
    .filter((row) => row.resolvedAt === null && row.disputedAt == null)
    .slice()
    .sort((a, b) => b.occurrences - a.occurrences || b.lastSeen - a.lastSeen)

  const picked: ErrorFocusEntry[] = []
  for (const row of open) {
    if (picked.some((entry) => entry.tag === row.tag)) continue
    picked.push(toEntry(row))
    if (picked.length >= limit) return picked
  }

  for (const entry of anchor.slice(0, limit * 2)) {
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

/** Fronteira (em 0–5) entre dois níveis vizinhos: A1|A2 = 1,5 · A2|B1 = 2,5 · … */
export function boundaryBetween(level: CefrLevel, next: CefrLevel): number {
  const higher = Math.max(levelIndex(level), levelIndex(next))
  return 0.5 + higher
}

export interface ReestimateInput {
  skills: SkillEstimate[]
  current: CefrLevel
  /** Só habilidades com esta confiança entram na conta. */
  minConfidence?: number
  /** Quantas habilidades independentes precisam concordar (v2/D10). */
  minSkills?: number
  /**
   * V2 (D10): banda morta em torno da fronteira. Uma lição ruim perto de A2|B1
   * não pode mandar o aluno de um nível para o outro a cada semana — a nota só
   * muda quando a média passa a fronteira com folga.
   */
  deadBand?: number
}

export interface ReestimateSuggestion {
  cefr: CefrLevel
  confidence: number
  /** Por que mexeu (ou por que não mexeu) — vai para o log e para a UI. */
  reason: 'up' | 'down' | 'no-consensus' | 'thin-evidence' | 'dead-band' | 'ceiling'
  average: number
}

const DEFAULT_MIN_CONFIDENCE = 0.55
const DEFAULT_MIN_SKILLS = 2
/** 0,25 numa escala de 5 = meio degrau de diferença não move nível. */
const DEFAULT_DEAD_BAND = 0.25

/**
 * Recomenda um novo nível a partir das estimativas por habilidade (v2/D10).
 *
 * Quatro regras, todas conservadoras:
 *
 * 1. **peso por confiança**: `grammar` com 0,9 de confiança manda mais que
 *    `vocab` com 0,4 (média ponderada, não média simples);
 * 2. **mínimo de amostras**: pelo menos `minSkills` habilidades acima de
 *    `minConfidence`; uma habilidade sozinha não redefine o aluno;
 * 3. **banda morta**: a média precisa passar a fronteira do nível atual com
 *    folga (`deadBand`), senão o nível fica onde está — era isso que fazia
 *    A2↔B1 ficar alternando a cada lição;
 * 4. **um degrau por vez** e nada além de C1 (o plano não tem C2).
 */
export function reestimateLevel(input: ReestimateInput): ReestimateSuggestion | null {
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE
  const minSkills = input.minSkills ?? DEFAULT_MIN_SKILLS
  const deadBand = input.deadBand ?? DEFAULT_DEAD_BAND

  const usable = input.skills.filter((skill) => skill.confidence >= minConfidence)
  if (usable.length < minSkills) return null

  const mass = usable.reduce((sum, skill) => sum + skill.confidence, 0)
  if (mass <= 0) return null

  const average = usable.reduce((sum, skill) => sum + skill.estimate * skill.confidence, 0) / mass
  const suggested = levelFromEstimate(average)
  const delta = levelIndex(suggested) - levelIndex(input.current)
  const confidence = mass / usable.length

  if (delta === 0) {
    // No teto a média pode até ser altíssima: não existe C2 no plano, e a UI
    // precisa saber por que nada mudou em vez de ler "sem consenso".
    const atCeiling =
      levelIndex(input.current) === CEFR_LEVELS.length - 1 && average >= boundaryBetween('B2', 'C1')
    return {
      cefr: input.current,
      confidence,
      reason: atCeiling ? 'ceiling' : 'no-consensus',
      average
    }
  }

  const direction = Math.sign(delta)
  const target = CEFR_LEVELS[levelIndex(input.current) + direction]
  if (!target) return { cefr: input.current, confidence, reason: 'ceiling', average }

  const boundary = boundaryBetween(input.current, target)
  // Andando para cima, a média tem que ficar acima da fronteira; para baixo,
  // abaixo. Dentro da banda morta, nada muda.
  const beyond = direction > 0 ? average - boundary : boundary - average
  if (beyond < deadBand) {
    return { cefr: input.current, confidence, reason: 'dead-band', average }
  }

  return {
    cefr: target,
    confidence,
    reason: direction > 0 ? 'up' : 'down',
    average
  }
}
