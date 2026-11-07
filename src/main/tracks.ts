/**
 * Trilhas de foco (M3) — mini-currículo persistente, nivelado e orientado a
 * cenários, dentro do processo main.
 *
 * Fluxo travado de propósito: o aluno digita um objetivo → `track_plan` gera um
 * esboço → o aluno **revisa/aprova** → só então as lições existem no banco. Isso
 * mantém o currículo coerente e barato de regerar, e é o que impede uma trilha
 * de "entrevista" de entregar linguagem C1 para alguém em A2: o nível da trilha
 * é o nível do aluno no momento da aprovação.
 */
import { ipcMain } from 'electron'
import { and, asc, eq } from 'drizzle-orm'
import type {
  CefrLevel,
  FocusTrackView,
  LessonSummary,
  LessonStatus,
  TrackPlanDraft,
  TrackPlanLesson,
  TracksView,
  TrackSource,
  TrackStatus
} from '../shared/types'
import { clampLevel } from '../core/cefr'
import {
  TRACK_SUGGESTIONS,
  detectBucket,
  fallbackScenario,
  fallbackTrackPlan,
  isScenarioLesson,
  levelRangeFrom,
  normalizeTrackPlan,
  trackLessonLevel
} from '../core/tracks'
import { deterministicContentSupported } from '../core/languages'
import { promptLocale, trackPlanPrompt } from '../core/prompts'
import { trackPlanSchema } from '../core/schemas'
import { generateStructured } from './ai'
import { emitStudentEvent } from './events'
import { getDb, getDefaultProfile, schema } from './db'
import { getSettings } from './settings'

type TrackRow = typeof schema.focusTracks.$inferSelect
type LessonRow = typeof schema.lessons.$inferSelect
type ProgressRow = typeof schema.lessonProgress.$inferSelect

export type ScenarioSeed = ReturnType<typeof scenarioSeed>

