/**
 * V2 — export/import de perfil (backup portável).
 *
 * O formato (o que é compatível, o que é recusado) mora em `core/portable.ts`,
 * puro e testável. Este arquivo é a metade que conhece SQLite: despeja as
 * tabelas de um perfil num envelope com carimbo de versão e reinsere o envelope
 * num **perfil novo**, remapeando todo id referenciado.
 *
 * Decisões que não são cosméticas:
 *
 * - Perfil importado nunca sobrescreve existente: ids novos, nenhuma chance de
 *   misturar o caderno de dois alunos.
 * - `settings` (provedor, chave, perfil ativo) **não** viaja: é estado do
 *   aparelho, e segredo não vai para arquivo compartilhável.
 * - Carimbo divergente é recusado com mensagem clara — não existe shim de
 *   formato (D1: "dump sem versão não é compatível").
 * - Linha órfã no arquivo = recusa (C5/C6: "linhas órfãs exportam perfil
 *   corrompido").
 * - Cache de áudio é opcional na saída e ignorável na entrada: é conveniência,
 *   não memória do aluno.
 * - Sessão guiada inacabada de outra máquina entra **encerrada**: retomar um
 *   passo no meio com ids remapeados é estado que quebra bonito.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, dialog } from 'electron'
import {
  EXPORT_APP,
  EXPORT_FORMAT_VERSION,
  EXPORT_TABLES,
  exportEnvelopeSchema,
  findOrphanRows,
  type ExportEnvelope
} from '../core/portable'
import { PROMPT_VERSION, SCHEMA_VERSION } from '../core/schemas'
import { handle } from './ipc-contract'
import { appliedMigrationCount, getDbHandle, readActiveProfileId } from './db'
import { activeProfileId, setActiveProfile } from './profiles'
import type {
  ExportFileView,
  ExportManifestView,
  ImportResultView,
  InspectView
} from '../shared/types'

type Row = Record<string, unknown>
type RemapTarget = 'units' | 'lessons' | 'exercises' | 'cards' | 'conversations' | 'focus_tracks'

interface TableSpec {
  /** Chave no envelope (= nome da tabela no SQLite). */
  name: (typeof EXPORT_TABLES)[number]
  /** Where do dump; `@p` é o perfil exportado. */
  where: string
  /** Coluna → tabela cujo id precisa ser remapeado. */
  refs?: Partial<Record<string, RemapTarget>>
  /** Tem `id` autoincremental: gera mapa old→new para os filhos. */
  remapsId: boolean
  /** Tem coluna `profile_id`, sempre reescrita para o perfil novo. */
  hasProfile: boolean
  /** Id que mora dentro de uma coluna JSON. */
  jsonRefs?: { column: string; keys: Record<string, RemapTarget> }
}

/** Dono de uma lição: coluna da v2, com a cadeia unidade/trilha como fallback. */
const LESSON_SCOPE = `(profile_id = @p
   or unit_id in (select id from units where profile_id = @p)
   or track_id in (select id from focus_tracks where profile_id = @p))`

const EXERCISE_SCOPE = `lesson_id in (select id from lessons where ${LESSON_SCOPE})`

/**
 * Ordem = ordem de inserção: **pai antes de filho** — inclusive os pais que não
 * são FK declarada (lição de trilha aponta `focus_tracks`, e a trilha precisa
 * vir antes de `lessons` ou o id ainda não existe). A conexão roda com
 * `foreign_keys = ON`, então sequência errada é erro, não dado torto.
 */
