import { handle } from './ipc-contract'
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import type {
  CefrLevel,
  Correction,
  CurriculumView,
  ExerciseType,
  ExerciseView,
  GradeFeedback,
  LessonContentView,
  LessonDetail,
  LessonResultView,
  LessonStatus,
  LessonSummary,
  OnboardingInput,
  PlacementResult,
  PlacementTest,
  CreateProfileInput,
  ProfileState,
  ProfileSummary,
  ProfilesView,
  SkillId,
  UpdateProfileInput,
  UnitView
} from '../shared/types'
import type { ErrorFocusEntry } from '../core/adapt'
import { clarifyCloze } from '../core/cloze'
import { clampLevel, levelIndex, levelFromScore, CEFR_LEVELS } from '../core/cefr'
import { fallbackCurriculum, fallbackExercises, fallbackLessonContent, pitfallsFrom } from '../core/fallback'
import { deterministicContentSupported, tokenize } from '../core/languages'
import { fallbackTrackVocabulary } from '../core/tracks'
import {
  gradeDeterministic,
  normalizeText,
  shuffleTokens,
  type ExerciseAnswerKey
} from '../core/grading'
import {
  curriculumPrompt,
  exercisePrompt,
  gradePrompt,
  lessonContentPrompt,
  placementPrompt,
  promptLocale,
  type ErrorHint
} from '../core/prompts'
import {
  curriculumSchema,
  exerciseSetSchema,
  gradeSchema,
  lessonContentSchema,
  placementSchema,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  type CurriculumOutput,
  type ExerciseSetOutput,
  type LessonContentOutput
} from '../core/schemas'
import { generateStructured } from './ai'
import { getDb, schema } from './db'
import { emitStudentEvent } from './events'
import { startKeyedJob } from './jobs'
import { cancelJobsExceptProfile } from './jobs'
import { runtimeText } from '../core/runtime-text'
import { errorHints, focusFor, recordCorrections } from './notebook'
import { cardsForLesson, cardsForPhrases, cardsForRecurringErrors, dueCount } from './review'
import { ownerOfLesson, openTrackLessons, trackContextOf, type LessonOwner } from './tracks'
import { applyReestimation, cancelTurnsExceptProfile } from './tutor'
import { voiceCapabilityFlags } from './voice'
import { exerciseForProfile, lessonIdsForProfile } from './scope'
import { skillSample } from '../core/score'
import {
  PROFILE_COLORS,
  activeProfileId,
  createProfile,
  deleteProfile,
  listProfiles,
  profileViewOf as profileView,
  resolveProfileId,
  setActiveProfile,
  updateProfile
} from './profiles'
import { getSettings } from './settings'

type ProfileRow = typeof schema.profiles.$inferSelect
type LessonRow = typeof schema.lessons.$inferSelect
type ExerciseRow = typeof schema.exercises.$inferSelect
type ProgressRow = typeof schema.lessonProgress.$inferSelect

interface StoredPlacementQuestion {
  id: string
  level: CefrLevel
  prompt: string
  options: string[]
  answerIndex: number
  explanation: string
}

interface StoredPlacement {
  createdAt: number
  questions: StoredPlacementQuestion[]
}

interface ProfilePrefs {
  placement?: StoredPlacement
}

