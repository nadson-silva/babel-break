/**
 * Modo cenário (M3) — roleplay com persona, rubrica de tarefa e feedback.
 *
 * Dois pontos estruturais:
 *
 * 1. **A persona vive no banco, não no prompt solto.** O cenário é gerado uma vez
 *    (`scenario_gen`, com seed do banco local quando a IA está fora do ar) e
 *    gravado na lição ou na conversa. Reabrir o mesmo cenário não regasta tokens
 *    nem muda a tarefa no meio do caminho.
 * 2. **A rubrica separa conteúdo de língua.** `contentScore` mede se a tarefa foi
 *    cumprida, critério a critério; `languageScore` mede a língua. É isso que
 *    impede "soa fluente, não respondeu nada" de tirar nota boa — e torna a
 *    avaliação muito menos subjetiva que uma nota 1–10.
 */
import { handle } from './ipc-contract'
import { and, asc, desc, eq } from 'drizzle-orm'
import type {
  ConversationMode,
  Correction,
  ScenarioFeedbackView,
  ScenarioPhrase,
  ScenarioRunView,
  ScenarioSession,
  ScenarioView
} from '../shared/types'
import { clampLevel } from '../core/cefr'
import { scenarioFeedbackPrompt, scenarioGenPrompt, promptLocale } from '../core/prompts'
import { deterministicContentSupported, tokenize } from '../core/languages'
import { scenarioFeedbackSchema, scenarioSchema, type ScenarioOutput } from '../core/schemas'
import { detectBucket, fallbackScenario, scenarioFeedbackFrom } from '../core/tracks'
import { phraseCard } from '../core/srs'
import { currentModel, generateStructured } from './ai'
import { emitStudentEvent } from './events'
import { getDb, getDefaultProfile, schema } from './db'
import { errorHints } from './notebook'
import { createCard } from './review'
import { storedScenarioSeed, trackContextOf } from './tracks'
import { closeConversation, scenarioViewOf, toSummary } from './tutor'
import { blendSkill } from './learning'

type ConversationRow = typeof schema.conversations.$inferSelect
type RunRow = typeof schema.scenarioRuns.$inferSelect

interface StoredScenario extends ScenarioOutput {
  source: 'ai' | 'fallback'
  /** Trilha de origem, quando o cenário nasceu de uma lição de foco. */
  trackGoalTag?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function toView(stored: StoredScenario): ScenarioView {
  return {
    persona: stored.persona,
    setting: stored.setting,
    successCriteria: stored.successCriteria,
    openingLine: stored.openingLine,
    source: stored.source
  }
}

/** Fallback determinístico: banco de domínio escrito à mão, sem gastar token. Só cobre o idioma-fixture (inglês). */
function localScenario(input: { title: string; objective: string; goalTag?: string; targetLang: string }): StoredScenario {
  if (!deterministicContentSupported(input.targetLang)) {
    throw new Error(
      'Sem IA disponível: o cenário determinístico offline só cobre inglês. Configure um provedor em Configurações.'
    )
  }
  const bucket = detectBucket(`${input.goalTag ?? ''} ${input.objective} ${input.title}`)
  return { ...fallbackScenario(bucket), source: 'fallback' }
}

/** Cenário da lição: cache em `lessons.scenario`, IA quando disponível. */
export async function ensureLessonScenario(lessonId: number): Promise<ScenarioView> {
  const db = getDb()

  const lesson = db.select().from(schema.lessons).where(eq(schema.lessons.id, lessonId)).get()
  if (!lesson) throw new Error('Lição não encontrada.')

  const cached = storedScenarioSeed(lesson.scenario)
  // O seed do banco local é placeholder: com modelo configurado ele é trocado
  // pelo cenário da IA na primeira abertura. Cenário já gerado pela IA fica
  // cacheado — reabrir não regasta tokens nem muda a tarefa no meio.
  if (cached && !(cached.source === 'fallback' && currentModel())) {
    return toView(cached as StoredScenario)
  }

  const profile = getDefaultProfile()
  const locale = promptLocale(profile.targetLang, profile.nativeLang)
  const goalTag = lesson.trackId != null ? trackContextOf(lesson)?.goalTag : undefined
  const objective = lesson.objective ?? lesson.title

  let stored: StoredScenario
  try {
    const prompt = scenarioGenPrompt({
      lessonTitle: lesson.title,
      objective,
      level: clampLevel(profile.cefr),
      goal: profile.goal ?? objective,
      locale
    })
    const generated = await generateStructured(scenarioSchema, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.6
    })
    stored = { ...generated, source: 'ai', ...(goalTag ? { trackGoalTag: goalTag } : {}) }
  } catch (error) {
    console.warn('[scenario] geração por IA indisponível, usando o cenário local:', errorMessage(error))
    stored = localScenario({ title: lesson.title, objective, goalTag, targetLang: profile.targetLang })
  }

