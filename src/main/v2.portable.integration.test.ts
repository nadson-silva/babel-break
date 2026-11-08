/**
 * V2 — round-trip do backup (export → import), sem IA e sem GUI.
 *
 * É o teste que segura a promessa do plano: *export/import sobre `schemaVersion`
 * (D1) e FK (C5)*. Além de contar linhas, ele prova o que importa:
 *
 * - o carimbo de versão viaja no arquivo, e versão divergente é **recusada**
 *   antes de escrever qualquer coisa;
 * - ids são remapeados — inclusive os que moram **dentro** de JSON
 *   (`cards.content.lessonId`, `study_sessions.summary`);
 * - o perfil importado abre a lição **do cache** (mesma `version`: nada foi
 *   regerado) e a memória (caderno, fila SRS, progresso, trilha, cenário) responde igual;
 * - segredo e estado do aparelho (`settings`, provedor, perfil ativo) não viajam;
 * - linha órfã no arquivo derruba o import inteiro, não uma metade.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, getDbHandle, initDatabase, schema } from './db'
import { updateSettings } from './settings'
import { PROMPT_VERSION, SCHEMA_VERSION } from '../core/schemas'
import { EXPORT_TABLES } from '../core/portable'
import {
  answerExercise,
  completeOnboarding,
  curriculumView,
  finishLesson,
  generateCurriculum,
  openLesson
} from './learning'
import { notebookView, recordCorrections } from './notebook'
import { answerReview, reviewState } from './review'
import { approveTrack, createTrackDraft, tracksView } from './tracks'
import { finishScenarioRun, startScenarioRun } from './scenario'
import { createConversation, sendTurn } from './tutor'
import { submitReport } from './reports'
import { activeProfile, setActiveProfile } from './profiles'
import { resetProviderStatus } from './provider-status'
import { buildEnvelope, exportProfileJson, exportProfileToFile, importProfile, inspectSource } from './portable'

const SOURCE = {
  profileId: 0,
  lessonId: 0,
  exerciseId: 0,
  cardId: 0,
  trackId: 0,
  json: ''
}

const IMPORTED = {
  profileId: 0,
  lessonIds: [] as number[]
}

type Countable = (typeof EXPORT_TABLES)[number]

/**
 * `select count(*)` cru, com a mesma cadeia de posse usada pelo export. O handle
 * do better-sqlite3 é o caminho honesto aqui: 18 tabelas, uma contagem por
 * tabela — mapear tudo no ORM seria teste maior que o código testado.
 */
function countFor(table: Countable, profileId: number): number {
  const row = getDbHandle()
    .prepare(`select count(*) as n from ${table} where ${WHERE_BY_TABLE[table]}`)
    .get({ p: profileId }) as { n?: number } | undefined
  return Number(row?.n ?? 0)
}

const WHERE_BY_TABLE: Record<Countable, string> = {
  skills_state: 'profile_id = @p',
  units: 'profile_id = @p',
  lessons: `(profile_id = @p or unit_id in (select id from units where profile_id = @p) or track_id in (select id from focus_tracks where profile_id = @p))`,
  lesson_items: 'lesson_id in (select id from lessons where profile_id = @p)',
  exercises: 'lesson_id in (select id from lessons where profile_id = @p)',
  attempts: 'exercise_id in (select id from exercises where lesson_id in (select id from lessons where profile_id = @p))',
  errors: 'profile_id = @p',
  cards: 'profile_id = @p',
  reviews: 'card_id in (select id from cards where profile_id = @p)',
  lesson_progress: 'profile_id = @p',
  study_sessions: 'profile_id = @p',
  conversations: 'profile_id = @p',
  messages: 'conversation_id in (select id from conversations where profile_id = @p)',
  focus_tracks: 'profile_id = @p',
  track_lessons: 'track_id in (select id from focus_tracks where profile_id = @p)',
  scenario_runs: 'conversation_id in (select id from conversations where profile_id = @p)',
  speech_runs: 'profile_id = @p',
  content_reports: 'profile_id = @p'
}

