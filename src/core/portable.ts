/**
 * V2 — backup portável (export/import).
 *
 * O arquivo é **um perfil**, não o aparelho: configurações de IA, chave do
 * Gemini e ponteiro de perfil ativo ficam fora (são estado do dispositivo, e
 * segredo nunca vai para um arquivo compartilhável).
 *
 * Três coisas fazem disto um formato em vez de um `SELECT *` jogado em JSON:
 *
 * 1. **Carimbo de versão** (`format` + `schemaVersion` + `promptVersion` +
 *    `dbVersion`). Um dump gravado por contrato antigo é recusado com mensagem
 *    clara — é o pré-requisito que o plano cobra em D1 ("dump sem versão não é
 *    compatível").
 * 2. **Fechamento referencial**: cada linha filha precisa achar o pai dentro do
 *    próprio arquivo. Linha órfã = recusa, porque importar órfão é exportar
 *    perfil corrompido (C5/C6).
 * 3. **Remapeamento de ids** na importação: o perfil importado nasce com ids
 *     novos e nada aponta para o que já existia.
 *
 * Tudo aqui é TS puro: `core/` não conhece Electron nem SQLite, então o formato
 * é testável sem app — e portável se o shell mudar um dia.
 */
import { z } from 'zod'
import { PROMPT_VERSION, SCHEMA_VERSION, cefrSchema } from './schemas'

/** Versão do **formato do arquivo**. Muda quando a estrutura do envelope muda. */
export const EXPORT_FORMAT_VERSION = 1

/** Identificador do arquivo — o "magic number" lido antes de qualquer parse. */
export const EXPORT_APP = 'language-teacher'

export const EXPORT_KINDS = ['profile', 'app'] as const

/** Nome de cada bloco do dump — espelha as tabelas, na ordem de inserção. */
export const EXPORT_TABLES = [
  'skills_state',
  'units',
  'lessons',
  'lesson_items',
  'exercises',
  'attempts',
  'errors',
  'cards',
  'reviews',
  'lesson_progress',
  'study_sessions',
  'conversations',
  'messages',
  'focus_tracks',
  'track_lessons',
  'scenario_runs',
  'speech_runs',
  'content_reports'
] as const

export type ExportTable = (typeof EXPORT_TABLES)[number]

/** Tetos honestos: um dump de perfil realista cabe aqui; um arquivo malicioso não. */
const MAX_ROWS_PER_TABLE = 20_000
const MAX_TOTAL_ROWS = 120_000
const MAX_CELL_TEXT = 200_000

const row = z.record(z.string(), z.unknown())
const tableMap = z
  .array(row)
  .max(MAX_ROWS_PER_TABLE, { message: `mais de ${MAX_ROWS_PER_TABLE} linhas numa tabela` })

export const exportManifestSchema = z.object({
  kind: z.enum(EXPORT_KINDS),
  format: z.number().int().min(1),
  schemaVersion: z.number().int().min(1),
  promptVersion: z.number().int().min(1),
  dbVersion: z.number().int().min(0),
  appVersion: z.string().max(40),
  exportedAt: z.number().int().nonnegative(),
  includesAudio: z.boolean(),
  /** Linhas de áudio no arquivo (cache: o import pode pular e o app regera). */
  audioRows: z.number().int().nonnegative(),
  /** Perfil exportado (identidade + par de idiomas), nunca segredo. */
  profile: z.object({
    name: z.string().max(200).nullable(),
    color: z.string().max(40).nullable(),
    targetLang: z.string().max(10),
    nativeLang: z.string().max(10),
    goal: z.string().max(600).nullable(),
    cefr: cefrSchema.nullable(),
    focusMix: z.number().min(0).max(1),
    placementScore: z.number().min(0).max(1).nullable(),
    onboardingCompletedAt: z.number().int().nullable(),
    prefs: z.string().max(MAX_CELL_TEXT).nullable()
  }),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  /** Conteúdo em cache que o app vai tratar como velho na primeira abertura. */
  stale: z
    .object({
      lessonContent: z.number().int().nonnegative().default(0),
      exercises: z.number().int().nonnegative().default(0)
    })
    .default({ lessonContent: 0, exercises: 0 })
});

