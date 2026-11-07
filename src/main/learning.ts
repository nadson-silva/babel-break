import { ipcMain } from 'electron'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
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
  ProfileState,
  ProfileView,
  SkillId,
  UnitView
} from '../shared/types'
import type { ErrorFocusEntry } from '../core/adapt'
import { clampLevel, levelIndex, levelFromScore, CEFR_LEVELS } from '../core/cefr'
import { fallbackCurriculum, fallbackExercises, fallbackLessonContent, pitfallsFrom } from '../core/fallback'
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
  type ErrorHint
} from '../core/prompts'
import {
  curriculumSchema,
  exerciseSetSchema,
  gradeSchema,
  lessonContentSchema,
  placementSchema,
  type CurriculumOutput,
  type ExerciseSetOutput,
  type LessonContentOutput
} from '../core/schemas'
import { generateStructured } from './ai'
import { getDb, getDefaultProfile, schema } from './db'
import { errorHints, focusFor, recordCorrections } from './notebook'
import { cardsForLesson, cardsForPhrases, cardsForRecurringErrors } from './review'
import { applyReestimation } from './tutor'
import { getSettings } from './settings'

type ProfileRow = typeof schema.profiles.$inferSelect
type UnitRow = typeof schema.units.$inferSelect
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
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function toStatus(value: string | null | undefined): LessonStatus {
  return value === 'in_progress' || value === 'completed' ? value : 'not_started'
}

function toCefr(value: string | null | undefined): CefrLevel {
  return clampLevel(value)
}