beforeAll(async () => {
  initDatabase()
  updateSettings({ provider: 'ollama', ollamaModel: '', ollamaBaseUrl: 'http://127.0.0.1:1', pregenerate: false })
  resetProviderStatus()

  const state = completeOnboarding({ goal: 'entrevista para dev', cefr: 'A2' })
  SOURCE.profileId = state.profile.id
  await generateCurriculum(state.profile.id)

  const lesson = curriculumView(state.profile.id).units[0]?.lessons[0]
  if (!lesson) throw new Error('currículo vazio')
  SOURCE.lessonId = lesson.id

  // Prática real: abre, responde, fecha (cards + progresso + sessão + skills).
  const detail = await openLesson(lesson.id, state.profile.id)
  const firstExercise = detail.exercises[0]?.id
  const secondExercise = detail.exercises[1]?.id
  if (!firstExercise || !secondExercise) throw new Error('lição sem exercícios')
  SOURCE.exerciseId = firstExercise
  await answerExercise({ exerciseId: firstExercise, response: 'não sei nada' }, state.profile.id)
  await answerExercise({ exerciseId: secondExercise, response: 'x' }, state.profile.id)
  finishLesson({ lessonId: lesson.id, sessionId: detail.sessionId }, state.profile.id)

  // Caderno + revisão + report com efeito real.
  recordCorrections(
    state.profile.id,
    [{ original: 'I am agree', corrected: 'I agree', tag: 'be-vs-verb', source: 'bank' }],
    { category: 'exercise', context: lesson.title }
  )
  const queue = reviewState(state.profile.id, 5)
  const card = queue.due[0]
  if (!card) throw new Error('fila de revisão vazia')
  SOURCE.cardId = card.id
  answerReview(state.profile.id, card.id, 'good')
  submitReport(
    { kind: 'correction', targetId: null, reason: 'unfair_correction', context: { text: 'I am agree', tag: 'be-vs-verb' } },
    state.profile.id
  )

  // Conversa com turno corrigido (caminho determinístico, sem IA).
  const conversation = await createConversation(state.profile.id, { topic: 'viagem' })
  await sendTurn(
    state.profile.id,
    {
      requestId: 'rt-1',
      conversationId: conversation.conversation.id,
      text: 'I am agree with you and people is fine'
    },
    () => undefined
  )

  // Trilha de foco aprovada (lição com `track_id` + `track_lessons`).
  const draft = await createTrackDraft(state.profile.id, { objective: 'entrevista para dev backend' })
  SOURCE.trackId = draft.id
  approveTrack(state.profile.id, draft.id)

  // Roleplay fechado: rubrica em `scenario_runs`.
  const scenarioLesson = tracksView(state.profile.id).active[0]?.scenarioLesson
  if (scenarioLesson) {
    const run = await startScenarioRun(state.profile.id, { lessonId: scenarioLesson.id })
    await finishScenarioRun(state.profile.id, run.conversation.id)
  }

  // Voz: uma fala entra no dump (tabela da v2).
  getDb()
    .insert(schema.speechRuns)
    .values({
      profileId: state.profile.id,
      lessonId: lesson.id,
      kind: 'speak',
      target: 'I agree',
      transcript: 'I agree',
      score: 0.9,
      skill: 'speaking',
      source: 'fallback',
      createdAt: Date.now()
    })
    .run()

  SOURCE.json = exportProfileJson(state.profile.id)
})