interface ExercisePayload {
  instruction: string
  prompt: string
  options: string[]
  tokens: string[]
  targetTags?: string[]
  /** M6 (D1): contrato com que o exercício foi gerado (ver `core/schemas.ts`). */
  promptVersion?: number
  schemaVersion?: number
  /** V2: apoio exibido junto da frase falada (tradução do `speak_sentence`). */
  speechHint?: string | null
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/**
 * Lê `lessons.content` exigindo o carimbo de versão do contrato (M6/D1).
 * Qualquer conteúdo gravado por versão anterior de prompt/schema é **stale**:
 * `null` aqui manda a lição pela fila de regeneração — o shim manual de
 * `en`/`pt` → `target`/`native` do M4 morreu, remendo à mão é o que o plano
 * proíbe ("nunca por shim").
 */
export function readLessonContent(value: string | null | undefined): LessonContentView | null {
  const raw = parseJson<LessonContentView>(value)
  if (!raw) return null
  if (raw.schemaVersion !== SCHEMA_VERSION || raw.promptVersion !== PROMPT_VERSION) return null
  return raw
}

function toStatus(value: string | null | undefined): LessonStatus {
  return value === 'in_progress' || value === 'completed' ? value : 'not_started'
}

function toCefr(value: string | null | undefined): CefrLevel {
  return clampLevel(value)
}

function profileState(profileId = activeProfileId()): ProfileState {
  const profile = requireProfileRow(profileId)
  return {
    profile: profileView(profile),
    skills: skillsOf(profile.id),
    curriculumReady: unitCount(profile.id) > 0
  }
}

/**
 * V2: a linha do perfil é sempre lida por id — sem fallback silencioso para
 * "o primeiro perfil". Perfil inexistente é erro, não outro aluno.
 */
function requireProfileRow(profileId: number): ProfileRow {
  const row = getDb().select().from(schema.profiles).where(eq(schema.profiles.id, profileId)).get()
  if (!row) throw new Error('Perfil não encontrado.')
  return row
}

function readPrefs(profile: ProfileRow): ProfilePrefs {
  return parseJson<ProfilePrefs>(profile.prefs) ?? {}
}

function writePrefs(profile: ProfileRow, patch: ProfilePrefs): void {
  const next = { ...readPrefs(profile), ...patch }
  getDb()
    .update(schema.profiles)
    .set({ prefs: JSON.stringify(next) })
    .where(eq(schema.profiles.id, profile.id))
    .run()
}

function unitCount(profileId: number): number {
  return getDb()
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(eq(schema.units.profileId, profileId))
    .all().length
}

function skillsOf(profileId: number): ProfileState['skills'] {
  return getDb()
    .select()
    .from(schema.skillsState)
    .where(eq(schema.skillsState.profileId, profileId))
    .all()
    .map((row) => ({
      skill: row.skill as SkillId,
      estimate: row.estimate,
      confidence: row.confidence
    }))
}

function setSkill(profileId: number, skill: SkillId, estimate: number, confidence: number): void {
  getDb()
    .insert(schema.skillsState)
    .values({ profileId, skill, estimate, confidence })
    .onConflictDoUpdate({
      target: [schema.skillsState.profileId, schema.skillsState.skill],
      set: { estimate, confidence }
    })
    .run()
}

export function blendSkill(profileId: number, skill: SkillId, sample: number): void {
  const db = getDb()
  const existing = db
    .select()
    .from(schema.skillsState)
    .where(and(eq(schema.skillsState.profileId, profileId), eq(schema.skillsState.skill, skill)))
    .get()

  if (!existing) {
    setSkill(profileId, skill, sample, 0.35)
    return
  }

  const estimate = existing.estimate * 0.75 + sample * 0.25
  const confidence = Math.min(1, existing.confidence + 0.05)
  setSkill(profileId, skill, estimate, confidence)
}

function recentErrorHints(profileId: number, limit = 5): ErrorHint[] {
  return errorHints(profileId, limit)
}

/** Erro de exercício vira linha do caderno, com recorrência e nota. */
function recordExerciseError(
  profileId: number,
  exercise: ExerciseRow,
  response: string,
  feedback: GradeFeedback,
  source: Correction['source']
): void {
  const corrected = (feedback.corrected ?? '').trim() || feedback.feedback
  if (!corrected) return

  const corrections: Correction[] = feedback.errorTags.slice(0, 3).map((tag) => ({
    original: response,
    corrected,
    tag,
    note: feedback.feedback,
    source
  }))

  recordCorrections(profileId, corrections, {
    category: 'exercise',
    context: exercisePayload(exercise).prompt ?? null
  })
}

function summaryOf(lesson: LessonRow, progress: ProgressRow | undefined, owner?: Partial<LessonOwner>): LessonSummary {
  return {
    id: lesson.id,
    unitId: owner?.unitId ?? lesson.unitId,
    unitTitle: owner?.unitTitle ?? null,
    trackId: owner?.trackId ?? lesson.trackId,
    trackTitle: owner?.trackTitle ?? null,
    title: lesson.title,
    level: toCefr(lesson.level),
    position: lesson.position,
    status: toStatus(progress?.status),
    score: progress?.score ?? null,
    hasContent: Boolean(lesson.content),
    isScenario: owner?.isScenario ?? false
  }
}

export function curriculumView(profileId = activeProfileId()): CurriculumView {
  const db = getDb()
  const profile = requireProfileRow(profileId)

  const units = db
    .select()
    .from(schema.units)
    .where(eq(schema.units.profileId, profile.id))
    .orderBy(asc(schema.units.position), asc(schema.units.id))
    .all()

  if (units.length === 0) return { units: [], generated: false }

  const unitIds = units.map((unit) => unit.id)
  const lessons = db
    .select()
    .from(schema.lessons)
    .where(inArray(schema.lessons.unitId, unitIds))
    .orderBy(asc(schema.lessons.position), asc(schema.lessons.id))
    .all()

  const progress = db
    .select()
    .from(schema.lessonProgress)
    .where(eq(schema.lessonProgress.profileId, profile.id))
    .all()

  const progressByLesson = new Map(progress.map((row) => [row.lessonId, row]))
  const lessonsByUnit = new Map<number, LessonSummary[]>()

  for (const lesson of lessons) {
    if (lesson.unitId == null) continue
    const unit = units.find((entry) => entry.id === lesson.unitId)
    const list = lessonsByUnit.get(lesson.unitId) ?? []
    list.push(
      summaryOf(lesson, progressByLesson.get(lesson.id), {
        unitId: lesson.unitId,
        unitTitle: unit?.title ?? null,
        trackId: null,
        trackTitle: null,
        isScenario: false
      })
    )
    lessonsByUnit.set(lesson.unitId, list)
  }

  const views: UnitView[] = units.map((unit) => ({
    id: unit.id,
    title: unit.title,
    description: unit.description,
    level: toCefr(unit.level),
    position: unit.position,
    lessons: lessonsByUnit.get(unit.id) ?? []
  }))

  return { units: views, generated: true }
}

/**
 * V2: um job por perfil (`startKeyedJob` com chave `curriculum:<profileId>`). A
 * versão antiga tinha `curriculumJob` único, e com dois perfis o segundo pedindo
 * currículo recebia o currículo do primeiro.
 */
export function generateCurriculum(profileId = activeProfileId()): Promise<CurriculumView> {
  const job = startKeyedJob(`curriculum:${profileId}`, {
    kind: 'curriculum:generate',
    profileId,
    label: runtimeText(requireProfileRow(profileId).nativeLang, 'job.curriculum'),
    run: async (context) => {
    const db = getDb()
    const profile = requireProfileRow(profileId)
    context.progress(0.05)

    if (unitCount(profile.id) > 0) return curriculumView(profile.id)

    const level = toCefr(profile.cefr)
    const locale = promptLocale(profile.targetLang, profile.nativeLang)
    const prompt = curriculumPrompt({ goal: profile.goal ?? '', level, locale })

    let plan: CurriculumOutput
    try {
      plan = await generateStructured(curriculumSchema, {
        system: prompt.system,
        user: prompt.user,
        temperature: 0.3,
        role: 'strong',
        // V2 (E9): o cancelamento do job mata a geração do currículo.
        signal: context.signal
      })
    } catch (error) {
      if (!deterministicContentSupported(profile.targetLang)) {
        throw new Error(
          runtimeText(profile.nativeLang, 'error.aiUnavailableCurriculum', {
            target: locale.targetName
          })
        )
      }
      console.warn(
        '[learning] geração do currículo falhou, usando plano determinístico:',
        error instanceof Error ? error.message : error
      )
      plan = fallbackCurriculum(level, profile.goal ?? '')
    }

    const now = Date.now()
    let unitPosition = 0

    db.transaction((tx) => {
      for (const unit of plan.units) {
        const insertedUnit = tx
          .insert(schema.units)
          .values({
            profileId: profile.id,
            title: unit.title,
            description: unit.description,
            level: clampLevel(unit.level),
            position: unitPosition,
            createdAt: now
          })
          .returning()
          .get()

        unitPosition += 1

        unit.lessons.forEach((lesson, index) => {
          tx.insert(schema.lessons)
            .values({
              unitId: insertedUnit.id,
              // V2: dono explícito na nascença da linha — nada de posse só por join.
              profileId: profile.id,
              title: lesson.title,
              objective: lesson.objective,
              level: clampLevel(unit.level),
              position: index,
              createdAt: now
            })
            .run()
        })
      }
    })

    context.progress(1)
    return curriculumView(profile.id)
    }
  })

  return job
}

function getOwnedLesson(
  lessonId: number,
  profileId: number
): { lesson: LessonRow; owner: LessonOwner } | null {
  const owner = ownerOfLesson(lessonId, profileId)
  if (!owner) return null

  const lesson = getDb()
    .select()
    .from(schema.lessons)
    .where(eq(schema.lessons.id, lessonId))
    .get()

  if (!lesson) return null
  return { lesson, owner }
}

function progressOf(profileId: number, lessonId: number): ProgressRow | undefined {
  return getDb()
    .select()
    .from(schema.lessonProgress)
    .where(
      and(eq(schema.lessonProgress.profileId, profileId), eq(schema.lessonProgress.lessonId, lessonId))
    )
    .get()
}

function exercisePayload(row: { payload: string }): ExercisePayload {
  return (
    parseJson<ExercisePayload>(row.payload) ?? {
      instruction: '',
      prompt: '',
      options: [],
      tokens: []
    }
  )
}

/**
 * M6 (D1): exercício nascido sob contrato divergente é `stale` — não conta
 * como utilizável, não chega ao aluno, e sai do bloco quando a lição é
 * recomposta. Versão divergente nunca é remendada à mão.
 */
function exerciseIsCurrent(row: { payload: string }): boolean {
  const payload = parseJson<ExercisePayload>(row.payload)
  return payload?.schemaVersion === SCHEMA_VERSION && payload?.promptVersion === PROMPT_VERSION
}

function toExerciseView(row: ExerciseRow): ExerciseView {
  const payload = exercisePayload(row)
  const type = row.type as ExerciseType
  const answerKey = parseAnswerKey(row)
  // V2: a frase que o áudio deve dizer vem do gabarito, nunca do enunciado — em
  // `listen_repeat` o enunciado não pode revelar a resposta que se ouve.
  const isVoice = type === 'listen_repeat' || type === 'speak_sentence'

  return {
    id: row.id,
    type,
    lessonId: row.lessonId,
    instruction: payload.instruction,
    prompt: payload.prompt,
    options: payload.options ?? [],
    tokens: payload.tokens ?? [],
    source: row.source === 'ai' || row.source === 'fallback' ? row.source : null,
    targetTags: payload.targetTags ?? parseJson<{ targetTags?: string[] }>(row.answerKey)?.targetTags ?? [],
    speechText: isVoice ? answerKey.answer.trim() : null,
    speechHint: isVoice ? (payload.speechHint ?? null) : null
  }
}

/**
 * Garante que a lição tenha conteúdo + exercícios, **usando o cache primeiro**
 * (M5: lição já gerada abre sem IA e sem gastar token).
 *
 * Caminhos que a função conhece:
 * - conteúdo salvo e não marcado como ruim → não gera nada;
 * - conteúdo marcado como ruim (`lessons.staleAt`, pelo botão de reportar) →
 *   regenera; se a IA estiver fora, mantém o cache em vez de piorar a lição;
 * - exercícios reportados como ruins ficam `blocked`: saem da prática e da
 *   contagem, mas continuam no banco (o histórico de tentativas e o report
 *   apontam para eles) e são repostos por itens novos, sem descartar os bons.
 */
/**
 * M6 (C1): mutex por lição, no formato do `curriculumJob`. Sem isto a
 * pré-geração ociosa e a abertura do aluno corriam juntas e a mesma lição era
 * gerada — e paga — duas vezes. Pedido explícito de regeneração não é perdido:
 * encadeia depois do job vivo, nunca sobrepõe.
 */
const lessonJobs = new Map<number, Promise<ErrorFocusEntry[]>>()

function ensureLessonGeneratedOnce(
  lesson: LessonRow,
  profile: ProfileRow,
  owner: LessonOwner,
  options: { forceExercises?: boolean; prewarm?: boolean; minExercises?: number; signal?: AbortSignal } = {}
): Promise<ErrorFocusEntry[]> {
  const pending = lessonJobs.get(lesson.id)

  if (pending && options.forceExercises !== true) {
    return pending
  }

  const run = (): Promise<ErrorFocusEntry[]> => {
    // O job encadeado (regeneração pedida depois de um job vivo) relê a linha:
    // o objeto `lesson` que chegou pode ser pré-histórico.
    const fresh =
      pending != null
        ? (getDb()
            .select()
            .from(schema.lessons)
            .where(eq(schema.lessons.id, lesson.id))
            .get() ?? lesson)
        : lesson
    return ensureLessonGenerated(fresh, profile, owner, options)
  }

  const job = pending ? pending.catch(() => undefined).then(run) : run()

  void job
    .catch(() => undefined)
    .finally(() => {
      if (lessonJobs.get(lesson.id) === job) lessonJobs.delete(lesson.id)
    })

  lessonJobs.set(lesson.id, job)
  return job
}

async function ensureLessonGenerated(
  lesson: LessonRow,
  profile: ProfileRow,
  owner: LessonOwner,
  options: {
    /** Recria o bloco de exercícios inteiro (pedido do aluno na lição). */
    forceExercises?: boolean
    /** M5: veio do aquecimento ocioso — marca a lição como pré-gerada. */
    prewarm?: boolean
    /** M5: mínimo de exercícios utilizáveis; abaixo disso a fila só repõe o que falta. */
    minExercises?: number
    /** V2 (E9): cancelamento do job — um "parar" do aluno mata o request. */
    signal?: AbortSignal
  } = {}
): Promise<ErrorFocusEntry[]> {
  const db = getDb()
  const level = toCefr(lesson.level)
  const focus = focusFor(profile.id, 5)
  const track = lesson.trackId != null ? trackContextOf(lesson) : null
  const scopeTitle = owner.trackTitle ?? owner.unitTitle ?? ''
  const locale = promptLocale(profile.targetLang, profile.nativeLang)
  const offlineReady = deterministicContentSupported(profile.targetLang)
  const minExercises = options.minExercises ?? 1

  let content = lesson.staleAt != null ? null : readLessonContent(lesson.content)

  if (!content) {
    const hints = recentErrorHints(profile.id)
    const prompt = lessonContentPrompt({
      title: lesson.title,
      objective: lesson.objective ?? lesson.title,
      unitTitle: scopeTitle,
      level,
      goal: profile.goal ?? '',
      errors: hints,
      locale,
      track: track ? { title: track.title, vocabulary: track.vocabulary } : null
    })

    let resolved: LessonContentView | null = null

    try {
      const generated = await generateStructured(lessonContentSchema, {
        system: prompt.system,
        user: prompt.user,
        temperature: 0.4,
        role: 'strong',
        // V2 (E9): o cancelamento do job chega até o request do provedor.
        ...(options.signal ? { signal: options.signal } : {})
      })
      // O nível é do currículo/trilha — um modelo fraco não rebaixa nem promove a lição.
      resolved = {
        ...generated,
        level,
        pitfalls: generated.pitfalls ?? pitfallsFrom(focus),
        source: 'ai'
      }
    } catch (error) {
      const previous = readLessonContent(lesson.content)

      if (previous) {
        // Cache é melhor que nada: sem IA não regeneramos (e não deixamos a
        // lição pedindo para sempre), mas limparamos a marca de "ruim".
        db.update(schema.lessons).set({ staleAt: null }).where(eq(schema.lessons.id, lesson.id)).run()
        content = previous
      } else if (offlineReady) {
        console.warn(
          '[learning] geração do conteúdo falhou, usando conteúdo determinístico:',
          error instanceof Error ? error.message : error
        )
        resolved = {
          ...fallbackLessonContent({
            title: lesson.title,
            objective: lesson.objective ?? lesson.title,
            level,
            errors: focus,
            vocabulary: track ? fallbackTrackVocabulary(track.goalTag, lesson.position) : undefined
          }),
          level,
          pitfalls: pitfallsFrom(focus),
          source: 'fallback'
        }
      } else {
        throw new Error(
          runtimeText(profile.nativeLang, 'error.aiUnavailableContent', { target: locale.targetName })
        )
      }
    }

    if (resolved) {
      content = resolved
      const stamp = Date.now()

      db.transaction((tx) => {
        tx.update(schema.lessons)
          .set({
            content: JSON.stringify({
              ...(resolved as LessonContentView),
              promptVersion: PROMPT_VERSION,
              schemaVersion: SCHEMA_VERSION
            } satisfies LessonContentView),
            level: (resolved as LessonContentView).level,
            version: lesson.version + 1,
            staleAt: null,
            ...(options.prewarm ? { prewarmedAt: stamp } : {})
          })
          .where(eq(schema.lessons.id, lesson.id))
          .run()

        tx.delete(schema.lessonItems).where(eq(schema.lessonItems.lessonId, lesson.id)).run()

        for (const item of (resolved as LessonContentView).vocabulary) {
          tx.insert(schema.lessonItems)
            .values({ lessonId: lesson.id, kind: 'vocab', payload: JSON.stringify(item) })
            .run()
        }
        for (const item of (resolved as LessonContentView).grammarPoints) {
          tx.insert(schema.lessonItems)
            .values({ lessonId: lesson.id, kind: 'grammar', payload: JSON.stringify(item) })
            .run()
        }
      })
    }
  }

  if (!content) throw new Error('Não foi possível preparar o conteúdo da lição.')

  const exerciseLevel: LessonContentOutput = {
    title: content.title,
    level: content.level,
    objective: content.objective,
    explanation: content.explanation,
    examples: content.examples,
    grammarPoints: content.grammarPoints,
    pitfalls: content.pitfalls ?? pitfallsFrom(focus),
    vocabulary: content.vocabulary
  }

  const existingExercises = db
    .select({
      id: schema.exercises.id,
      source: schema.exercises.source,
      blocked: schema.exercises.blocked,
      payload: schema.exercises.payload
    })
    .from(schema.exercises)
    .where(eq(schema.exercises.lessonId, lesson.id))
    .all()

  const usable = existingExercises.filter((row) => !row.blocked && exerciseIsCurrent(row))
  const staleRows = existingExercises.filter((row) => !row.blocked && !exerciseIsCurrent(row))

  if (usable.length >= minExercises && !options.forceExercises) return focus

  // Reportado como ruim: o aluno não vê mais estes itens. Abaixo do piso, a
  // lição é recomposta — mantendo os exercícios bons, só trocando o que sobrou.
  const replaceWholeBlock = options.forceExercises || usable.length === 0
  const shortfall = Math.max(1, minExercises - usable.length)

  const hints = recentErrorHints(profile.id)
  // V2: com voz disponível o lote ganha ouvir + falar; sem voz, nada de
  // exercício de pronúncia que o aluno não consegue responder.
  const prompt = exercisePrompt({
    content: exerciseLevel,
    level: content.level,
    goal: profile.goal ?? '',
    errors: hints,
    locale,
    track: track ? { title: track.title, vocabulary: track.vocabulary } : null,
    voice: voiceCapabilityFlags()
  })

  let generated: ExerciseSetOutput
  let source: 'ai' | 'fallback'

  try {
    generated = await generateStructured(exerciseSetSchema, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.4,
      role: 'strong',
      ...(options.signal ? { signal: options.signal } : {})
    })
    source = 'ai'
  } catch (error) {
    if (!offlineReady) {
      throw new Error(
        runtimeText(profile.nativeLang, 'error.aiUnavailableExercises', { target: locale.targetName })
      )
    }
    // Regenerar não pode piorar a lição: sem IA, o gerador local é mais pobre
    // que o bloco salvo — mantém o atual e avisa em vez de trocar em silêncio.
    if (replaceWholeBlock && usable.some((row) => row.source === 'ai')) {
      throw new Error(runtimeText(profile.nativeLang, 'error.aiKeptExercises'))
    }
    console.warn(
      '[learning] geração de exercícios falhou, usando exercícios determinísticos:',
      error instanceof Error ? error.message : error
    )
    const voice = voiceCapabilityFlags()
      generated = fallbackExercises(exerciseLevel, focus, locale, { tts: voice.tts, asr: voice.asr })
    source = 'fallback'
  }

