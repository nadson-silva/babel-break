/**
 * Pré-geração e cache de conteúdo (M5).
 *
 * O risco que o plano aponta (§11, rate limit do free tier do Gemini) se resolve
 * assim: quando o app fica ocioso, ele gera **antes** a próxima lição provável e
 * guarda no SQLite. O aluno abre a lição e ela vem pronta — sem spinner, sem
 * gastar token no momento do estudo, e funcionando offline depois.
 *
 * Três regras fazem disso uma bondade e não uma martelada no provedor:
 *
 * 1. **Fila de uma por vez.** Um ciclo aquece no máximo `JOBS_PER_CYCLE` itens,
 *    serialmente. Se houver chamada de IA do aluno em andamento (`aiInFlight`),
 *    o ciclo espera — a interação dele sempre tem prioridade.
 * 2. **Só aquece com IA disponível.** Sem IA, gerar conteúdo do gerador local
 *    congelaria a lição no modo pobre e o aluno nunca receberia a versão boa.
 *    Sem provedor, o ciclo devolve `unavailable` e não toca no cache.
 * 3. **Não regera o que já serve.** Lição com conteúdo, sem marca de "ruim" e
 *    com exercícios suficientes fica fora da fila.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { handle } from './ipc-contract'
import { and, eq, sql } from 'drizzle-orm'
import type { CacheStats, PrewarmCycleOutcome, PrewarmOutcome, PrewarmState } from '../shared/types'
import { aiInFlight } from './ai'
import { getDb, schema } from './db'
import { activeProfileId } from './profiles'
import { onStudentEvent, type StudentEvent } from './events'
import { prewarmLesson, pendingLessons } from './learning'
import { ensureLessonScenario } from './scenario'
import { providerStatus, refreshProviderStatus } from './provider-status'
import { getSettings } from './settings'

const SETTINGS_KEY = 'prewarm'

/** Ocioso = 12 s sem o aluno pedir nada. Menos que isso competiria com a prática. */
const IDLE_DELAY_MS = 12_000

/** Reavaliação periódica, para quem deixa a janela aberta. */
const HEARTBEAT_MS = 5 * 60_000

/** Itens por ciclo: o rate limit do free tier é o risco que este teto mitiga. */
const JOBS_PER_CYCLE = 2

/** Exercícios mínimos para uma lição contar como "já serve". */
const EXERCISE_FLOOR = 4

interface StoredOutcome extends PrewarmOutcome {
  storedAt: number
}

let running = false
let timer: NodeJS.Timeout | null = null
let heartbeat: NodeJS.Timeout | null = null
let lastOutcome: PrewarmOutcome | null = null

function readStoredOutcome(): PrewarmOutcome | null {
  if (lastOutcome) return lastOutcome
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, SETTINGS_KEY)).get()
  if (!row) return null
  try {
    const parsed = JSON.parse(row.value) as StoredOutcome
    return { ...parsed, at: parsed.at || parsed.storedAt }
  } catch {
    return null
  }
}

function writeStoredOutcome(outcome: PrewarmOutcome): void {
  lastOutcome = outcome
  const value = JSON.stringify({ ...outcome, storedAt: outcome.at } satisfies StoredOutcome)
  getDb()
    .insert(schema.settings)
    .values({ key: SETTINGS_KEY, value, updatedAt: outcome.at })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: outcome.at } })
    .run()
}