export function profileView(profile: ProfileRow): ProfileView {
  return {
    id: profile.id,
    targetLang: profile.targetLang,
    nativeLang: profile.nativeLang,
    goal: profile.goal,
    cefr: profile.cefr ? toCefr(profile.cefr) : null,
    focusMix: profile.focusMix,
    placementScore: profile.placementScore,
    onboardingComplete: profile.onboardingCompletedAt != null
  }
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

function profileState(): ProfileState {
  const profile = getDefaultProfile()
  return {
    profile: profileView(profile),
    skills: skillsOf(profile.id),
    curriculumReady: unitCount(profile.id) > 0
  }
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

function blendSkill(profileId: number, skill: SkillId, sample: number): void {
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

function summaryOf(lesson: LessonRow, unitTitle: string | null, progress: ProgressRow | undefined): LessonSummary {
  return {
    id: lesson.id,
    unitId: lesson.unitId,
    unitTitle,
    title: lesson.title,
    level: toCefr(lesson.level),
    position: lesson.position,
    status: toStatus(progress?.status),
    score: progress?.score ?? null,
    hasContent: Boolean(lesson.content)
  }
}

export function curriculumView(): CurriculumView {
  const db = getDb()
  const profile = getDefaultProfile()

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
    list.push(summaryOf(lesson, unit?.title ?? null, progressByLesson.get(lesson.id)))
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

let curriculumJob: Promise<CurriculumView> | null = null

export function generateCurriculum(): Promise<CurriculumView> {
  if (curriculumJob) return curriculumJob

  curriculumJob = (async () => {
    const db = getDb()
    const profile = getDefaultProfile()

    if (unitCount(profile.id) > 0) return curriculumView()

    const level = toCefr(profile.cefr)
    const prompt = curriculumPrompt({ goal: profile.goal ?? '', level })

    let plan: CurriculumOutput
    try {
      plan = await generateStructured(curriculumSchema, {
        system: prompt.system,
        user: prompt.user,
        temperature: 0.3
      })
    } catch (error) {
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

    return curriculumView()
  })().finally(() => {
    curriculumJob = null
  })

  return curriculumJob
}

function getOwnedLesson(lessonId: number, profileId: number): { lesson: LessonRow; unit: UnitRow } | null {
  const row = getDb()
    .select({ lesson: schema.lessons, unit: schema.units })
    .from(schema.lessons)
    .innerJoin(schema.units, eq(schema.lessons.unitId, schema.units.id))
    .where(and(eq(schema.lessons.id, lessonId), eq(schema.units.profileId, profileId)))
    .get()

  return row ?? null
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

function exercisePayload(row: ExerciseRow): ExercisePayload {
  return (
    parseJson<ExercisePayload>(row.payload) ?? {
      instruction: '',
      prompt: '',
      options: [],
      tokens: []
    }
  )
}

function toExerciseView(row: ExerciseRow): ExerciseView {
  const payload = exercisePayload(row)
  return {
    id: row.id,
    type: row.type as ExerciseType,
    instruction: payload.instruction,
    prompt: payload.prompt,
    options: payload.options ?? [],
    tokens: payload.tokens ?? [],
    source: row.source === 'ai' || row.source === 'fallback' ? row.source : null,
    targetTags: payload.targetTags ?? parseJson<{ targetTags?: string[] }>(row.answerKey)?.targetTags ?? []
  }
}

async function ensureLessonGenerated(
  lesson: LessonRow,
  profile: ProfileRow,
  unitTitle: string
): Promise<ErrorFocusEntry[]> {
  const db = getDb()
  const level = toCefr(lesson.level)
  const focus = focusFor(profile.id, 5)

  let content = parseJson<LessonContentView>(lesson.content)

  if (!content) {
    const hints = recentErrorHints(profile.id)
    const prompt = lessonContentPrompt({
      title: lesson.title,
      objective: lesson.objective ?? lesson.title,
      unitTitle,
      level,
      goal: profile.goal ?? '',
      errors: hints
    })

    let generated: LessonContentOutput
    let source: 'ai' | 'fallback'

    try {
      generated = await generateStructured(lessonContentSchema, {
        system: prompt.system,
        user: prompt.user,
        temperature: 0.4
      })
      source = 'ai'
    } catch (error) {
      console.warn(
        '[learning] geração do conteúdo falhou, usando conteúdo determinístico:',
        error instanceof Error ? error.message : error
      )
      generated = fallbackLessonContent({
        title: lesson.title,
        objective: lesson.objective ?? lesson.title,
        level,
        errors: focus
      })
      source = 'fallback'
    }

    const resolved: LessonContentView = {
      ...generated,
      pitfalls: generated.pitfalls ?? pitfallsFrom(focus),
      source
    }
    content = resolved

    db.transaction((tx) => {
      tx.update(schema.lessons)
        .set({ content: JSON.stringify(resolved), level: resolved.level, version: lesson.version + 1 })
        .where(eq(schema.lessons.id, lesson.id))
        .run()

      tx.delete(schema.lessonItems).where(eq(schema.lessonItems.lessonId, lesson.id)).run()

      for (const item of resolved.vocabulary) {
        tx.insert(schema.lessonItems)
          .values({ lessonId: lesson.id, kind: 'vocab', payload: JSON.stringify(item) })
          .run()
      }
      for (const item of resolved.grammarPoints) {
        tx.insert(schema.lessonItems)
          .values({ lessonId: lesson.id, kind: 'grammar', payload: JSON.stringify(item) })
          .run()
      }
    })
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
    .select({ id: schema.exercises.id })
    .from(schema.exercises)
    .where(eq(schema.exercises.lessonId, lesson.id))
    .all()

  if (existingExercises.length > 0) return focus

  const hints = recentErrorHints(profile.id)
  const prompt = exercisePrompt({
    content: exerciseLevel,
    level: content.level,
    goal: profile.goal ?? '',
    errors: hints
  })

  let generated: ExerciseSetOutput
  let source: 'ai' | 'fallback'

  try {
    generated = await generateStructured(exerciseSetSchema, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.4
    })
    source = 'ai'
  } catch (error) {
    console.warn(
      '[learning] geração de exercícios falhou, usando exercícios determinísticos:',
      error instanceof Error ? error.message : error
    )
    generated = fallbackExercises(exerciseLevel, focus)
    source = 'fallback'
  }

  const rows = generated.exercises.map((exercise, index) => {
    let answer = exercise.answer
    let options = exercise.type === 'multiple_choice' ? exercise.options : []
    let tokens: string[] = []

    if (exercise.type === 'multiple_choice' && !options.includes(answer)) {
      const match = options.find((option) => normalizeText(option) === normalizeText(answer))
      if (match) answer = match
    }

    if (exercise.type === 'order') {
      const baseTokens =
        exercise.tokens.length > 0 ? exercise.tokens : answer.split(/\s+/).filter(Boolean)
      tokens = shuffleTokens(baseTokens, lesson.id * 1000 + index)
    }

    options = options.filter(Boolean)

    const payload: ExercisePayload = {
      instruction: exercise.instruction,
      prompt: exercise.prompt,
      options,
      tokens,
      targetTags: exercise.targetTags ?? []
    }

    const answerKey: ExerciseAnswerKey = {
      answer,
      alternatives: exercise.alternatives,
      explanation: exercise.explanation
    }

    return {
      lessonId: lesson.id,
      type: exercise.type,
      payload: JSON.stringify(payload),
      answerKey: JSON.stringify(answerKey),
      source,
      position: index,
      createdAt: Date.now()
    }
  })

  db.transaction((tx) => {
    tx.delete(schema.exercises).where(eq(schema.exercises.lessonId, lesson.id)).run()
    for (const row of rows) {
      tx.insert(schema.exercises).values(row).run()
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

export async function openLesson(lessonId: number): Promise<LessonDetail> {
  const db = getDb()
  const profile = getDefaultProfile()
  const owned = getOwnedLesson(lessonId, profile.id)

  if (!owned) throw new Error('Lição não encontrada.')

  const focus = await ensureLessonGenerated(owned.lesson, profile, owned.unit.title)

  const fresh = getOwnedLesson(lessonId, profile.id)
  if (!fresh) throw new Error('Lição não encontrada.')

  const content = parseJson<LessonContentView>(fresh.lesson.content)
  if (!content) throw new Error('Não foi possível carregar o conteúdo da lição.')

  const exerciseRows = db
    .select()
    .from(schema.exercises)
    .where(eq(schema.exercises.lessonId, lessonId))
    .orderBy(asc(schema.exercises.position), asc(schema.exercises.id))
    .all()

  if (exerciseRows.length === 0) {
    throw new Error('A lição foi gerada sem exercícios. Tente abrir novamente.')
  }

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
    lesson: summaryOf(fresh.lesson, fresh.unit.title, progressOf(profile.id, lessonId)),
    content: { ...content, pitfalls: content.pitfalls ?? pitfallsFrom(focus) },
    exercises: exerciseRows.map(toExerciseView),
    focus,
    sessionId: session.id
  }
}

export async function answerExercise(input: {
  exerciseId: number
  response: string
  latencyMs?: number
}): Promise<GradeFeedback> {
  const db = getDb()
  const profile = getDefaultProfile()

  const exercise = db
    .select()
    .from(schema.exercises)
    .where(eq(schema.exercises.id, input.exerciseId))
    .get()

  if (!exercise) throw new Error('Exercício não encontrado.')

  const lesson = db
    .select()
    .from(schema.lessons)
    .where(eq(schema.lessons.id, exercise.lessonId))
    .get()

  const payload = exercisePayload(exercise)
  const answerKey = parseAnswerKey(exercise)
  const type = exercise.type as ExerciseType
  const response = input.response.trim()

  if (!response) throw new Error('Escreva ou monte uma resposta antes de verificar.')

  let feedback = gradeDeterministic(type, answerKey, response)
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
      level: toCefr(lesson?.level)
    })

    try {
      const graded = await generateStructured(gradeSchema, {
        system: prompt.system,
        user: prompt.user,
        temperature: 0.2
      })
      feedback = {
        correct: graded.correct,
        score: graded.score,
        feedback: graded.feedback,
        corrected: graded.corrected,
        errorTags: graded.errorTags
      }
    } catch {
      const correct = normalizeText(response) === normalizeText(answerKey.answer)
      feedback = {
        correct,
        score: correct ? 1 : 0,
        feedback: correct
          ? 'Correto!'
          : `Ainda não. Resposta esperada: ${answerKey.answer}`,
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

export function finishLesson(input: { lessonId: number; sessionId: number }): LessonResultView {
  const db = getDb()
  const profile = getDefaultProfile()

  const exerciseRows = db
    .select({ id: schema.exercises.id })
    .from(schema.exercises)
    .where(eq(schema.exercises.lessonId, input.lessonId))
    .all()

  const exerciseIds = exerciseRows.map((row) => row.id)

  const latestByExercise = new Map<number, { correct: boolean }>()
  if (exerciseIds.length > 0) {
    const rows = db
      .select()
      .from(schema.attempts)
      .where(inArray(schema.attempts.exerciseId, exerciseIds))
      .orderBy(asc(schema.attempts.id))
      .all()

    for (const row of rows) {
      latestByExercise.set(row.exerciseId, { correct: row.correct })
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

  blendSkill(profile.id, 'grammar', score * 5)
  blendSkill(profile.id, 'vocab', score * 5)

  // Fechamento da lição: vocabulário vira card SRS + erros recorrentes também.
  const lessonRow = db
    .select({ content: schema.lessons.content })
    .from(schema.lessons)
    .where(eq(schema.lessons.id, input.lessonId))
    .get()

  const vocabulary = parseJson<LessonContentView>(lessonRow?.content)?.vocabulary ?? []
  const examples = parseJson<LessonContentView>(lessonRow?.content)?.examples ?? []

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
    .where(eq(schema.studySessions.id, input.sessionId))
    .run()

  return { lessonId: input.lessonId, score, correct, total, cardsCreated, levelChange }
}

/** Lição em andamento mais recente — base do "continuar de onde parei". */
export function lastOpenedLesson(profileId: number): LessonSummary | null {
  const curriculum = curriculumView()
  const lessons = curriculum.units.flatMap((unit) => unit.lessons)

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
  return lessons.find((lesson) => lesson.id === recent.lessonId) ?? null
}

export async function generatePlacement(goal?: string): Promise<PlacementTest> {
  const profile = getDefaultProfile()
  const prompt = placementPrompt((goal ?? profile.goal ?? '').trim())

  const generated = await generateStructured(placementSchema, {
    system: prompt.system,
    user: prompt.user,
    temperature: 0.4
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

export function submitPlacement(answers: number[]): PlacementResult {
  const db = getDb()
  const profile = getDefaultProfile()
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

export function completeOnboarding(input: OnboardingInput): ProfileState {
  const db = getDb()
  const profile = getDefaultProfile()

  if (!CEFR_LEVELS.includes(input.cefr)) {
    throw new Error('Nível inválido.')
  }

  const goal = input.goal.trim()
  if (!goal) throw new Error('Escolha ou escreva um objetivo.')

  db.update(schema.profiles)
    .set({
      goal,
      cefr: input.cefr,
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

  return profileState()
}

export function registerLearningIpc(): void {
  ipcMain.handle('profile:get', () => profileState())

  ipcMain.handle('profile:onboard', (_event, input: OnboardingInput) => completeOnboarding(input))

  ipcMain.handle('placement:generate', (_event, goal?: string) => generatePlacement(goal))

  ipcMain.handle('placement:submit', (_event, answers: number[]) => submitPlacement(answers))

  ipcMain.handle('curriculum:get', () => curriculumView())

  ipcMain.handle('curriculum:generate', () => generateCurriculum())

  ipcMain.handle('lesson:open', (_event, lessonId: number) => openLesson(lessonId))

  ipcMain.handle(
    'lesson:answer',
    (
      _event,
      input: { exerciseId: number; response: string; latencyMs?: number }
    ): Promise<GradeFeedback> => answerExercise(input)
  )

  ipcMain.handle('lesson:finish', (_event, input: { lessonId: number; sessionId: number }) =>
    finishLesson(input)
  )
}