  // Top-up não pode repetir enunciado que o aluno já tem na frente.
  const seen = new Set(
    replaceWholeBlock ? [] : usable.map((row) => normalizeText(exercisePayload(row).prompt))
  )

  const rows: Array<{
    lessonId: number
    type: ExerciseType
    payload: string
    answerKey: string
    source: 'ai' | 'fallback'
    position: number
    createdAt: number
  }> = []

  for (const [index, exercise] of generated.exercises.entries()) {
    if (!replaceWholeBlock && rows.length >= shortfall) {
      // Top-up: só os itens que faltam, sem dobrar a prática da lição.
      break
    }

    let answer = exercise.answer
    let options_ = exercise.type === 'multiple_choice' ? exercise.options : []
    let tokens: string[] = []

    if (exercise.type === 'multiple_choice' && !options_.includes(answer)) {
      const match = options_.find((option) => normalizeText(option) === normalizeText(answer))
      if (match) answer = match
    }

    if (exercise.type === 'order') {
      // Sem modelo fraco devolvendo tokens vazios: segmentação respeita a
      // escrita do idioma-alvo (espaço ou CJK via Intl.Segmenter).
      const baseTokens = exercise.tokens.length > 0 ? exercise.tokens : tokenize(answer, profile.targetLang)
      tokens = shuffleTokens(baseTokens, lesson.id * 1000 + index)
    }

    options_ = options_.filter(Boolean)

    // Cloze da IA sem dica de tradução = resposta adivinhável. Se a palavra
    // esperada está no vocabulário da lição, a tradução entra no enunciado.
    const promptText =
      exercise.type === 'cloze' && source === 'ai'
        ? clarifyCloze(exercise.prompt, answer, exerciseLevel.vocabulary)
        : exercise.prompt

    if (seen.has(normalizeText(promptText))) continue
    seen.add(normalizeText(promptText))

    const payload: ExercisePayload = {
      instruction: exercise.instruction,
      prompt: promptText,
      options: options_,
      tokens,
      targetTags: exercise.targetTags ?? [],
      // V2: apoio da frase falada (tradução do "fale em voz alta").
      speechHint: exercise.type === 'speak_sentence' ? speakHintFor(exerciseLevel) : null,
      // M6 (D1): carimbo do contrato — rascunhos sem versão são stale.
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION
    }

    const answerKey: ExerciseAnswerKey = {
      answer,
      alternatives: exercise.alternatives,
      explanation: exercise.explanation
    }

    rows.push({
      lessonId: lesson.id,
      type: exercise.type,
      payload: JSON.stringify(payload),
      answerKey: JSON.stringify(answerKey),
      source,
      position: existingExercises.length + rows.length,
      createdAt: Date.now()
    })
  }