  db.update(schema.lessons).set({ scenario: JSON.stringify(stored) }).where(eq(schema.lessons.id, lessonId)).run()

  return toView(stored)
}

/** Cenário avulso ("tenho entrevista amanhã"): tema livre, sem precisar de trilha. */
export async function ensureTopicScenario(topic: string): Promise<ScenarioView> {
  const objective = topic.trim()
  if (!objective) throw new Error('Escolha um tema para o roleplay.')

  const profile = getDefaultProfile()
  const locale = promptLocale(profile.targetLang, profile.nativeLang)

  try {
    const prompt = scenarioGenPrompt({
      lessonTitle: objective,
      objective,
      level: clampLevel(profile.cefr),
      goal: profile.goal ?? objective,
      locale
    })
    const generated = await generateStructured(scenarioSchema, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.6
    })
    return toView({ ...generated, source: 'ai' })
  } catch (error) {
    console.warn('[scenario] tema livre sem IA, usando cenário local:', errorMessage(error))
    return toView(localScenario({ title: objective, objective, targetLang: profile.targetLang }))
  }
}

/**
 * Abre o roleplay: conversa em modo cenário, já com a primeira fala do
 * personagem gravada (o aluno não espera a IA para começar a falar).
 */
export async function startScenarioRun(
  profileId: number,
  input: { lessonId?: number | null; topic?: string | null }
): Promise<ScenarioSession> {
  const lessonId = input.lessonId ?? null
  const topic = input.topic?.trim() || null

  if (lessonId == null && !topic) throw new Error('Escolha uma lição ou um tema para o cenário.')

  const scenario = lessonId != null ? await ensureLessonScenario(lessonId) : await ensureTopicScenario(topic!)

  const db = getDb()
  const now = Date.now()

  const conversation = db
    .insert(schema.conversations)
    .values({
      profileId,
      lessonId,
      mode: 'scenario' as ConversationMode,
      topic: topic ?? scenario.setting,
      scenario: JSON.stringify(scenario),
      summary: null,
      createdAt: now,
      lastMessageAt: now,
      closedAt: null
    })
    .returning()
    .get()

  db.insert(schema.messages)
    .values({
      conversationId: conversation.id,
      role: 'assistant',
      content: scenario.openingLine,
      corrections: null,
      createdAt: now
    })
    .run()

  db.insert(schema.studySessions)
    .values({
      profileId,
      kind: 'conversation',
      startedAt: now,
      summary: JSON.stringify({ conversationId: conversation.id, mode: 'scenario' })
    })
    .run()

  return { conversation: toSummary(conversation), scenario, run: null }
}

export function scenarioOfConversation(conversation: ConversationRow): ScenarioView | null {
  return scenarioViewOf(conversation)
}

function lessonTitleOf(lessonId: number | null): string | null {
  if (lessonId == null) return null
  return (
    getDb()
      .select({ title: schema.lessons.title })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId))
      .get()?.title ?? null
  )
}

function toRunView(row: RunRow): ScenarioRunView {
  const feedback = parseJson<{ feedback?: string }>(row.feedback)
  return {
    id: row.id,
    lessonId: row.lessonId,
    lessonTitle: lessonTitleOf(row.lessonId),
    conversationId: row.conversationId,
    contentScore: row.contentScore,
    languageScore: row.languageScore,
    feedback: feedback?.feedback ?? null,
    createdAt: row.createdAt
  }
}