export const exportEnvelopeSchema = z.object({
  app: z.literal(EXPORT_APP),
  manifest: exportManifestSchema,
  tables: z.object({
    skills_state: tableMap,
    units: tableMap,
    lessons: tableMap,
    lesson_items: tableMap,
    exercises: tableMap,
    attempts: tableMap,
    errors: tableMap,
    cards: tableMap,
    reviews: tableMap,
    lesson_progress: tableMap,
    study_sessions: tableMap,
    conversations: tableMap,
    messages: tableMap,
    focus_tracks: tableMap,
    track_lessons: tableMap,
    scenario_runs: tableMap,
    speech_runs: tableMap,
    content_reports: tableMap,
    /**
     * Áudio TTS (só quando `includesAudio`): linha normal, com `bytes` em
     * base64 — cache de conveniência: o import pode pular e o app regera.
     */
    audio_cache: z.array(row).max(MAX_ROWS_PER_TABLE).default([])
  })
})

export type ExportManifest = z.infer<typeof exportManifestSchema>
export type ExportEnvelope = z.infer<typeof exportEnvelopeSchema>

export type InspectResult =
  | {
      ok: true
      manifest: ExportManifest
      /** Linhas que o import vai trazer, por bloco. */
      counts: Record<string, number>
      warnings: string[]
      /** Erros que não bloqueiam, mas o usuário precisa ver. */
      notes: string[]
    }
  | { ok: false; code: InspectFailure; errors: string[] }

export type InspectFailure =
  | 'not-json'
  | 'shape'
  | 'unknown-app'
  | 'format-version'
  | 'schema-version'
  | 'orphan-rows'
  | 'too-large'

/** Situações em que o import precisa reestimativa manual do nível: nunca um shim. */
const ACCEPTED_SCHEMA_VERSIONS: number[] = [SCHEMA_VERSION]

function idsOf(rows: readonly Record<string, unknown>[], key = 'id'): Set<unknown> {
  return new Set(rows.map((entry) => entry[key]))
}

/**
 * Texto → manifest → versão → fechamento referencial. Cada falha devolve códigos
 * legíveis (a UI traduz por chave); nada de "importei pela metade".
 */