  if (rows.length === 0) return focus

  const dropIds = replaceWholeBlock ? [...usable, ...staleRows].map((row) => row.id) : []

  db.transaction((tx) => {
    if (dropIds.length > 0) {
      // `attempts` não tem FK: apagar os exercícios e deixar as tentativas
      // para trás criaria linhas órfãs apontando para exercícios extintos.
      tx.delete(schema.attempts).where(inArray(schema.attempts.exerciseId, dropIds)).run()
      tx.delete(schema.exercises).where(inArray(schema.exercises.id, dropIds)).run()
    }
    for (const row of rows) {
      tx.insert(schema.exercises).values(row).run()
    }
    if (options.prewarm) {
      tx.update(schema.lessons)
        .set({ prewarmedAt: Date.now() })
        .where(eq(schema.lessons.id, lesson.id))
        .run()
    }
  })

  return focus
}

function parseAnswerKey(row: ExerciseRow): ExerciseAnswerKey {
  return (
    parseJson<ExerciseAnswerKey>(row.answerKey) ?? {
      answer: '',
      alternatives: [],
      explanation: ''
    }
  )
}

/** Média 0–1 das tentativas de um tipo de exercício nesta lição (null = none). */
function typeAverage(
  rows: Array<{ id: number; type: string }>,
  latest: Map<number, { correct: boolean; score: number }>,
  type: string
): number | null {
  const values = rows
    .filter((row) => row.type === type)
    .map((row) => latest.get(row.id)?.score)
    .filter((value): value is number => typeof value === 'number')

  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Tradução do primeiro termo do vocabulário: o apoio curto da frase falada. */
function speakHintFor(content: LessonContentOutput): string | null {
  const first = content.vocabulary[0]
  return first ? `${first.term} · ${first.translation}` : null
}

/** Lições com menos disto voltam para a fila de aquecimento (M5). */
const PREWARM_MIN_EXERCISES = 6

/** Exercícios utilizáveis de uma lição (os reportados como ruins não contam). */
function usableExerciseCount(lessonId: number): number {
  return Number(
    getDb()
      .select({ value: count() })
      .from(schema.exercises)
      .where(
        and(
          eq(schema.exercises.lessonId, lessonId),
          eq(schema.exercises.blocked, false),
          // M6 (D1): contagem só considera o contrato de versão atual.
          sql`json_extract(${schema.exercises.payload}, '$.schemaVersion') = ${SCHEMA_VERSION}`,
          sql`json_extract(${schema.exercises.payload}, '$.promptVersion') = ${PROMPT_VERSION}`
        )
      )
      .get()?.value ?? 0
  )
}

/**
 * M5: sessão de lição deixada aberta (janela fechada no meio, app morto) é
 * encerrada na próxima abertura da mesma lição, com o tempo da última tentativa
 * real como fim. Sem isso o painel de Progresso somaria horas fantasma ou
 * perderia o tempo que o aluno de fato passou ali.
 */
function closeOrphanLessonSessions(profileId: number, lessonId: number): void {
  const db = getDb()

  const orphans = db
    .select()
    .from(schema.studySessions)
    .where(
      and(
        eq(schema.studySessions.profileId, profileId),
        eq(schema.studySessions.kind, 'lesson'),
        isNull(schema.studySessions.endedAt)
      )
    )
    .all()
    .filter((row) => parseJson<{ lessonId?: number }>(row.summary)?.lessonId === lessonId)

  if (orphans.length === 0) return

  const exerciseIds = db
    .select({ id: schema.exercises.id })
    .from(schema.exercises)
    .where(eq(schema.exercises.lessonId, lessonId))
    .all()
    .map((row) => row.id)

  for (const row of orphans) {
    let endedAt = row.startedAt

    if (exerciseIds.length > 0) {
      const last = db
        .select({ value: sql<number>`max(${schema.attempts.createdAt})` })
        .from(schema.attempts)
        .where(
          and(inArray(schema.attempts.exerciseId, exerciseIds), gte(schema.attempts.createdAt, row.startedAt))
        )
        .get()?.value

      if (last && last > endedAt) endedAt = last
    }

    db.update(schema.studySessions)
      .set({ endedAt })
      .where(eq(schema.studySessions.id, row.id))
      .run()
  }
}

/**
 * Aquecimento de uma lição (M5) — mesmo caminho de `openLesson`, **sem** criar
 * sessão de estudo nem mexer em progresso: é assim que a pré-geração enche o
 * cache sem contaminar o painel de Progresso. Idempotente: lição completa sai
 * imediatamente.
 */
export async function prewarmLesson(lessonId: number, profileId = activeProfileId()): Promise<{
  content: boolean
  exercises: number
  source: 'ai' | 'fallback' | null
}> {
  const profile = requireProfileRow(profileId)
  const owned = getOwnedLesson(lessonId, profile.id)
  if (!owned) throw new Error('Lição não encontrada.')

  const hadContent = Boolean(owned.lesson.content) && owned.lesson.staleAt == null
  const before = usableExerciseCount(lessonId)

  await ensureLessonGeneratedOnce(owned.lesson, profile, owned.owner, {
    prewarm: true,
    minExercises: PREWARM_MIN_EXERCISES
  })

  const fresh = getOwnedLesson(lessonId, profile.id)
  const content = readLessonContent(fresh?.lesson.content)

  return {
    content: !hadContent && Boolean(content),
    exercises: Math.max(0, usableExerciseCount(lessonId) - before),
    source: content?.source ?? null
  }
}

export async function openLesson(
  lessonId: number,
  profileId = activeProfileId(),
  options: { requestId?: string } = {}
): Promise<LessonDetail> {
  const db = getDb()
  const profile = requireProfileRow(profileId)
  const owned = getOwnedLesson(lessonId, profile.id)

  if (!owned) throw new Error('Lição não encontrada.')

  // V2 (E9): a geração longa é um job nomeado — a tela mostra "gerando o
  // conteúdo da lição" com progresso e pode cancelar. `startKeyedJob` também é o
  // mutex: duas aberturas da mesma lição pagam uma geração só.
  const focus = await startKeyedJob(`lesson:generate:${lessonId}`, {
    kind: 'lesson:generate',
    profileId: profile.id,
    label: runtimeText(profile.nativeLang, 'job.lesson'),
    requestId: options.requestId,
    run: (job) =>
      ensureLessonGeneratedOnce(owned.lesson, profile, owned.owner, { signal: job.signal })
  })

  const fresh = getOwnedLesson(lessonId, profile.id)
  if (!fresh) throw new Error('Lição não encontrada.')

  const content = readLessonContent(fresh.lesson.content)
  if (!content) throw new Error('Não foi possível carregar o conteúdo da lição.')

  // Exercícios reportados como ruins (ou nascidos de contrato divergente, D1)
  // não voltam para a prática.
  const exerciseRows = db
    .select()
    .from(schema.exercises)
    .where(and(eq(schema.exercises.lessonId, lessonId), eq(schema.exercises.blocked, false)))
    .orderBy(asc(schema.exercises.position), asc(schema.exercises.id))
    .all()
    .filter(exerciseIsCurrent)

  if (exerciseRows.length === 0) {
    throw new Error('A lição foi gerada sem exercícios. Tente abrir novamente.')
  }

  // M5: sessão órfã de uma abertura anterior (aluno fechou a aba no meio) é
  // encerrada antes da nova começar — senão o painel de Progresso conta tempo
  // que não aconteceu, ou perde de vez o tempo que aconteceu.
  closeOrphanLessonSessions(profile.id, lessonId)

  const session = db
    .insert(schema.studySessions)
    .values({
      profileId: profile.id,
      kind: 'lesson',
      startedAt: Date.now(),
      summary: JSON.stringify({ lessonId })
    })
    .returning()
    .get()

  const existing = progressOf(profile.id, lessonId)
  if (existing) {
    db.update(schema.lessonProgress)
      .set({
        status: existing.status === 'completed' ? 'completed' : 'in_progress',
        lastOpenedAt: Date.now()
      })
      .where(
        and(
          eq(schema.lessonProgress.profileId, profile.id),
          eq(schema.lessonProgress.lessonId, lessonId)
        )
      )
      .run()
  } else {
    db.insert(schema.lessonProgress)
      .values({
        profileId: profile.id,
        lessonId,
        status: 'in_progress',
        lastOpenedAt: Date.now()
      })
      .run()
  }

  return {
    lesson: summaryOf(fresh.lesson, progressOf(profile.id, lessonId), fresh.owner),
    content: { ...content, pitfalls: content.pitfalls ?? pitfallsFrom(focus) },
    exercises: exerciseRows.map(toExerciseView),
    focus,
    sessionId: session.id
  }
}

/**
 * Recria o bloco de exercícios de uma lição sem tocar no conteúdo. Os novos
 * exercícios só substituem os antigos depois de gerados e validados: sem IA,
 * a lição mantém o que já tinha em vez de cair para o gerador local.
 */
export async function regenerateLessonExercises(
  lessonId: number,
  profileId = activeProfileId(),
  options: { requestId?: string } = {}
): Promise<LessonDetail> {
  const profile = requireProfileRow(profileId)
  const owned = getOwnedLesson(lessonId, profile.id)

  if (!owned) throw new Error('Lição não encontrada.')

  await startKeyedJob(`lesson:generate:${lessonId}`, {
    kind: 'lesson:generate',
    profileId: profile.id,
    label: runtimeText(profile.nativeLang, 'job.exercises'),
    requestId: options.requestId,
    run: (job) =>
      ensureLessonGeneratedOnce(owned.lesson, profile, owned.owner, {
        forceExercises: true,
        signal: job.signal
      })
  })
  return openLesson(lessonId, profile.id, options)
}

export async function answerExercise(
  input: { exerciseId: number; response: string; latencyMs?: number },
  profileId = activeProfileId()
): Promise<GradeFeedback> {
  const db = getDb()
  const profile = requireProfileRow(profileId)

  // V2 (D2): o exercício só existe para quem o responde — a posse da lição é
  // resolvida numa consulta só, e exercício órfão (lição apagada) não responde.
  const exercise = exerciseForProfile(input.exerciseId, profile.id)
  if (!exercise) throw new Error('Exercício não encontrado.')
  if (exercise.blocked) {
    throw new Error(runtimeText(profile.nativeLang, 'error.exerciseRemoved'))
  }

  const lesson = db
    .select()
    .from(schema.lessons)
    .where(eq(schema.lessons.id, exercise.lessonId))
    .get()

  if (!lesson) throw new Error('Exercício não encontrado.')

  const payload = exercisePayload(exercise)
  const answerKey = parseAnswerKey(exercise)
  const type = exercise.type as ExerciseType
  const response = input.response.trim()

  // V2: exercício de voz não se responde por texto — a nota vem do alinhamento
  // com a transcrição (`voice:grade`), não de um palpite do modelo.
  if (type === 'speak_sentence') {
    throw new Error(runtimeText(profile.nativeLang, 'error.voiceOnly'))
  }

  if (!response) throw new Error('Escreva ou monte uma resposta antes de verificar.')

  // M6 (B7/B8): veredicto no idioma do aluno, e a comparacão de texto respeita
  // idiomas cujo diacrítico define a palavra (vietnamita).
  let feedback = gradeDeterministic(type, answerKey, response, profile.nativeLang, profile.targetLang)
  let gradedBy: Correction['source'] = 'local'

  if (!feedback) {
    gradedBy = 'ai'
    const prompt = gradePrompt({
      type,
      prompt: payload.prompt,
      answer: answerKey.answer,
      alternatives: answerKey.alternatives ?? [],
      explanation: answerKey.explanation ?? '',
      response,
      level: toCefr(lesson?.level),
      locale: promptLocale(profile.targetLang, profile.nativeLang)
    })

    try {
      const graded = await generateStructured(gradeSchema, {
        system: prompt.system,
        user: prompt.user,
        temperature: 0.2,
        // V2: corrigir é o trabalho rápido — usa o modelo do papel `quick`.
        role: 'quick'
      })
      feedback = {
        correct: graded.correct,
        score: graded.score,
        feedback: graded.feedback,
        corrected: graded.corrected,
        errorTags: graded.errorTags
      }
    } catch {
      // Sem IA, o veredito é o gabarito — e a frase é do idioma do aluno (M5).
      const correct = normalizeText(response, profile.targetLang) === normalizeText(answerKey.answer, profile.targetLang)
      feedback = {
        correct,
        score: correct ? 1 : 0,
        feedback: correct
          ? runtimeText(profile.nativeLang, 'grade.correct')
          : runtimeText(profile.nativeLang, 'grade.incorrect', { answer: answerKey.answer }),
        corrected: correct ? response : answerKey.answer,
        errorTags: correct ? [] : ['accuracy']
      }
    }
  }

  db.insert(schema.attempts)
    .values({
      exerciseId: exercise.id,
      response,
      correct: feedback.correct,
      score: feedback.score,
      latencyMs: input.latencyMs ?? null,
      createdAt: Date.now()
    })
    .run()

  if (!feedback.correct) {
    recordExerciseError(profile.id, exercise, response, feedback, gradedBy)
  }

  return feedback
}

export function finishLesson(
  input: { lessonId: number; sessionId: number },
  profileId = activeProfileId()
): LessonResultView {
  const db = getDb()
  const profile = requireProfileRow(profileId)
  // V2 (D2): fechar lição de outro perfil é "não encontrada", não fechar a lição
  // alheia e marcar o progresso dele.
  if (!getOwnedLesson(input.lessonId, profile.id)) throw new Error('Lição não encontrada.')

  const exerciseRows = db
    .select({ id: schema.exercises.id, type: schema.exercises.type })
    .from(schema.exercises)
    .where(and(eq(schema.exercises.lessonId, input.lessonId), eq(schema.exercises.blocked, false)))
    .all()

  const exerciseIds = exerciseRows.map((row) => row.id)

  const latestByExercise = new Map<number, { correct: boolean; score: number }>()
  if (exerciseIds.length > 0) {
    const rows = db
      .select({ exerciseId: schema.attempts.exerciseId, correct: schema.attempts.correct, score: schema.attempts.score })
      .from(schema.attempts)
      .where(inArray(schema.attempts.exerciseId, exerciseIds))
      .orderBy(asc(schema.attempts.id))
      .all()

    for (const row of rows) {
      latestByExercise.set(row.exerciseId, { correct: row.correct, score: row.score ?? (row.correct ? 1 : 0) })
    }
  }

  const total = exerciseIds.length
  const correct = [...latestByExercise.values()].filter((entry) => entry.correct).length
  const score = total > 0 ? correct / total : 0

  const existing = progressOf(profile.id, input.lessonId)
  if (existing) {
    db.update(schema.lessonProgress)
      .set({ status: 'completed', score, lastOpenedAt: Date.now() })
      .where(
        and(
          eq(schema.lessonProgress.profileId, profile.id),
          eq(schema.lessonProgress.lessonId, input.lessonId)
        )
      )
      .run()
  } else {
    db.insert(schema.lessonProgress)
      .values({
        profileId: profile.id,
        lessonId: input.lessonId,
        status: 'completed',
        score,
        lastOpenedAt: Date.now()
      })
      .run()
  }

  // V2 (D7): a conta da lição usa a mesma escala 0–1 → 0–5 em todo tipo, e os
  // exercícios de voz finalmente alimentam `speaking`/`listening`, que na v1
  // eram linhas mortas no painel.
  blendSkill(profile.id, 'grammar', skillSample(score))
  blendSkill(profile.id, 'vocab', skillSample(score))

  const speakingAverage = typeAverage(exerciseRows, latestByExercise, 'speak_sentence')
  const listeningAverage = typeAverage(exerciseRows, latestByExercise, 'listen_repeat')
  if (speakingAverage != null) blendSkill(profile.id, 'speaking', skillSample(speakingAverage))
  if (listeningAverage != null) blendSkill(profile.id, 'listening', skillSample(listeningAverage))

  // Fechamento da lição: vocabulário vira card SRS + erros recorrentes também.
  const lessonRow = db
    .select({ content: schema.lessons.content })
    .from(schema.lessons)
    .where(eq(schema.lessons.id, input.lessonId))
    .get()

  const lessonContent = readLessonContent(lessonRow?.content)
  const vocabulary = lessonContent?.vocabulary ?? []
  const examples = lessonContent?.examples ?? []

  let cardsCreated = cardsForLesson(profile.id, input.lessonId, vocabulary)
  // Frases modelas da lição viram card de produção (traduzir → falar).
  cardsCreated += cardsForPhrases(profile.id, examples, input.lessonId)
  cardsCreated += cardsForRecurringErrors(profile.id, 3)

  const levelChange = applyReestimation(profile.id)

  db.update(schema.studySessions)
    .set({
      endedAt: Date.now(),
      summary: JSON.stringify({ lessonId: input.lessonId, correct, total, score, cardsCreated })
    })
    // V2: fechar sessão por id sem escopo encerrava a sessão de outro perfil.
    .where(
      and(
        eq(schema.studySessions.id, input.sessionId),
        eq(schema.studySessions.profileId, profile.id),
        isNull(schema.studySessions.endedAt)
      )
    )
    .run()

  emitStudentEvent('lesson-finished', String(input.lessonId), profile.id)

  return { lessonId: input.lessonId, score, correct, total, cardsCreated, levelChange }
}

/**
 * Lição em andamento mais recente — base do "continuar de onde parei". Cobre as
 * duas camadas: uma lição de trilha parada no meio conta igual às do currículo.
 */
export function lastOpenedLesson(profileId: number): LessonSummary | null {
  const recent = getDb()
    .select()
    .from(schema.lessonProgress)
    .where(
      and(
        eq(schema.lessonProgress.profileId, profileId),
        eq(schema.lessonProgress.status, 'in_progress')
      )
    )
    .orderBy(desc(schema.lessonProgress.lastOpenedAt))
    .limit(1)
    .get()

  if (!recent) return null

  const owner = ownerOfLesson(recent.lessonId, profileId)
  if (!owner) return null

  const lesson = getDb()
    .select()
    .from(schema.lessons)
    .where(eq(schema.lessons.id, recent.lessonId))
    .get()

  if (!lesson) return null
  return summaryOf(lesson, recent, owner)
}

/** Lições ainda não concluídas das duas camadas, para a recomendação da home. */
export function pendingLessons(profileId: number): { base: LessonSummary[]; focus: LessonSummary[] } {
  // V2: usa o perfil pedido (antes ignorava o próprio argumento e lia o padrão).
  const base = curriculumView(profileId)
    .units.flatMap((unit) => unit.lessons)
    .filter((lesson) => lesson.status !== 'completed')

  const focus = openTrackLessons(profileId)

  return { base, focus }
}

export async function generatePlacement(
  input: { goal?: string; targetLang?: string; nativeLang?: string } = {},
  profileId = activeProfileId()
): Promise<PlacementTest> {
  const profile = requireProfileRow(profileId)
  // Durante o onboarding o idioma já foi escolhido mas ainda não foi salvo no
  // perfil — o teste de nivelamento nasce no idioma-alvo certo na hora.
  const locale = promptLocale(
    normalizeLangCode(input.targetLang) ?? profile.targetLang,
    normalizeLangCode(input.nativeLang) ?? profile.nativeLang
  )
  const prompt = placementPrompt((input.goal ?? profile.goal ?? '').trim(), locale)

  const generated = await generateStructured(placementSchema, {
    system: prompt.system,
    user: prompt.user,
    temperature: 0.4,
    role: 'strong'
  })

  const questions: StoredPlacementQuestion[] = generated.questions.map((question, index) => ({
    id: `q${index + 1}`,
    level: question.level,
    prompt: question.prompt,
    options: question.options,
    answerIndex: question.answerIndex,
    explanation: question.explanation
  }))

  const stored: StoredPlacement = { createdAt: Date.now(), questions }
  writePrefs(profile, { placement: stored })

  return {
    createdAt: stored.createdAt,
    questions: questions.map(({ id, level, prompt: text, options }) => ({
      id,
      level,
      prompt: text,
      options
    }))
  }
}

export function submitPlacement(answers: number[], profileId = activeProfileId()): PlacementResult {
  const db = getDb()
  const profile = requireProfileRow(profileId)
  const stored = readPrefs(profile).placement

  if (!stored || stored.questions.length === 0) {
    throw new Error('Nenhum teste de nivelamento foi gerado ainda.')
  }

  if (answers.length !== stored.questions.length) {
    throw new Error('Responda todas as questões do nivelamento.')
  }

  let earned = 0
  let totalWeight = 0
  let correct = 0

  stored.questions.forEach((question, index) => {
    const weight = levelIndex(question.level) + 1
    totalWeight += weight

    if (answers[index] === question.answerIndex) {
      earned += weight
      correct += 1
    }
  })

  const score = totalWeight > 0 ? earned / totalWeight : 0
  const cefr = levelFromScore(score)

  db.update(schema.profiles)
    .set({ cefr, placementScore: score })
    .where(eq(schema.profiles.id, profile.id))
    .run()

  const sample = score * 5
  setSkill(profile.id, 'reading', sample, 0.5)
  setSkill(profile.id, 'grammar', sample, 0.5)
  setSkill(profile.id, 'vocab', sample, 0.5)

  return { cefr, correct, total: stored.questions.length, score }
}

/** Código de idioma defensivamente normalizado ('En ' → 'en'); sem tabela, sem rejeitar o usuário. */
function normalizeLangCode(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!/^[A-Za-z]{2}(-[A-Za-z]{2,4})?$/.test(trimmed)) return null
  const [base, region] = trimmed.split('-')
  if (!base) return null
  return region ? `${base.toLowerCase()}-${region.toUpperCase()}` : base.toLowerCase()
}