function toStatus(value: string | null | undefined): LessonStatus {
  return value === 'in_progress' || value === 'completed' ? value : 'not_started'
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function parseTrackPlan(row: TrackRow): TrackPlanDraft | null {
  return parseJson<TrackPlanDraft>(row.plan)
}

function draftOf(
  plan: Pick<TrackPlanDraft, 'title' | 'goalTag' | 'lessons'>,
  objective: string,
  level: CefrLevel,
  source: 'ai' | 'fallback'
): TrackPlanDraft {
  return {
    title: plan.title,
    goalTag: plan.goalTag,
    lessons: plan.lessons,
    objective,
    level,
    levelRange: levelRangeFrom(level),
    source
  }
}

/**
 * Cenário que nasce junto com a lição de foco marcada para roleplay. A
 * variação por IA acontece na abertura do cenário; aqui fica o seed do banco
 * local, para a trilha ter cenário mesmo sem modelo configurado.
 */
function scenarioSeed(plan: TrackPlanDraft, index: number) {
  const lesson = plan.lessons[index]
  const bucket = detectBucket(`${plan.goalTag} ${plan.objective} ${lesson.title}`)
  return { ...fallbackScenario(bucket), source: 'fallback' as const, trackGoalTag: plan.goalTag }
}

export function storedScenarioSeed(json: string | null | undefined): ScenarioSeed | null {
  return parseJson<ScenarioSeed>(json)
}

/** Lições de uma trilha, com progresso do perfil e a marca de cenário por posição. */
function lessonsOfTrack(track: TrackRow, profileId: number): LessonSummary[] {
  const db = getDb()

  const rows = db
    .select({ lesson: schema.lessons, position: schema.trackLessons.position })
    .from(schema.trackLessons)
    .innerJoin(schema.lessons, eq(schema.lessons.id, schema.trackLessons.lessonId))
    .where(eq(schema.trackLessons.trackId, track.id))
    .orderBy(asc(schema.trackLessons.position), asc(schema.lessons.id))
    .all()

  const progress = db
    .select()
    .from(schema.lessonProgress)
    .where(eq(schema.lessonProgress.profileId, profileId))
    .all()

  const progressByLesson = new Map<number, ProgressRow>(progress.map((row) => [row.lessonId, row]))
  const plan = parseTrackPlan(track)
  const total = rows.length

  return rows.map((row, index) => {
    const entry = progressByLesson.get(row.lesson.id)
    return {
      id: row.lesson.id,
      unitId: null,
      unitTitle: null,
      trackId: track.id,
      trackTitle: track.title,
      title: row.lesson.title,
      level: clampLevel(row.lesson.level),
      position: row.position ?? index,
      status: toStatus(entry?.status),
      score: entry?.score ?? null,
      hasContent: Boolean(row.lesson.content),
      isScenario: plan
        ? isScenarioLesson(row.position ?? index, plan.lessons.length)
        : Boolean(row.lesson.scenario) || index === total - 1
    }
  })
}

/** Dono de uma lição: unidade do currículo base OU trilha de foco do perfil. */
export interface LessonOwner {
  unitId: number | null
  unitTitle: string | null
  trackId: number | null
  trackTitle: string | null
  isScenario: boolean
}

export function ownerOfLesson(lessonId: number, profileId: number): LessonOwner | null {
  const db = getDb()

  const row = db.select().from(schema.lessons).where(eq(schema.lessons.id, lessonId)).get()
  if (!row) return null

  if (row.unitId != null) {
    const unit = db.select().from(schema.units).where(eq(schema.units.id, row.unitId)).get()
    if (!unit || unit.profileId !== profileId) return null
    return { unitId: unit.id, unitTitle: unit.title, trackId: null, trackTitle: null, isScenario: false }
  }

  if (row.trackId == null) return null

  const track = db
    .select()
    .from(schema.focusTracks)
    .where(and(eq(schema.focusTracks.id, row.trackId), eq(schema.focusTracks.profileId, profileId)))
    .get()
  if (!track) return null

  const view = trackView(track, profileId)
  const lesson = view.lessons.find((entry) => entry.id === lessonId)

  return {
    unitId: null,
    unitTitle: null,
    trackId: track.id,
    trackTitle: track.title,
    isScenario: lesson?.isScenario ?? Boolean(row.scenario)
  }
}

export function trackView(track: TrackRow, profileId: number): FocusTrackView {
  const lessons = lessonsOfTrack(track, profileId)

  return {
    id: track.id,
    title: track.title,
    objective: track.objective,
    goalTag: track.goalTag,
    levelRange: track.levelRange,
    status: (track.status as TrackStatus) ?? 'draft',
    source: (track.source as TrackSource) ?? 'user',
    createdAt: track.createdAt,
    approvedAt: track.approvedAt,
    plan: parseTrackPlan(track),
    lessons,
    completedCount: lessons.filter((lesson) => lesson.status === 'completed').length,
    totalCount: lessons.length,
    nextLesson: lessons.find((lesson) => lesson.status !== 'completed') ?? null,
    scenarioLesson: lessons.find((lesson) => lesson.isScenario && lesson.status !== 'completed') ?? null
  }
}

function requireTrack(trackId: number, profileId: number): TrackRow {
  const row = getDb()
    .select()
    .from(schema.focusTracks)
    .where(and(eq(schema.focusTracks.id, trackId), eq(schema.focusTracks.profileId, profileId)))
    .get()

  if (!row) throw new Error('Trilha não encontrada.')
  return row
}

export function tracksView(profileId: number): TracksView {
  const rows = getDb()
    .select()
    .from(schema.focusTracks)
    .where(eq(schema.focusTracks.profileId, profileId))
    .orderBy(schema.focusTracks.createdAt, schema.focusTracks.id)
    .all()

  const views = rows.map((row) => trackView(row, profileId))

  return {
    active: views.filter((view) => view.status === 'active'),
    drafts: views.filter((view) => view.status === 'draft'),
    archived: views.filter((view) => view.status === 'archived'),
    suggestions: TRACK_SUGGESTIONS.map((suggestion) => ({
      title: suggestion.title,
      objective: suggestion.objective,
      goalTag: suggestion.goalTag
    })),
    focusMix: getSettings().focusMix
  }
}

/**
 * Gera (ou regera) o esboço de uma trilha e o guarda como rascunho — nada vira
 * lição antes da aprovação do aluno. Com IA fora do ar, o esboço vem do banco
 * local e continua revisável.
 */
export async function createTrackDraft(
  profileId: number,
  input: { objective: string; source?: TrackSource; replaceId?: number }
): Promise<FocusTrackView> {
  const objective = input.objective.trim()
  if (!objective) throw new Error('Escreva o que você quer praticar (ex.: entrevista para dev).')

  const db = getDb()
  const profile = getDefaultProfile()
  const level = trackLessonLevel(clampLevel(profile.cefr))
  const locale = promptLocale(profile.targetLang, profile.nativeLang)
  const offlineReady = deterministicContentSupported(profile.targetLang)

  // "regerar esboço" reaproveita o rascunho em vez de acumular cópias — validado
  // antes de gastar a chamada.
  if (input.replaceId != null) {
    const current = requireTrack(input.replaceId, profileId)
    if (current.status !== 'draft') throw new Error('Só rascunhos podem ser regenerados.')
  }

  const prompt = trackPlanPrompt({ objective, level, goal: profile.goal ?? objective, locale })

  let plan: TrackPlanDraft
  try {
    const raw = await generateStructured(trackPlanSchema, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.35
    })
    plan = draftOf(normalizeTrackPlan({ raw, objective, level, seedFill: offlineReady }), objective, level, 'ai')
  } catch (error) {
    if (!offlineReady) {
      throw new Error(
        `A IA está indisponível e o banco de trilhas offline só cobre inglês. ` +
          `Para montar uma trilha de ${locale.targetName}, configure um provedor em Configurações.`
      )
    }
    console.warn(
      '[tracks] esboço por IA indisponível, usando o banco local:',
      error instanceof Error ? error.message : error
    )
    plan = draftOf(fallbackTrackPlan({ objective, level }), objective, level, 'fallback')
  }

  if (plan.lessons.length === 0) {
    throw new Error('A IA devolveu um esboço de trilha vazio para este idioma. Tente gerar novamente.')
  }

  const now = Date.now()

  if (input.replaceId != null) {
    const current = requireTrack(input.replaceId, profileId)

    db.update(schema.focusTracks)
      .set({
        title: plan.title,
        goalTag: plan.goalTag,
        objective,
        levelRange: plan.levelRange,
        plan: JSON.stringify(plan)
      })
      .where(eq(schema.focusTracks.id, current.id))
      .run()

    return trackView(requireTrack(current.id, profileId), profileId)
  }

  const row = db
    .insert(schema.focusTracks)
    .values({
      profileId,
      title: plan.title,
      goalTag: plan.goalTag,
      objective,
      levelRange: plan.levelRange,
      plan: JSON.stringify(plan),
      status: 'draft',
      source: input.source ?? 'user',
      createdAt: now,
      approvedAt: null
    })
    .returning()
    .get()

  return trackView(row, profileId)
}