export function inspectExport(text: string): InspectResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { ok: false, code: 'not-json', errors: ['json'] }
  }

  if (!parsed || typeof parsed !== 'object' || (parsed as { app?: unknown }).app !== 'language-teacher') {
    return { ok: false, code: 'unknown-app', errors: ['app'] }
  }

  const shape = exportEnvelopeSchema.safeParse(parsed)
  if (!shape.success) {
    return {
      ok: false,
      code: 'shape',
      errors: shape.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`)
    }
  }

  const manifest = shape.data.manifest

  if (manifest.format !== EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      code: 'format-version',
      errors: [`format:${manifest.format}`, `esperado:${EXPORT_FORMAT_VERSION}`]
    }
  }

  if (!ACCEPTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion)) {
    return {
      ok: false,
      code: 'schema-version',
      errors: [`schema:${manifest.schemaVersion}`, `esperado:${SCHEMA_VERSION}`, `prompt:${manifest.promptVersion}`]
    }
  }

  const tables = shape.data.tables
  const total = EXPORT_TABLES.reduce((sum, name) => sum + (tables[name] as readonly unknown[]).length, 0)
  if (total > MAX_TOTAL_ROWS) {
    return { ok: false, code: 'too-large', errors: [`${total} linhas`] }
  }

  const orphans = findOrphanRows(tables)
  if (orphans.length > 0) {
    return { ok: false, code: 'orphan-rows', errors: orphans }
  }

  const warnings: string[] = []
  if (manifest.stale?.lessonContent) warnings.push(`stale-content:${manifest.stale.lessonContent}`)
  if (manifest.stale?.exercises) warnings.push(`stale-exercises:${manifest.stale.exercises}`)
  if (manifest.promptVersion !== PROMPT_VERSION) warnings.push(`prompt:${manifest.promptVersion}`)
  if (!manifest.includesAudio) warnings.push('no-audio')

  const notes: string[] = []
  if (manifest.profile.onboardingCompletedAt == null) notes.push('needs-onboarding')
  if (!manifest.counts['lessons']) notes.push('no-lessons')

  return {
    ok: true,
    manifest,
    counts: Object.fromEntries(EXPORT_TABLES.map((name) => [name, (tables[name] as unknown[])?.length ?? 0])),
    warnings,
    notes
  }
}

/**
 * Fechamento referencial: **dentro do arquivo**, toda linha filha acha a mãe.
 * É o que o plano cobra ("linhas órfãs exportam perfil corrompido"). Também
 * recusa dump que mistura dois perfis.
 */
export function findOrphanRows(tables: ExportEnvelope['tables']): string[] {
  const lessons = idsOf(tables.lessons)
  const exercises = idsOf(tables.exercises)
  const cards = idsOf(tables.cards)
  const conversations = idsOf(tables.conversations)
  const tracks = idsOf(tables.focus_tracks)
  const units = idsOf(tables.units)
  const found: string[] = []

  const parent = (
    name: ExportTable,
    rows: readonly Record<string, unknown>[],
    key: string,
    parents: Set<unknown>,
    parentLabel = key
  ): void => {
    for (const entry of rows) {
      const parentId = entry[key]
      if (parentId == null) continue
      if (!parents.has(parentId)) {
        // Localizador: o id da linha, ou o valor que quebra a cadeia quando a
        // tabela não tem id (track_lessons, lesson_progress).
        found.push(`${name}:${String(entry.id ?? parentId)}→${parentLabel}`)
      }
    }
  }

  // Lições: o dono pode ser unidade, trilha, ou nenhum (currículo base sem unidade).
  parent('lessons', tables.lessons, 'unit_id', units, 'unit')
  parent('lessons', tables.lessons, 'track_id', tracks, 'track')

  parent('lesson_items', tables.lesson_items, 'lesson_id', lessons)
  parent('exercises', tables.exercises, 'lesson_id', lessons)
  parent('attempts', tables.attempts, 'exercise_id', exercises)
  parent('reviews', tables.reviews, 'card_id', cards)
  parent('messages', tables.messages, 'conversation_id', conversations)
  parent('track_lessons', tables.track_lessons, 'track_id', tracks)
  parent('track_lessons', tables.track_lessons, 'lesson_id', lessons)
  parent('lesson_progress', tables.lesson_progress, 'lesson_id', lessons)
  parent('scenario_runs', tables.scenario_runs, 'conversation_id', conversations)
  parent('speech_runs', tables.speech_runs, 'lesson_id', lessons)

  // Nada pode trazer perfil de fora: todas as linhas com `profile_id` apontam
  // para o mesmo dono do dump.
  const owners = new Set<string>()
  for (const name of EXPORT_TABLES) {
    for (const entry of tables[name] as readonly Record<string, unknown>[]) {
      if (entry.profile_id != null) owners.add(String(entry.profile_id))
    }
  }
  if (owners.size > 1) found.push(`profile_id:${[...owners].sort().join('|')}`)

  return found.slice(0, 12)
}

/** Rótulo compacto do dump para a UI ("12 lições · 40 cards"). */
export function summarizeCounts(counts: Record<string, number>): string {
  const pick: Array<[string, string]> = [
    ['lessons', 'lessons'],
    ['exercises', 'exercises'],
    ['cards', 'cards'],
    ['errors', 'errors'],
    ['conversations', 'conversations'],
    ['focus_tracks', 'tracks'],
    ['speech_runs', 'speech']
  ]
  return pick
    .filter(([key]) => (counts[key] ?? 0) > 0)
    .map(([key, label]) => `${counts[key]} ${label}`)
    .join(' · ')
}