export function completeOnboarding(input: OnboardingInput, profileId = activeProfileId()): ProfileState {
  const db = getDb()
  const profile = requireProfileRow(profileId)

  if (!CEFR_LEVELS.includes(input.cefr)) {
    throw new Error('Nível inválido.')
  }

  const goal = input.goal.trim()
  if (!goal) throw new Error('Escolha ou escreva um objetivo.')

  // M4: o par de idiomas nasce aqui e governa prompts, banco de correção e
  // escrita (RTL/CJK) para todo o resto do app.
  const targetLang = normalizeLangCode(input.targetLang) ?? profile.targetLang
  const nativeLang = normalizeLangCode(input.nativeLang) ?? profile.nativeLang
  const alreadyDone = profile.onboardingCompletedAt != null

  if (alreadyDone && (targetLang !== profile.targetLang || nativeLang !== profile.nativeLang)) {
    throw new Error(
      'O idioma ensinado só pode ser escolhido no primeiro onboarding: o currículo salvo pertence ao idioma anterior. Crie outro perfil para mudar de idioma.'
    )
  }

  db.update(schema.profiles)
    .set({
      goal,
      cefr: input.cefr,
      targetLang,
      nativeLang,
      name: input.name?.trim() || profile.name,
      color: input.color?.trim() || profile.color,
      focusMix: getSettings().focusMix,
      onboardingCompletedAt: profile.onboardingCompletedAt ?? Date.now()
    })
    .where(eq(schema.profiles.id, profile.id))
    .run()

  const sample = (levelIndex(input.cefr) + 1) * 0.85
  for (const skill of ['reading', 'grammar', 'vocab'] as SkillId[]) {
    const existing = db
      .select()
      .from(schema.skillsState)
      .where(and(eq(schema.skillsState.profileId, profile.id), eq(schema.skillsState.skill, skill)))
      .get()

    if (!existing) setSkill(profile.id, skill, sample, 0.35)
  }

  return profileState(profile.id)
}