describe('exportar para arquivo', () => {
  it('escreve no caminho pedido, e o import lê do mesmo caminho', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-backup-'))
    const file = path.join(dir, 'perfil.json')

    const exported = await exportProfileToFile(SOURCE.profileId, { path: file })
    expect(exported.cancelled).toBe(false)
    expect(exported.path).toBe(file)
    expect(exported.bytes).toBeGreaterThan(1_000)
    expect(fs.existsSync(file)).toBe(true)

    const view = inspectSource({ path: file })
    expect(view.ok).toBe(true)

    const result = importProfile({ path: file, name: 'Do arquivo' })
    expect(result.profileId).not.toBe(SOURCE.profileId)
    expect(result.counts['lessons']).toBe(view.ok ? view.counts['lessons'] : 0)

    // O caminho cancelado pelo usuário não é erro: é `cancelled`.
    const cancelled = await exportProfileToFile(SOURCE.profileId)
    expect(cancelled.cancelled).toBe(true)
    expect(cancelled.path).toBeNull()

    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('exportar', () => {
  it('carimba o arquivo com a versão do contrato (D1)', () => {
    const envelope = buildEnvelope(SOURCE.profileId)
    expect(envelope.manifest.schemaVersion).toBe(SCHEMA_VERSION)
    expect(envelope.manifest.promptVersion).toBe(PROMPT_VERSION)
    expect(envelope.manifest.dbVersion).toBeGreaterThanOrEqual(8)
    expect(envelope.manifest.appVersion).toBeTruthy()
    expect(envelope.manifest.counts['lessons']).toBeGreaterThan(0)
  })

  it('não leva segredo nem estado do aparelho', () => {
    expect(SOURCE.json).not.toContain('"settings"')
    expect(SOURCE.json).not.toContain('activeProfile')
    expect(SOURCE.json).not.toContain('geminiApiKey')
  })

  it('a inspeção aceita o próprio dump e conta o que tem dentro', () => {
    const view = inspectSource({ json: SOURCE.json })
    expect(view.ok).toBe(true)
    if (!view.ok) return
    expect(view.counts['attempts']).toBe(2)
    expect(view.counts['conversations']).toBeGreaterThanOrEqual(1)
    expect(view.counts['speech_runs']).toBe(1)
    expect(view.manifest.stale.lessonContent).toBe(0)
    // Lição nunca gerada não é "linha velha": só conta conteúdo que existe fora do contrato.
    expect(view.counts['lessons']).toBeGreaterThan(view.counts['lesson_items'])
  })
})

describe('importar', () => {
  beforeAll(() => {
    const result = importProfile({ json: SOURCE.json, name: 'Ana (backup)' })
    IMPORTED.profileId = result.profileId
    setActiveProfile(result.profileId)

    IMPORTED.lessonIds = getDb()
      .select({ id: schema.lessons.id })
      .from(schema.lessons)
      .where(eq(schema.lessons.profileId, result.profileId))
      .all()
      .map((row) => row.id)
  })

  it('cria perfil novo, com ids novos, e traz todas as linhas', () => {
    expect(IMPORTED.profileId).not.toBe(SOURCE.profileId)
    expect(IMPORTED.lessonIds.length).toBeGreaterThan(0)
    expect(IMPORTED.lessonIds).not.toContain(SOURCE.lessonId)

    const view = inspectSource({ json: SOURCE.json })
    expect(view.ok).toBe(true)
    if (!view.ok) return

    for (const table of EXPORT_TABLES) {
      expect(countFor(table, IMPORTED.profileId), table).toBe(view.counts[table] ?? 0)
    }
  })

  it('remapeia ids que moram dentro de JSON (card → lição, sessão → lição)', () => {
    const lessons = new Set(IMPORTED.lessonIds)

    const cards = getDb()
      .select({ content: schema.cards.content })
      .from(schema.cards)
      .where(eq(schema.cards.profileId, IMPORTED.profileId))
      .all()
    expect(cards.length).toBeGreaterThan(0)

    for (const row of cards) {
      const payload = JSON.parse(row.content) as { lessonId?: number | null }
      if (payload.lessonId != null) expect(lessons.has(payload.lessonId), 'card.content.lessonId').toBe(true)
    }

    const sessions = getDb()
      .select({ summary: schema.studySessions.summary })
      .from(schema.studySessions)
      .where(eq(schema.studySessions.profileId, IMPORTED.profileId))
      .all()

    for (const row of sessions) {
      if (!row.summary) continue
      const summary = JSON.parse(row.summary) as { lessonId?: number }
      if (summary.lessonId != null) expect(lessons.has(summary.lessonId), 'summary.lessonId').toBe(true)
    }
  })

  it('a memória responde igual: cache abre sem regerar, caderno e SRS no lugar', async () => {
    const cached = getDb()
      .select({ id: schema.lessons.id, version: schema.lessons.version })
      .from(schema.lessons)
      .where(and(eq(schema.lessons.profileId, IMPORTED.profileId), sql`${schema.lessons.content} is not null`))
      .all()
    expect(cached.length).toBeGreaterThan(0)
    const target = cached[0]
    if (!target) return

    const detail = await openLesson(target.id, IMPORTED.profileId)
    expect(detail.exercises.length).toBeGreaterThan(0)

    const after = getDb()
      .select({ version: schema.lessons.version })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, target.id))
      .get()?.version
    expect(after).toBe(target.version)

    expect(reviewState(IMPORTED.profileId, 20).total).toBeGreaterThan(0)

    const notebook = notebookView(IMPORTED.profileId)
    expect(notebook.tags.some((tag) => tag.tag === 'be-vs-verb')).toBe(true)
    expect(notebook.bankPair).toEqual({ native: 'pt-BR', target: 'en' })

    const completed = getDb()
      .select({ value: sql<number>`count(*)` })
      .from(schema.lessonProgress)
      .where(and(eq(schema.lessonProgress.profileId, IMPORTED.profileId), eq(schema.lessonProgress.status, 'completed')))
      .get()
    expect(Number(completed?.value ?? 0)).toBe(1)

    const tracks = tracksView(IMPORTED.profileId)
    expect(tracks.active).toHaveLength(1)
    expect(tracks.active[0]?.lessons.length).toBeGreaterThan(0)

    expect(countFor('scenario_runs', IMPORTED.profileId)).toBeGreaterThanOrEqual(1)
  })

  it('recusa backup de outra versão, arquivo podre e linha órfã', () => {
    const wrongVersion = JSON.parse(SOURCE.json) as { manifest: { schemaVersion: number } }
    wrongVersion.manifest.schemaVersion = SCHEMA_VERSION + 3
    expect(() => importProfile({ json: JSON.stringify(wrongVersion) })).toThrow(/outra versão/)

    expect(() => importProfile({ json: 'não é json' })).toThrow(/JSON/)

    const orphaned = JSON.parse(SOURCE.json) as { tables: { exercises: Record<string, unknown>[] } }
    orphaned.tables.exercises.push({
      id: 999_999,
      lesson_id: 999_998,
      type: 'cloze',
      payload: '{}',
      answer_key: '{}',
      position: 0,
      blocked: 0,
      created_at: Date.now()
    })
    expect(() => importProfile({ json: JSON.stringify(orphaned) })).toThrow(/órfãs/)
    expect(inspectSource({ json: JSON.stringify(orphaned) }).ok).toBe(false)
  })

  it('sessão guiada inacabada de outra máquina entra encerrada', () => {
    const db = getDb()
    const now = Date.now()
    const open = db
      .insert(schema.studySessions)
      .values({
        profileId: SOURCE.profileId,
        kind: 'guided',
        startedAt: now - 60_000,
        endedAt: null,
        summary: JSON.stringify({ step: 'practice', lessonId: SOURCE.lessonId, review: { dueCount: 0, done: 0 }, practice: { correct: 0, total: 0 } })
      })
      .returning()
      .get()

    const result = importProfile({ json: exportProfileJson(SOURCE.profileId), name: 'Sessões' })

    const importedSession = db
      .select({ endedAt: schema.studySessions.endedAt })
      .from(schema.studySessions)
      .where(and(eq(schema.studySessions.profileId, result.profileId), eq(schema.studySessions.kind, 'guided')))
      .get()

    expect(importedSession?.endedAt).not.toBeNull()
    expect(open.endedAt).toBeNull()
  })

  it('o perfil exportado continua intacto depois do import', () => {
    expect(activeProfile().id).toBe(IMPORTED.profileId)

    const sourceLessons = getDb()
      .select({ id: schema.lessons.id })
      .from(schema.lessons)
      .where(eq(schema.lessons.profileId, SOURCE.profileId))
      .all()
    expect(sourceLessons.some((row) => row.id === SOURCE.lessonId)).toBe(true)

    // O card original continua sendo do perfil original (nada foi "migrado").
    const card = getDb()
      .select({ profileId: schema.cards.profileId })
      .from(schema.cards)
      .where(inArray(schema.cards.id, [SOURCE.cardId]))
      .get()
    expect(card?.profileId).toBe(SOURCE.profileId)
  })
})