const TABLE_SPECS: TableSpec[] = [
  { name: 'skills_state', where: 'profile_id = @p', remapsId: false, hasProfile: true },
  { name: 'units', where: 'profile_id = @p', remapsId: true, hasProfile: true },
  { name: 'focus_tracks', where: 'profile_id = @p', remapsId: true, hasProfile: true },
  { name: 'lessons', where: LESSON_SCOPE, refs: { unit_id: 'units', track_id: 'focus_tracks' }, remapsId: true, hasProfile: true },
  { name: 'lesson_items', where: `lesson_id in (select id from lessons where ${LESSON_SCOPE})`, refs: { lesson_id: 'lessons' }, remapsId: true, hasProfile: false },
  { name: 'exercises', where: EXERCISE_SCOPE, refs: { lesson_id: 'lessons' }, remapsId: true, hasProfile: false },
  { name: 'attempts', where: `exercise_id in (select id from exercises where ${EXERCISE_SCOPE})`, refs: { exercise_id: 'exercises' }, remapsId: true, hasProfile: false },
  { name: 'errors', where: 'profile_id = @p', remapsId: true, hasProfile: true },
  {
    name: 'cards',
    where: 'profile_id = @p',
    refs: { lesson_id: 'lessons' },
    jsonRefs: { column: 'content', keys: { lessonId: 'lessons' } },
    remapsId: true,
    hasProfile: true
  },
  { name: 'reviews', where: 'card_id in (select id from cards where profile_id = @p)', refs: { card_id: 'cards' }, remapsId: true, hasProfile: false },
  { name: 'lesson_progress', where: 'profile_id = @p', refs: { lesson_id: 'lessons' }, remapsId: false, hasProfile: true },
  { name: 'conversations', where: 'profile_id = @p', refs: { lesson_id: 'lessons' }, remapsId: true, hasProfile: true },
  { name: 'messages', where: 'conversation_id in (select id from conversations where profile_id = @p)', refs: { conversation_id: 'conversations' }, remapsId: true, hasProfile: false },
  {
    name: 'study_sessions',
    where: 'profile_id = @p',
    jsonRefs: { column: 'summary', keys: { lessonId: 'lessons', conversationId: 'conversations' } },
    remapsId: true,
    hasProfile: true
  },
  { name: 'track_lessons', where: 'track_id in (select id from focus_tracks where profile_id = @p)', refs: { track_id: 'focus_tracks', lesson_id: 'lessons' }, remapsId: false, hasProfile: false },
  { name: 'scenario_runs', where: 'conversation_id in (select id from conversations where profile_id = @p)', refs: { conversation_id: 'conversations', lesson_id: 'lessons' }, remapsId: true, hasProfile: false },
  { name: 'speech_runs', where: 'profile_id = @p', refs: { lesson_id: 'lessons', exercise_id: 'exercises' }, remapsId: true, hasProfile: true },
  { name: 'content_reports', where: 'profile_id = @p', remapsId: true, hasProfile: true }
]

/** O banco guarda CEFR como texto: projeta para o enum do formato (ou null). */
function storedCefr(value: unknown): 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | null {
  return value === 'A1' || value === 'A2' || value === 'B1' || value === 'B2' || value === 'C1' ? value : null
}

function profileRow(db: ReturnType<typeof getDbHandle>, profileId: number): Row | null {
  return (db.prepare('select * from profiles where id = ?').get(profileId) as Row | undefined) ?? null
}

/** Quantas linhas de conteúdo o app vai tratar como `stale` na primeira abertura (D1). */
function staleCounts(db: ReturnType<typeof getDbHandle>, profileId: number): { lessonContent: number; exercises: number } {
  // Só conta o que **existe** e está fora do contrato: lição nunca gerada não é
  // linha "velha", é linha que ainda vai nascer na primeira abertura.
  const versionCheck = (column: string): string =>
    `(${column} is not null
      and (json_extract(${column}, '$.schemaVersion') is null
        or json_extract(${column}, '$.schemaVersion') <> @schema
        or json_extract(${column}, '$.promptVersion') is null
        or json_extract(${column}, '$.promptVersion') <> @prompt))`

  const content = db
    .prepare(`select count(*) as n from lessons where ${LESSON_SCOPE} and ${versionCheck('content')}`)
    .get({ p: profileId, schema: SCHEMA_VERSION, prompt: PROMPT_VERSION }) as { n?: number }
  const exercises = db
    .prepare(`select count(*) as n from exercises where ${EXERCISE_SCOPE} and ${versionCheck('payload')}`)
    .get({ p: profileId, schema: SCHEMA_VERSION, prompt: PROMPT_VERSION }) as { n?: number }

  return { lessonContent: Number(content?.n ?? 0), exercises: Number(exercises?.n ?? 0) }
}