/**
 * "Primeiro acesso" **deste perfil**: apaga a memória de aprendizado dele —
 * caderno de erros, cards e revisões, tentativas, progresso, sessões, conversas,
 * trilhas e currículo — e devolve o perfil ao estado pré-onboarding, mantendo
 * nome e cor. V2: os outros perfis não são tocados (antes era um DELETE global).
 * Configurações de IA e chaves continuam fora: são preferência do app.
 */
export function resetMemory(profileId = activeProfileId()): ProfileState {
  const db = getDb()
  const profile = requireProfileRow(profileId)

  db.transaction((tx) => {
    // FK com cascade: reviews (cards), messages (conversas), lesson_items (lições),
    // attempts (exercícios). O que não tem cascade sai na lista abaixo.
    const lessonIds = lessonIdsForProfile(profile.id)
    const trackIds = tx
      .select({ id: schema.focusTracks.id })
      .from(schema.focusTracks)
      .where(eq(schema.focusTracks.profileId, profile.id))
      .all()
      .map((row) => row.id)
    const conversationIds = tx
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.profileId, profile.id))
      .all()
      .map((row) => row.id)

    tx.delete(schema.reviews)
      .where(sql`${schema.reviews.cardId} in (select ${schema.cards.id} from ${schema.cards} where ${schema.cards.profileId} = ${profile.id})`)
      .run()
    tx.delete(schema.cards).where(eq(schema.cards.profileId, profile.id)).run()
    tx.delete(schema.errors).where(eq(schema.errors.profileId, profile.id)).run()

    if (lessonIds.length > 0) {
      tx.delete(schema.attempts)
        .where(
          sql`${schema.attempts.exerciseId} in (select ${schema.exercises.id} from ${schema.exercises} where ${schema.exercises.lessonId} in (${sql.join(lessonIds.map((id) => sql`${id}`), sql`, `)}))`
        )
        .run()
      tx.delete(schema.exercises).where(inArray(schema.exercises.lessonId, lessonIds)).run()
      tx.delete(schema.speechRuns).where(inArray(schema.speechRuns.lessonId, lessonIds)).run()
      tx.delete(schema.lessons).where(inArray(schema.lessons.id, lessonIds)).run()
    }
    tx.delete(schema.lessons).where(eq(schema.lessons.profileId, profile.id)).run()

    tx.delete(schema.speechRuns).where(eq(schema.speechRuns.profileId, profile.id)).run()
    tx.delete(schema.audioCache).where(eq(schema.audioCache.profileId, profile.id)).run()

    if (conversationIds.length > 0) {
      tx.delete(schema.scenarioRuns).where(inArray(schema.scenarioRuns.conversationId, conversationIds)).run()
      tx.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds)).run()
    }
    tx.delete(schema.scenarioRuns)
      .where(sql`${schema.scenarioRuns.conversationId} in (select ${schema.conversations.id} from ${schema.conversations} where ${schema.conversations.profileId} = ${profile.id})`)
      .run()

    if (trackIds.length > 0) tx.delete(schema.trackLessons).where(inArray(schema.trackLessons.trackId, trackIds)).run()

    tx.delete(schema.lessonProgress).where(eq(schema.lessonProgress.profileId, profile.id)).run()
    tx.delete(schema.studySessions).where(eq(schema.studySessions.profileId, profile.id)).run()
    tx.delete(schema.contentReports).where(eq(schema.contentReports.profileId, profile.id)).run()
    tx.delete(schema.focusTracks).where(eq(schema.focusTracks.profileId, profile.id)).run()
    tx.delete(schema.units).where(eq(schema.units.profileId, profile.id)).run()
    tx.delete(schema.skillsState).where(eq(schema.skillsState.profileId, profile.id)).run()

    // Currículo e memoriais do perfil voltam ao zero, incluindo nivelamento salvo.
    tx.update(schema.profiles)
      .set({
        onboardingCompletedAt: null,
        placementScore: null,
        cefr: null,
        goal: null,
        prefs: null
      })
      .where(eq(schema.profiles.id, profile.id))
      .run()
  })

  emitStudentEvent('memory-reset', String(profile.id), profile.id)
  return profileState(profile.id)
}