export function dbSizeBytes(): number {
  try {
    const file = path.join(app.getPath('userData'), 'language-teacher.db')
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/**
 * O que já está salvo e, portanto, abre sem IA e sem token.
 * V2: escopado por perfil — com dois alunos no mesmo aparelho, "3 lições em
 * cache" do perfil de inglês não pode aparecer no painel de quem estuda japonês.
 */
export function cacheStats(profileId = activeProfileId()): CacheStats {
  const db = getDb()
  const owned = sql`coalesce(${schema.lessons.profileId}, ${schema.units.profileId}, ${schema.focusTracks.profileId}) = ${profileId}`

  const lessonCounts = db
    .select({
      total: sql<number>`count(*)`,
      cached: sql<number>`sum(case when ${schema.lessons.content} is not null then 1 else 0 end)`,
      prewarmed: sql<number>`sum(case when ${schema.lessons.prewarmedAt} is not null then 1 else 0 end)`,
      scenarios: sql<number>`sum(case when ${schema.lessons.scenario} is not null then 1 else 0 end)`
    })
    .from(schema.lessons)
    .leftJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
    .leftJoin(schema.focusTracks, eq(schema.focusTracks.id, schema.lessons.trackId))
    .where(owned)
    .get()

  const exerciseCounts = db
    .select({
      cached: sql<number>`sum(case when ${schema.exercises.blocked} = 0 then 1 else 0 end)`,
      hidden: sql<number>`sum(case when ${schema.exercises.blocked} = 1 then 1 else 0 end)`
    })
    .from(schema.exercises)
    .innerJoin(schema.lessons, eq(schema.lessons.id, schema.exercises.lessonId))
    .leftJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
    .leftJoin(schema.focusTracks, eq(schema.focusTracks.id, schema.lessons.trackId))
    .where(owned)
    .get()

  return {
    lessonsCached: Number(lessonCounts?.cached ?? 0),
    lessonsTotal: Number(lessonCounts?.total ?? 0),
    prewarmedLessons: Number(lessonCounts?.prewarmed ?? 0),
    exercisesCached: Number(exerciseCounts?.cached ?? 0),
    exercisesHidden: Number(exerciseCounts?.hidden ?? 0),
    scenariosCached: Number(lessonCounts?.scenarios ?? 0),
    dbBytes: dbSizeBytes()
  }
}

export function prewarmState(profileId = activeProfileId()): PrewarmState {
  return {
    ...cacheStats(profileId),
    enabled: getSettings().pregenerate,
    running,
    lastOutcome: readStoredOutcome(),
    ai: providerStatus()
  }
}

interface Candidate {
  lessonId: number
  title: string
  /** Precisa de conteúdo/exercícios? */
  needsContent: boolean
  /** Precisa de persona de cenário (lição de trilha que fecha em roleplay)? */
  needsScenario: boolean
  origin: 'base' | 'focus'
}

/**
 * Quem entra na fila: a próxima lição sugerida de cada camada, e no máximo uma
 * por camada por ciclo. Lição reportada como ruim (stale) volta para a fila.
 */
export function pickCandidates(limit = JOBS_PER_CYCLE, profileId = activeProfileId()): Candidate[] {
  const db = getDb()
  const pending = pendingLessons(profileId)

  const candidates: Candidate[] = []

  const needs = (lessonId: number): { needsContent: boolean; needsScenario: boolean } => {
    const lesson = db
      .select({
        content: schema.lessons.content,
        scenario: schema.lessons.scenario,
        staleAt: schema.lessons.staleAt
      })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId))
      .get()

    const exercises = Number(
      db
        .select({ value: sql<number>`count(*)` })
        .from(schema.exercises)
        .where(and(eq(schema.exercises.lessonId, lessonId), eq(schema.exercises.blocked, false)))
        .get()?.value ?? 0
    )

    return {
      needsContent: !lesson?.content || lesson.staleAt != null || exercises < EXERCISE_FLOOR,
      needsScenario: lesson?.scenario == null
    }
  }

  for (const group of ['focus', 'base'] as const) {
    const lessons = (group === 'focus' ? pending.focus : pending.base).slice(0, 2)
    for (const lesson of lessons) {
      const state = needs(lesson.id)
      if (!state.needsContent && !state.needsScenario) continue
      candidates.push({
        lessonId: lesson.id,
        title: lesson.title,
        needsContent: state.needsContent,
        needsScenario: state.needsScenario,
        origin: group
      })
      if (candidates.length >= limit) return candidates
    }
  }

  return candidates
}

export type CycleResult = PrewarmCycleOutcome

/**
 * Um ciclo de aquecimento. Chamado pelo agendador ocioso e pelo botão
 * "aquecer agora" das Configurações — e diretamente nos testes de integração.
 */