function manifestView(
  profile: Row,
  extra: {
    kind: 'profile' | 'app'
    includesAudio: boolean
    audioRows: number
    counts: Record<string, number>
    stale: { lessonContent: number; exercises: number }
  }
): ExportEnvelope['manifest'] {
  return {
    kind: extra.kind,
    format: EXPORT_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    dbVersion: appliedMigrationCount(),
    appVersion: app.getVersion(),
    exportedAt: Date.now(),
    includesAudio: extra.includesAudio,
    audioRows: extra.audioRows,
    profile: {
      name: (profile.name as string | null) ?? null,
      color: (profile.color as string | null) ?? null,
      targetLang: String(profile.target_lang ?? 'en'),
      nativeLang: String(profile.native_lang ?? 'pt-BR'),
      goal: (profile.goal as string | null) ?? null,
      cefr: storedCefr(profile.cefr),
      focusMix: Number(profile.focus_mix ?? 0.3),
      placementScore: (profile.placement_score as number | null) ?? null,
      onboardingCompletedAt: (profile.onboarding_completed_at as number | null) ?? null,
      // `prefs` guarda o teste de nivelamento: é memória do aluno, viaja.
      prefs: (profile.prefs as string | null) ?? null
    },
    counts: extra.counts,
    stale: extra.stale
  }
}

/**
 * Projeção do manifest para o renderer: os mesmos números, sem `prefs` (o texto
 * cru do nivelamento não precisa cruzar a ponte para mostrar um resumo).
 */
function manifestToView(manifest: ExportEnvelope['manifest']): ExportManifestView {
  const { prefs: _prefs, ...profile } = manifest.profile
  return { ...manifest, profile }
}

/** Envelope do perfil, sem tocar em disco (é o que o teste de round-trip usa). */
export function buildEnvelope(profileId: number, options: { includeAudio?: boolean } = {}): ExportEnvelope {
  const db = getDbHandle()
  const profile = profileRow(db, profileId)
  if (!profile) throw new Error('Perfil não encontrado.')

  const tables = {} as Record<(typeof EXPORT_TABLES)[number], Row[]>
  const counts: Record<string, number> = {}

  for (const spec of TABLE_SPECS) {
    const rows = db.prepare(`select * from ${spec.name} where ${spec.where}`).all({ p: profileId }) as Row[]
    tables[spec.name] = rows
    counts[spec.name] = rows.length
  }

  const includeAudio = options.includeAudio === true
  const audioRows = includeAudio
    ? (db.prepare('select * from audio_cache where profile_id = @p').all({ p: profileId }) as Row[])
    : []

  // `bytes` é BLOB: no arquivo vira base64 (JSON não carrega binário).
  const audio = audioRows.map((row) => ({
    ...row,
    bytes: Buffer.isBuffer(row.bytes) ? row.bytes.toString('base64') : String(row.bytes ?? '')
  }))

  const manifest = manifestView(profile, {
    kind: 'profile',
    includesAudio: includeAudio,
    audioRows: audio.length,
    counts,
    stale: staleCounts(db, profileId)
  })

  return {
    app: EXPORT_APP,
    manifest,
    tables: { ...tables, audio_cache: audio } as ExportEnvelope['tables']
  }
}

/** JSON do backup (sem indentar: arquivo menor, e a UI não lê isto). */
export function exportProfileJson(profileId = activeProfileId(), options: { includeAudio?: boolean } = {}): string {
  return JSON.stringify(buildEnvelope(profileId, options))
}