/**
 * V2: a lista de perfis com o peso da memória de cada um — a tela de perfis e o
 * seletor da sidebar leem isto, nunca o banco. Cada contagem é escopada.
 */
export function profilesView(activeId = activeProfileId()): ProfilesView {
  const db = getDb()
  const rows = listProfiles()

  const profiles: ProfileSummary[] = rows.map((row) => {
    const completedLessons = db
      .select({ value: count() })
      .from(schema.lessonProgress)
      .where(and(eq(schema.lessonProgress.profileId, row.id), eq(schema.lessonProgress.status, 'completed')))
      .get()?.value ?? 0

    const dueCards = dueCount(row.id)

    const openErrors = db
      .select({ value: count() })
      .from(schema.errors)
      .where(and(eq(schema.errors.profileId, row.id), isNull(schema.errors.resolvedAt)))
      .get()?.value ?? 0

    const activeTracks = db
      .select({ value: count() })
      .from(schema.focusTracks)
      .where(and(eq(schema.focusTracks.profileId, row.id), eq(schema.focusTracks.status, 'active')))
      .get()?.value ?? 0

    return {
      ...profileView(row),
      completedLessons: Number(completedLessons),
      dueCards,
      openErrors: Number(openErrors),
      activeTracks: Number(activeTracks),
      active: row.id === activeId
    }
  })

  return {
    profiles,
    activeProfileId: activeId,
    colors: [...PROFILE_COLORS],
    multiProfile: profiles.length > 1
  }
}