export async function runPrewarmCycle(profileId = activeProfileId()): Promise<CycleResult> {
  const startedAt = Date.now()
  const empty: CycleResult = {
    at: startedAt,
    lessonId: null,
    lessonTitle: null,
    warmed: { content: 0, exercises: 0, scenarios: 0 },
    source: 'skip',
    detail: null,
    attempted: 0
  }

  if (!getSettings().pregenerate) {
    return { ...empty, detail: 'desativado nas configurações' }
  }
  if (running) {
    return { ...empty, detail: 'aquecimento já em andamento' }
  }

  const status = await refreshProviderStatus()
  if (status.state !== 'ok') {
    return {
      ...empty,
      source: 'unavailable',
      detail: status.detail ?? `IA indisponível (${status.state})`
    }
  }

  const candidates = pickCandidates(JOBS_PER_CYCLE, profileId)
  if (candidates.length === 0) {
    return { ...empty, detail: 'nada novo para aquecer' }
  }

  running = true
  const warmed = { content: 0, exercises: 0, scenarios: 0 }
  let source: PrewarmOutcome['source'] = 'ai'
  let detail: string | null = null
  let first: Candidate | null = null
  let attempted = 0

  try {
    for (const candidate of candidates) {
      if (aiInFlight() > 0) {
        detail = 'o aluno está usando a IA agora — ciclo adiado'
        source = 'skip'
        break
      }

      attempted += 1
      first ??= candidate

      if (candidate.needsContent) {
        try {
          const result = await prewarmLesson(candidate.lessonId, profileId)
          warmed.content += result.content ? 1 : 0
          warmed.exercises += result.exercises
          if (result.source === 'fallback') source = 'fallback'
        } catch (error) {
          detail = error instanceof Error ? error.message : String(error)
          source = 'unavailable'
          break
        }
      }

      if (candidate.needsScenario) {
        try {
          await ensureLessonScenario(candidate.lessonId, profileId)
          warmed.scenarios += 1
        } catch (error) {
          detail = detail ?? (error instanceof Error ? error.message : String(error))
        }
      }
    }
  } finally {
    running = false
  }

  const outcome: CycleResult = {
    at: Date.now(),
    lessonId: first?.lessonId ?? null,
    lessonTitle: first?.title ?? null,
    warmed,
    source,
    detail,
    attempted
  }

  writeStoredOutcome({
    at: outcome.at,
    lessonId: outcome.lessonId,
    lessonTitle: outcome.lessonTitle,
    warmed: outcome.warmed,
    source: outcome.source,
    detail: outcome.detail
  })

  return outcome
}

function schedule(delayMs: number): void {
  if (!getSettings().pregenerate) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runPrewarmCycle().catch((error) => {
      console.warn('[prewarm] ciclo falhou:', error instanceof Error ? error.message : error)
    })
  }, delayMs)
  timer.unref?.()
}

/** Evento do aluno acabou de acontecer: reaquece depois que a poeira baixar. */
export function schedulePrewarm(_event?: StudentEvent, delayMs = IDLE_DELAY_MS): void {
  schedule(delayMs)
}

export function stopPrewarmWatch(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

let unsubscribe: (() => void) | null = null

/** Liga o agendador ocioso: eventos do aluno + batida periódica. */
export function startPrewarmWatch(): void {
  stopPrewarmWatch()
  unsubscribe?.()
  unsubscribe = onStudentEvent(() => schedulePrewarm())
  heartbeat = setInterval(() => schedulePrewarm(undefined, 0), HEARTBEAT_MS)
  heartbeat.unref?.()
}

export function registerPrewarmIpc(): void {
  handle('pregen:state', (): PrewarmState => prewarmState())
  handle('pregen:run', () => runPrewarmCycle())
  handle('cache:stats', (): CacheStats => cacheStats())
}

/** V2: trocar de perfil reaquece a fila para o aluno que passou a estudar. */

/** Só para teste: estado interno limpo entre casos. */
export function resetPrewarmForTest(): void {
  stopPrewarmWatch()
  lastOutcome = null
  running = false
}