/** Nome de arquivo honesto: dono + idioma + dia. */
function suggestedFileName(profile: Row): string {
  const lang = String(profile.target_lang ?? 'lang')
  const day = new Date().toISOString().slice(0, 10)
  const slug = String(profile.name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `language-teacher-${slug || 'perfil'}-${lang}-${day}.json`
}

function defaultExportDir(): string {
  for (const kind of ['documents', 'downloads'] as const) {
    try {
      return path.join(app.getPath(kind), 'language-teacher-backups')
    } catch {
      // fuso sem essa pasta: tenta a próxima
    }
  }
  return app.getPath('userData')
}

/** Exporta para arquivo. Sem `path`, abre o diálogo de salvamento do SO. */
export async function exportProfileToFile(
  profileId = activeProfileId(),
  options: { includeAudio?: boolean; path?: string } = {}
): Promise<ExportFileView> {
  const db = getDbHandle()
  const profile = profileRow(db, profileId)
  if (!profile) throw new Error('Perfil não encontrado.')

  const envelope = buildEnvelope(profileId, { includeAudio: options.includeAudio })
  const text = JSON.stringify(envelope, null, 2)

  let target = options.path?.trim() ?? ''

  if (!target) {
    const result = await dialog.showSaveDialog({
      title: 'Exportar perfil',
      defaultPath: path.join(defaultExportDir(), suggestedFileName(profile)),
      filters: [{ name: 'Language Teacher backup', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) {
      return { cancelled: true, path: null, bytes: 0, manifest: manifestToView(envelope.manifest) }
    }
    target = result.filePath
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text, 'utf8')

  return {
    cancelled: false,
    path: target,
    bytes: Buffer.byteLength(text, 'utf8'),
    manifest: manifestToView(envelope.manifest)
  }
}

function readSource(input: { path?: string; json?: string }): string {
  const inline = input.json?.trim() ?? ''
  if (inline) return inline
  if (!input.path?.trim()) return ''
  try {
    return fs.readFileSync(input.path, 'utf8')
  } catch {
    return ''
  }
}

/** Lê e valida o backup **sem escrever nada** — o "só conferir" da UI. */
export function inspectSource(input: { path?: string; json?: string }): InspectView {
  const text = readSource(input)
  if (!text) return { ok: false, code: 'no-source', errors: ['vazio'] }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { ok: false, code: 'not-json', errors: ['json'] }
  }

  const valid = exportEnvelopeSchema.safeParse(parsed)
  if (!valid.success) {
    return {
      ok: false,
      code: 'shape',
      errors: valid.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`)
    }
  }

  const envelope = valid.data as ExportEnvelope
  const manifest = envelope.manifest

  if (manifest.format !== EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      code: 'format-version',
      errors: [`formato ${manifest.format}`, `esperado ${EXPORT_FORMAT_VERSION}`]
    }
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'schema-version',
      errors: [`schema ${manifest.schemaVersion}`, `esperado ${SCHEMA_VERSION}`, `prompt ${manifest.promptVersion}`]
    }
  }

  const orphans = findOrphanRows(envelope.tables)
  if (orphans.length > 0) return { ok: false, code: 'orphan-rows', errors: orphans }

  const counts: Record<string, number> = {}
  for (const name of EXPORT_TABLES) counts[name] = (envelope.tables[name] as Row[]).length

  const warnings: string[] = []
  if (manifest.stale.lessonContent > 0) warnings.push(`stale-content:${manifest.stale.lessonContent}`)
  if (manifest.stale.exercises > 0) warnings.push(`stale-exercises:${manifest.stale.exercises}`)
  if (manifest.promptVersion !== PROMPT_VERSION) warnings.push(`prompt:${manifest.promptVersion}`)
  if (!manifest.includesAudio) warnings.push('no-audio')

  const notes: string[] = []
  if (manifest.profile.onboardingCompletedAt == null) notes.push('needs-onboarding')
  if (counts['lessons'] === 0) notes.push('no-lessons')

  return { ok: true, manifest: manifestToView(manifest), counts, warnings, notes }
}

/**
 * Importa o envelope como **perfil novo**. Uma transação só: se qualquer linha
 * falhar, nada entra — não existe "perfil pela metade".
 */
export function importProfile(input: {
  path?: string
  json?: string
  name?: string | null
}): ImportResultView {
  const text = readSource(input)
  if (!text) throw new Error('Nada para importar.')

  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    throw new Error('O arquivo não é JSON.')
  }

  const valid = exportEnvelopeSchema.safeParse(raw)
  if (!valid.success) {
    const first = valid.error.issues[0]
    throw new Error(`Backup recusado: ${first ? `${first.path.join('.') || 'raiz'} (${first.message})` : 'formato'}`)
  }

  const envelope = valid.data as ExportEnvelope
  if (envelope.manifest.format !== EXPORT_FORMAT_VERSION || envelope.manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Backup gravado por outra versão do app (formato ${envelope.manifest.format}, schema ${envelope.manifest.schemaVersion}). ` +
        `Este app entende formato ${EXPORT_FORMAT_VERSION}, schema ${SCHEMA_VERSION}.`
    )
  }

  const orphans = findOrphanRows(envelope.tables)
  if (orphans.length > 0) throw new Error(`Backup com linhas órfãs: ${orphans.slice(0, 4).join(', ')}`)

  const db = getDbHandle()
  const maps = new Map<RemapTarget, Map<number, number>>()
  for (const target of ['units', 'lessons', 'exercises', 'cards', 'conversations', 'focus_tracks'] as RemapTarget[]) {
    maps.set(target, new Map())
  }

  const remap = (target: RemapTarget, oldId: unknown): number | null =>
    oldId == null ? null : (maps.get(target)?.get(Number(oldId)) ?? null)

  const warnings: string[] = []
  const counts: Record<string, number> = {}

  const profileId = db.transaction(() => {
    const meta = envelope.manifest.profile
    const created = db
      .prepare(
        `insert into profiles (name, color, target_lang, native_lang, goal, cefr, focus_mix, prefs,
            onboarding_completed_at, placement_score, created_at, last_used_at)
         values (@name, @color, @target_lang, @native_lang, @goal, @cefr, @focus_mix, @prefs,
            @onboarding_completed_at, @placement_score, @created_at, @last_used_at)`
      )
      .run({
        name: input.name?.trim() || meta.name,
        color: meta.color,
        target_lang: meta.targetLang,
        native_lang: meta.nativeLang,
        goal: meta.goal,
        cefr: meta.cefr,
        focus_mix: meta.focusMix,
        // `prefs` guarda o teste de nivelamento (pertence ao aluno, não ao app).
        prefs: meta.prefs,
        onboarding_completed_at: meta.onboardingCompletedAt,
        placement_score: meta.placementScore,
        created_at: Date.now(),
        last_used_at: Date.now()
      })
    return Number(created.lastInsertRowid)
  })()

  for (const spec of TABLE_SPECS) {
    const rows = envelope.tables[spec.name] as Row[]
    counts[spec.name] = 0
    if (rows.length === 0) continue

    const all = Object.keys(rows[0] as Row)
    if (all.length === 0) continue

    // Id do arquivo NUNCA entra: a tabela remapeada recebe id novo do
    // autoincremento, e é esse id que os filhos passam a apontar. Importar o id
    // velho colidiria com o perfil que já existe no aparelho.
    const columns = spec.remapsId ? all.filter((column) => column !== 'id') : all

    const statement = db.prepare(
      `insert into ${spec.name} (${columns.join(', ')}) values (${columns.map((column) => `@${column}`).join(', ')})`
    )

    const insertMany = db.transaction(() => {
      for (const source of rows) {
        const next: Row = {}
        let dropped: string | null = null

        const locator = String(source.id ?? source.rowid ?? '')

        for (const column of columns) {
          const value: unknown = source[column]

          // Dono da linha: sempre o perfil recém-criado, nunca o id do arquivo.
          if (spec.hasProfile && column === 'profile_id') {
            next[column] = profileId
            continue
          }

          const target = spec.refs?.[column]
          if (target) {
            if (value == null) {
              next[column] = null
              continue
            }
            const mapped = remap(target, value)
            if (mapped == null) {
              dropped = `${spec.name}:${locator || String(value)}→${target}`
              break
            }
            next[column] = mapped
            continue
          }

          // Id que mora dentro de JSON (payload do card, resumo da sessão).
          if (spec.jsonRefs && column === spec.jsonRefs.column && typeof value === 'string' && value.trim()) {
            const rewritten = rewriteJsonIds(value, spec.jsonRefs.keys, remap)
            if (rewritten == null) {
              dropped = `${spec.name}:${locator || 'linha'}→json`
              break
            }
            next[column] = rewritten
            continue
          }

          next[column] = value
        }

        if (dropped) {
          warnings.push(dropped)
          continue
        }

        // Sessão guiada parada no meio, vinda de outra máquina: entra encerrada.
        if (spec.name === 'study_sessions' && source.kind === 'guided' && source.ended_at == null) {
          next.ended_at = Number(source.started_at ?? Date.now())
        }

        const result = statement.run(next)
        if (spec.remapsId) {
          maps.get(spec.name as RemapTarget)?.set(Number(source.id), Number(result.lastInsertRowid))
        }
        counts[spec.name] = (counts[spec.name] ?? 0) + 1
      }
    })

    insertMany()
  }

  const audioSkipped = importAudioCache(db, profileId, (envelope.tables.audio_cache ?? []) as Row[])

  return {
    profileId,
    name: input.name?.trim() || envelope.manifest.profile.name,
    targetLang: envelope.manifest.profile.targetLang,
    nativeLang: envelope.manifest.profile.nativeLang,
    counts,
    warnings: warnings.slice(0, 12),
    audioSkipped,
    stale: envelope.manifest.stale
  }
}

/** Cache de áudio: entra quando cabe, é ignorado quando não — nunca bloqueia o import. */
function importAudioCache(db: ReturnType<typeof getDbHandle>, profileId: number, rows: Row[]): number {
  if (rows.length === 0) return 0

  const insert = db.prepare(
    `insert or ignore into audio_cache
       (key, profile_id, kind, text, lang, voice, model, mime, bytes, duration_ms, schema_version, created_at, last_used_at, hits)
     values (@key, @profile_id, @kind, @text, @lang, @voice, @model, @mime, @bytes, @duration_ms, @schema_version, @created_at, @last_used_at, @hits)`
  )

  let skipped = 0
  const addAudio = db.transaction(() => {
    for (const row of rows) {
      const raw = row.bytes
      const bytes = typeof raw === 'string' ? Buffer.from(raw, 'base64') : Buffer.isBuffer(raw) ? raw : null
      if (!bytes || bytes.length === 0) {
        skipped += 1
        continue
      }
      try {
        insert.run({
          key: `p${profileId}:${String(row.key ?? '').slice(0, 150)}`,
          profile_id: profileId,
          kind: String(row.kind ?? 'tts'),
          text: String(row.text ?? ''),
          lang: String(row.lang ?? ''),
          voice: (row.voice as string | null) ?? null,
          model: (row.model as string | null) ?? null,
          mime: String(row.mime ?? 'audio/wav'),
          bytes,
          duration_ms: (row.duration_ms as number | null) ?? null,
          schema_version: Number(row.schema_version ?? SCHEMA_VERSION),
          created_at: Number(row.created_at ?? Date.now()),
          last_used_at: Date.now(),
          hits: Number(row.hits ?? 0)
        })
      } catch {
        skipped += 1
      }
    }
  })

  addAudio()
  return skipped
}

/**
 * Reescreve os ids que moram dentro de uma coluna JSON (`cards.content`,
 * `study_sessions.summary`). Devolve `null` quando um id apontava para fora do
 * arquivo: a linha é contada como descartada, não inserida pela metade.
 * JSON podre entra como estava — o leitor já trata payload inválido como stale.
 */
function rewriteJsonIds(
  json: string,
  keys: Record<string, RemapTarget>,
  remap: (target: RemapTarget, oldId: unknown) => number | null
): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch {
    return json
  }

  if (!parsed || typeof parsed !== 'object') return json
  const record = parsed as Record<string, unknown>

  for (const [field, target] of Object.entries(keys)) {
    if (typeof record[field] === 'number') {
      const mapped = remap(target, record[field])
      if (mapped == null) return null
      record[field] = mapped
    }
  }

  return JSON.stringify(record)
}

/** Diálogo de abertura de arquivo (o import também aceita JSON colado). */
export async function pickBackupFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Escolher backup',
    properties: ['openFile'],
    filters: [{ name: 'Language Teacher backup', extensions: ['json'] }]
  })
  return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null)
}

/** Canais da v2: backup e restauração. */
export function registerPortableIpc(): void {
  // Nota: sem `path` no contrato — escrever em disco é sempre decisão do usuário
  // pelo diálogo do SO. `exportProfileToFile(..., { path })` continua existindo
  // para teste/automação, só não é alcançável pelo renderer.
  handle(
    'data:export',
    (_event, input: { profileId?: number; includeAudio?: boolean } = {}): Promise<ExportFileView> =>
      exportProfileToFile(input.profileId ?? activeProfileId(), { includeAudio: input.includeAudio })
  )

  handle('data:inspect', (_event, input: { path?: string; json?: string } = {}): InspectView => inspectSource(input))

  handle('data:pick-file', (): Promise<string | null> => pickBackupFile())

  handle('data:import', (_event, input: { path?: string; json?: string; name?: string | null; switch?: boolean }) => {
    const result = importProfile(input)
    if (input.switch !== false) setActiveProfile(result.profileId)
    return result
  })

  handle('data:active-profile', (): number => readActiveProfileId() ?? activeProfileId())
}