export function scenarioRuns(profileId: number, limit = 10): ScenarioRunView[] {
  return getDb()
    .select({ run: schema.scenarioRuns })
    .from(schema.scenarioRuns)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.scenarioRuns.conversationId))
    .where(eq(schema.conversations.profileId, profileId))
    .orderBy(desc(schema.scenarioRuns.id))
    .limit(limit)
    .all()
    .map((row) => toRunView(row.run))
}

interface StoredRun {
  feedback: string
  bestPhrases: ScenarioPhrase[]
  followUpDrill: string
  criteria: { criterion: string; met: boolean }[]
  cardsCreated: number
  levelChange: { from: string; to: string } | null
  source: 'ai' | 'fallback'
}

function rebuildRun(row: RunRow): ScenarioFeedbackView {
  const stored = parseJson<StoredRun>(row.feedback)

  return {
    runId: row.id,
    conversationId: row.conversationId,
    lessonId: row.lessonId,
    createdAt: row.createdAt,
    contentScore: row.contentScore ?? 0,
    languageScore: row.languageScore ?? 0,
    feedback: stored?.feedback ?? '',
    bestPhrases: stored?.bestPhrases ?? [],
    followUpDrill: stored?.followUpDrill ?? '',
    criteria: stored?.criteria ?? [],
    cardsCreated: stored?.cardsCreated ?? 0,
    levelChange:
      stored?.levelChange && 'from' in stored.levelChange && 'to' in stored.levelChange
        ? { from: clampLevel(stored.levelChange.from), to: clampLevel(stored.levelChange.to) }
        : null,
    source: stored?.source ?? 'fallback'
  }
}

export function latestRunOf(conversationId: number): ScenarioFeedbackView | null {
  const row = getDb()
    .select()
    .from(schema.scenarioRuns)
    .where(eq(schema.scenarioRuns.conversationId, conversationId))
    .orderBy(desc(schema.scenarioRuns.id))
    .limit(1)
    .get()

  return row ? rebuildRun(row) : null
}

export function scenarioSessionView(profileId: number, conversationId: number): ScenarioSession | null {
  const conversation = getDb()
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.profileId, profileId)))
    .get()

  if (!conversation) return null

  const scenario = scenarioOfConversation(conversation)
  if (!scenario) return null

  return { conversation: toSummary(conversation), scenario, run: latestRunOf(conversationId) }
}

/** Critério cumprido: sobreposição de palavras-contentor com a fala do aluno. */
function criterionMet(criterion: string, speech: string): boolean {
  const words = criterion
    .toLowerCase()
    .split(/[^a-zà-ÿ0-9]+/)
    .filter((word) => word.length >= 5)

  if (words.length === 0) return speech.trim().length > 0
  return words.some((word) => speech.includes(word))
}

/**
 * Fecha o roleplay e produz a rubrica. As melhores frases viram card SRS, o
 * drill de follow-up volta como sugestão de prática e a conversa é encerrada
 * com a recapitulação do M2 (correções → cards → tags).
 */