/** Reescreve o rascunho depois da revisão do aluno (renomear, remover, reordenar). */
export function reviseTrackDraft(profileId: number, trackId: number, lessons: TrackPlanLesson[]): FocusTrackView {
  const db = getDb()
  const row = requireTrack(trackId, profileId)
  const current = parseTrackPlan(row)

  if (!current) throw new Error('Esta trilha não tem esboço para revisar.')
  if (row.status !== 'draft') throw new Error('Só rascunhos podem ser revisados. Arquive a trilha e crie outra.')

  const cleaned = lessons
    .map((lesson) => ({
      title: lesson.title.trim().slice(0, 80),
      objective: lesson.objective.trim().slice(0, 160),
      focusVocabulary: (lesson.focusVocabulary ?? []).map((term) => term.trim()).filter(Boolean).slice(0, 10)
    }))
    .filter((lesson) => lesson.title.length > 0)

  if (cleaned.length < 3) throw new Error('Mantenha pelo menos 3 lições no esboço.')
  if (cleaned.length > 8) throw new Error('Uma trilha tem no máximo 8 lições.')

  const plan: TrackPlanDraft = { ...current, lessons: cleaned }

  db.update(schema.focusTracks)
    .set({ plan: JSON.stringify(plan) })
    .where(eq(schema.focusTracks.id, trackId))
    .run()

  return trackView(requireTrack(trackId, profileId), profileId)
}

/**
 * Aprova o esboço: as lições passam a existir, sempre no nível atual do aluno.
 * Reaprovar uma trilha ativa é no-op — o progresso fica preservado.
 */