export function registerLearningIpc(): void {
  handle('profile:get', () => profileState())

  // --- V2: múltiplos perfis --------------------------------------------------
  handle('profile:list', (): ProfilesView => profilesView())

  handle('profile:switch', (_event, profileId: number) => {
    const row = setActiveProfile(profileId)
    // V2: stream e geração longa de outro perfil não continuam atrás da troca.
    cancelTurnsExceptProfile(row.id)
    cancelJobsExceptProfile(row.id)
    return profilesView(row.id)
  })

  handle('profile:create', (_event, input: CreateProfileInput = {}) => {
    const row = createProfile({
      name: input.name ?? null,
      color: input.color ?? null,
      targetLang: input.targetLang,
      nativeLang: input.nativeLang
    })
    if (input.goal?.trim() || input.cefr) {
      completeOnboarding(
        {
          goal: input.goal?.trim() || 'conversação geral',
          cefr: input.cefr ?? 'A2',
          targetLang: input.targetLang,
          nativeLang: input.nativeLang,
          name: input.name,
          color: input.color
        },
        row.id
      )
    }
    return profileState(row.id)
  })

  handle('profile:update', (_event, input: UpdateProfileInput & { profileId?: number }) =>
    profileView(
      updateProfile(resolveProfileId(input.profileId), {
        name: input.name,
        color: input.color,
        goal: input.goal,
        focusMix: input.focusMix
      })
    )
  )

  handle('profile:delete', (_event, input: { profileId: number; acknowledged: boolean }) => {
    if (!input.acknowledged) throw new Error('A exclusão de um perfil precisa ser confirmada.')
    return deleteProfile(input.profileId)
  })

  handle('profile:onboard', (_event, input: OnboardingInput) => completeOnboarding(input))

  handle('profile:reset-memory', () => resetMemory())

  handle(
    'placement:generate',
    (_event, input?: string | { goal?: string; targetLang?: string; nativeLang?: string }) =>
      generatePlacement(typeof input === 'string' ? { goal: input } : (input ?? {}))
  )

  handle('placement:submit', (_event, answers: number[]) => submitPlacement(answers))

  handle('curriculum:get', () => curriculumView())

  handle('curriculum:generate', () => generateCurriculum())

  handle('lesson:open', (_event, lessonId: number) => openLesson(lessonId))

  handle('lesson:regenerate', (_event, lessonId: number) => regenerateLessonExercises(lessonId))

  handle(
    'lesson:answer',
    (
      _event,
      input: { exerciseId: number; response: string; latencyMs?: number }
    ): Promise<GradeFeedback> => answerExercise(input)
  )

  handle('lesson:finish', (_event, input: { lessonId: number; sessionId: number }) =>
    finishLesson(input)
  )
}