export async function finishScenarioRun(
  profileId: number,
  conversationId: number
): Promise<ScenarioFeedbackView> {
  const db = getDb()

  const conversation = db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.profileId, profileId)))
    .get()

  if (!conversation) throw new Error('Conversa não encontrada.')

  const scenario = scenarioOfConversation(conversation)
  if (!scenario) throw new Error('Esta conversa não é um cenário.')

  const rows = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.id))
    .all()

  const studentRows = rows.filter((row) => row.role === 'user')
  const corrections: Correction[] = studentRows.flatMap((row) => parseJson<Correction[]>(row.corrections) ?? [])
  const speech = studentRows.map((row) => row.content).join(' ').toLowerCase()
  const profile = getDefaultProfile()
  const locale = promptLocale(profile.targetLang, profile.nativeLang)
  // Contagem de palavras pela escrita do idioma-alvo (CJK não usa espaços).
  const words = studentRows.reduce((sum, row) => sum + tokenize(row.content, profile.targetLang).length, 0)
  const transcript = rows.map((row) => `${row.role === 'user' ? 'aluno' : 'tutor'}: ${row.content}`).join('\n')

  let contentScore: number
  let languageScore: number
  let feedbackText: string
  let bestPhrases: ScenarioPhrase[]
  let followUpDrill: string
  let criteriaMet: boolean[]
  let source: 'ai' | 'fallback'

  try {
    const prompt = scenarioFeedbackPrompt({
      persona: scenario.persona,
      setting: scenario.setting,
      criteria: scenario.successCriteria,
      transcript,
      level: clampLevel(profile.cefr),
      errors: errorHints(profileId, 5),
      locale
    })

    const graded = await generateStructured(scenarioFeedbackSchema, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.3
    })

    contentScore = graded.contentScore
    languageScore = graded.languageScore
    feedbackText = graded.feedback
    bestPhrases = graded.bestPhrases
    followUpDrill = graded.followUpDrill
    criteriaMet = scenario.successCriteria.map((criterion, index) =>
      typeof graded.criteriaMet[index] === 'boolean' ? graded.criteriaMet[index] : criterionMet(criterion, speech)
    )
    source = 'ai'
  } catch (error) {
    console.warn('[scenario] rubrica por IA indisponível, usando rubrica local:', errorMessage(error))

    const local = scenarioFeedbackFrom({
      studentTurns: studentRows.map((row) => row.content),
      criteria: scenario.successCriteria,
      corrections: corrections.length,
      words
    })

    contentScore = local.contentScore
    languageScore = local.languageScore
    feedbackText = local.feedback
    bestPhrases = local.bestPhrases
    followUpDrill = local.followUpDrill
    criteriaMet = local.criteriaMet
    source = 'fallback'
  }

  let cardsCreated = 0
  for (const phrase of bestPhrases.slice(0, 3)) {
    if (!phrase.improved?.trim()) continue
    const created = createCard(
      profileId,
      phraseCard(phrase.improved, phrase.original, conversation.lessonId, locale),
      'conversation',
      conversation.lessonId
    )
    if (created) cardsCreated += 1
  }

  blendSkill(profileId, 'speaking', contentScore * 5)
  blendSkill(profileId, 'writing', languageScore * 5)

  const recap = closeConversation(profileId, conversationId)

  const run = db
    .insert(schema.scenarioRuns)
    .values({
      lessonId: conversation.lessonId,
      conversationId,
      contentScore,
      languageScore,
      feedback: JSON.stringify({
        feedback: feedbackText,
        bestPhrases,
        followUpDrill,
        criteria: scenario.successCriteria.map((criterion, index) => ({ criterion, met: criteriaMet[index] })),
        cardsCreated,
        levelChange: recap.levelChange,
        source
      }),
      createdAt: Date.now()
    })
    .returning()
    .get()

  emitStudentEvent('scenario-finished', conversation.lessonId ? String(conversation.lessonId) : undefined)

  return {
    runId: run.id,
    conversationId,
    lessonId: conversation.lessonId,
    createdAt: run.createdAt,
    contentScore,
    languageScore,
    feedback: feedbackText,
    bestPhrases,
    followUpDrill,
    criteria: scenario.successCriteria.map((criterion, index) => ({ criterion, met: criteriaMet[index] })),
    cardsCreated,
    levelChange: recap.levelChange,
    source
  }
}

/**
 * Regenera o cenário de uma lição (o aluno pediu outro personagem). A lição
 * continua no mesmo nível e domínio; troca só a encenação.
 */
export async function refreshLessonScenario(lessonId: number): Promise<ScenarioView> {
  getDb().update(schema.lessons).set({ scenario: null }).where(eq(schema.lessons.id, lessonId)).run()
  return ensureLessonScenario(lessonId)
}

/** Canais do modo cenário: abrir roleplay, fechar com rubrica, histórico. */
export function registerScenarioIpc(): void {
  const profileId = (): number => getDefaultProfile().id

  handle('scenario:open', (_event, input: { lessonId?: number | null; topic?: string | null }) =>
    startScenarioRun(profileId(), input)
  )

  handle('scenario:finish', (_event, conversationId: number) => finishScenarioRun(profileId(), conversationId))

  handle('scenario:session', (_event, conversationId: number) =>
    scenarioSessionView(profileId(), conversationId)
  )

  handle('scenario:runs', (_event, limit?: number) => scenarioRuns(profileId(), limit ?? 10))

  handle('scenario:refresh', (_event, lessonId: number) => refreshLessonScenario(lessonId))
}