export function approveTrack(profileId: number, trackId: number): FocusTrackView {
  const db = getDb()
  const row = requireTrack(trackId, profileId)

  if (row.status === 'active') return trackView(row, profileId)

  const plan = parseTrackPlan(row)
  if (!plan || plan.lessons.length === 0) throw new Error('O esboço desta trilha está vazio.')

  const studentProfile = getDefaultProfile()
  const level = trackLessonLevel(clampLevel(studentProfile.cefr))
  // O seed do banco local de cenário é em inglês (idioma-fixture). Para outro
  // idioma a persona nasce só pela IA na abertura — nunca um seed no idioma errado.
  const withScenarioSeed = deterministicContentSupported(studentProfile.targetLang)
  const now = Date.now()

  db.transaction((tx) => {
    plan.lessons.forEach((lesson, index) => {
      const inserted = tx
        .insert(schema.lessons)
        .values({
          unitId: null,
          trackId,
          title: lesson.title,
          objective: lesson.objective,
          level,
          position: index,
          scenario:
            withScenarioSeed && isScenarioLesson(index, plan.lessons.length)
              ? JSON.stringify(scenarioSeed(plan, index))
              : null,
          createdAt: now
        })
        .returning()
        .get()

      tx.insert(schema.trackLessons)
        .values({ trackId, lessonId: inserted.id, position: index })
        .run()
    })

    tx.update(schema.focusTracks)
      .set({ status: 'active', levelRange: levelRangeFrom(level), approvedAt: now })
      .where(eq(schema.focusTracks.id, trackId))
      .run()
  })

  // Trilha aprovada = lições novas que o aluno provavelmente vai abrir: vale aquecer.
  emitStudentEvent('track-approved', String(trackId))

  return trackView(requireTrack(trackId, profileId), profileId)
}

export function setTrackStatus(
  profileId: number,
  trackId: number,
  status: Extract<TrackStatus, 'active' | 'archived'>
): FocusTrackView {
  const db = getDb()
  const row = requireTrack(trackId, profileId)

  if (row.status === 'draft') throw new Error('Aprove o esboço antes de ativar a trilha.')

  db.update(schema.focusTracks)
    .set({ status })
    .where(eq(schema.focusTracks.id, trackId))
    .run()

  return trackView(requireTrack(trackId, profileId), profileId)
}

/** Descarta um rascunho ainda não aprovado (as lições ainda não existem). */
export function discardTrackDraft(profileId: number, trackId: number): void {
  const db = getDb()
  const row = requireTrack(trackId, profileId)

  if (row.status !== 'draft') throw new Error('Trilha aprovada fica no histórico: arquive em vez de apagar.')

  db.delete(schema.focusTracks).where(eq(schema.focusTracks.id, trackId)).run()
}

/** Contexto de trilha de uma lição, para restringir os prompts de geração. */
export function trackContextOf(
  lesson: LessonRow
): { title: string; vocabulary: string[]; trackId: number; goalTag: string } | null {
  if (lesson.trackId == null) return null

  const db = getDb()
  const row = db.select().from(schema.focusTracks).where(eq(schema.focusTracks.id, lesson.trackId)).get()
  const plan = row ? parseTrackPlan(row) : null
  if (!row || !plan) return null

  const link = db
    .select({ position: schema.trackLessons.position })
    .from(schema.trackLessons)
    .where(eq(schema.trackLessons.lessonId, lesson.id))
    .get()

  const lessonPlan = plan.lessons[link?.position ?? lesson.position] ?? plan.lessons[0]

  return {
    title: row.title,
    vocabulary: lessonPlan?.focusVocabulary ?? [],
    trackId: row.id,
    goalTag: plan.goalTag
  }
}

export function activeTrackViews(profileId: number): FocusTrackView[] {
  return tracksView(profileId).active
}

/** Lições de trilha ainda não concluídas — entrada do mix de recomendação. */
export function openTrackLessons(profileId: number): LessonSummary[] {
  return activeTrackViews(profileId).flatMap((track) =>
    track.lessons.filter((lesson) => lesson.status !== 'completed')
  )
}

/** Canais de trilha: rascunho → revisão → aprovação → arquivar. */
export function registerTracksIpc(): void {
  const profileId = (): number => getDefaultProfile().id

  ipcMain.handle('track:list', () => tracksView(profileId()))

  ipcMain.handle('track:draft', (_event, input: { objective: string; replaceId?: number }) =>
    createTrackDraft(profileId(), { objective: input.objective, replaceId: input.replaceId })
  )

  ipcMain.handle('track:revise', (_event, input: { trackId: number; lessons: TrackPlanLesson[] }) =>
    reviseTrackDraft(profileId(), input.trackId, input.lessons)
  )

  ipcMain.handle('track:approve', (_event, trackId: number) => approveTrack(profileId(), trackId))

  ipcMain.handle('track:discard', (_event, trackId: number) => discardTrackDraft(profileId(), trackId))

  ipcMain.handle('track:status', (_event, input: { trackId: number; status: 'active' | 'archived' }) =>
    setTrackStatus(profileId(), input.trackId, input.status)
  )
}
