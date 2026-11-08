/**
 * Conversa com o tutor (M2).
 *
 * Cada turno do aluno passa por dois passos:
 *
 * 1. Passada de correção: banco PT-BR (determinístico, offline) + IA, com as
 *    mesmas tags do caderno de erros. O resultado aparece inline embaixo da
 *    mensagem do aluno e alimenta o caderno.
 * 2. Resposta do tutor em streaming, recebendo nível, objetivo, resumo rolante
 *    da conversa, vocabulário recente e erros recorrentes.
 *
 * No fechamento, a conversa vira recapitulação: correções, tags e cards SRS.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type {
  CefrLevel,
  ChatEvent,
  ChatMessage,
  ConversationMode,
  ConversationSummary,
  ConversationView,
  Correction,
  RecapView,
  ScenarioFeedbackView,
  ScenarioView,
  SkillId,
  TutorMessage
} from '../shared/types'
import { reestimateLevel } from '../core/adapt'
import { bankCorrections, mergeCorrections, tagsOf } from '../core/correction'
import { clampLevel } from '../core/cefr'
import { recast as bankRecast } from '../core/interference'
import {
  correctionPrompt,
  summaryPrompt,
  tutorOpenerMessage,
  tutorSystem,
  type ErrorHint,
  type PromptLocale,
  type ScenarioContext,
  type TutorContext
} from '../core/prompts'
import { correctionSetSchema, conversationSummarySchema } from '../core/schemas'
import { currentModel, generateStructured, trackedStream } from './ai'
import { getDb, schema } from './db'
import { lessonForProfile } from './scope'
import { emitStudentEvent } from './events'
import { interferenceRulesForProfile, localeFor, nativeLangFor } from './locale'
import { runtimeText } from '../core/runtime-text'
import { errorHints, recordCorrections } from './notebook'
import { cardsForErrorsFrom } from './review'
import { trackContextOf } from './tracks'
import { getSettings } from './settings'

type ConversationRow = typeof schema.conversations.$inferSelect
type MessageRow = typeof schema.messages.$inferSelect
type ProfileRow = typeof schema.profiles.$inferSelect

/** Mensagens mantidas literalmente na janela rolante do prompt. */
const WINDOW = 12

/** V3: janela re-injetada numa chamada ao vivo retomada (turnos de texto). */
const LIVE_WINDOW = 10

interface LiveTurn {
  controller: AbortController
  /** V2: de quem é este turno — trocar de perfil cancela só o dele. */
  profileId: number
  conversationId: number
}

const activeRequests = new Map<string, LiveTurn>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseCorrections(json: string | null | undefined): Correction[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as Correction[]) : []
  } catch {
    return []
  }
}

function countMessages(conversationId: number): number {
  return Number(
    getDb()
      .select({ value: sql<number>`count(*)` })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .get()?.value ?? 0
  )
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

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    topic: row.topic,
    mode: (row.mode as ConversationMode) ?? 'free',
    lessonId: row.lessonId,
    lessonTitle: lessonTitleOf(row.lessonId),
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt || row.createdAt,
    messageCount: countMessages(row.id),
    closed: row.closedAt != null
  }
}

export { toSummary }

/** Cenário gravado na conversa, pronto para virar contexto do tutor. */
function scenarioOf(row: ConversationRow): ScenarioContext | null {
  const view = scenarioViewOf(row)
  if (!view) return null

  return { persona: view.persona, setting: view.setting, successCriteria: view.successCriteria }
}

/**
 * Cenário completo da conversa (M3). É o que o renderer mostra como banner:
 * personagem, contexto e critérios — e o que o tutor usa para entrar em
 * personagem. Fica no banco, então reabrir a conversa não regasta nada.
 */
export function scenarioViewOf(row: ConversationRow): ScenarioView | null {
  if (row.mode !== 'scenario' || !row.scenario) return null

  const parsed = safeJson(row.scenario) as {
    persona?: string
    setting?: string
    successCriteria?: string[]
    openingLine?: string
    source?: string
  } | null

  if (!parsed?.persona) return null

  return {
    persona: parsed.persona,
    setting: parsed.setting ?? '',
    successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria : [],
    openingLine: parsed.openingLine ?? '',
    source: parsed.source === 'ai' ? 'ai' : 'fallback'
  }
}

function toMessage(row: MessageRow): TutorMessage {
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content,
    createdAt: row.createdAt,
    corrections: parseCorrections(row.corrections)
  }
}

function messagesOf(conversationId: number): MessageRow[] {
  return getDb()
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.id))
    .all()
}

function conversationOf(profileId: number, conversationId: number): ConversationRow | null {
  return (
    getDb()
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.profileId, profileId)))
      .get() ?? null
  )
}

function touch(conversationId: number): void {
  getDb()
    .update(schema.conversations)
    .set({ lastMessageAt: Date.now() })
    .where(eq(schema.conversations.id, conversationId))
    .run()
}

/**
 * V2 (D2): perfil inexistente é erro, não "o primeiro perfil do aparelho".
 * Sem isto, um id de perfil apagado devolvia prompts, tags e idioma de outro aluno.
 */
function profileOf(profileId: number): ProfileRow {
  const row = getDb().select().from(schema.profiles).where(eq(schema.profiles.id, profileId)).get()
  if (!row) throw new Error('Perfil não encontrado.')
  return row
}

/** Lição ligada à conversa: structures e vocabulário que devem reaparecer. */
interface LessonSeed {
  title: string
  objective: string
  grammar: string[]
  vocabulary: { term: string; translation: string }[]
}

function lessonContext(lessonId: number | null): LessonSeed | null {
  if (lessonId == null) return null

  const row = getDb()
    .select()
    .from(schema.lessons)
    .where(eq(schema.lessons.id, lessonId))
    .get()

  if (!row) return null

  const content = row.content
    ? (safeJson(row.content) as {
        grammarPoints?: { title: string }[]
        vocabulary?: { term: string; translation: string }[]
      } | null)
    : null

  return {
    title: row.title,
    objective: row.objective ?? row.title,
    grammar: (content?.grammarPoints ?? []).map((point) => point.title),
    vocabulary: (content?.vocabulary ?? []).map((item) => ({ term: item.term, translation: item.translation }))
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Vocabulário recente do aluno. Cobre as duas camadas de conteúdo: lições do
 * currículo base (unidade) e lições de trilha — uma junção por unidade deixaria
 * a trilha de fora, e é justamente ela que o cenário precisa reaparecer.
 */
function recentVocabulary(profileId: number): { term: string; translation: string }[] {
  const rows = getDb()
    .select({ payload: schema.lessonItems.payload })
    .from(schema.lessonItems)
    .innerJoin(schema.lessons, eq(schema.lessons.id, schema.lessonItems.lessonId))
    .leftJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
    .leftJoin(schema.focusTracks, eq(schema.focusTracks.id, schema.lessons.trackId))
    .where(
      and(
        eq(schema.lessonItems.kind, 'vocab'),
        sql`coalesce(${schema.units.profileId}, ${schema.focusTracks.profileId}) = ${profileId}`
      )
    )
    .orderBy(desc(schema.lessonItems.id))
    .limit(8)
    .all()

  const items: { term: string; translation: string }[] = []
  for (const row of rows) {
    const payload = safeJson(row.payload) as { term?: string; translation?: string } | null
    if (payload?.term && payload.translation) items.push({ term: payload.term, translation: payload.translation })
  }
  return items
}

function buildContext(profileId: number, conversation: ConversationRow): TutorContext {
  const profile = profileOf(profileId)
  const lesson = lessonContext(conversation.lessonId)
  const scenario = scenarioOf(conversation)
  const scenarioTerms = scenarioVocabulary(conversation.lessonId)

  return {
    level: clampLevel(profile.cefr),
    goal: profile.goal ?? '',
    style: getSettings().correctionStyle,
    errors: errorHints(profileId, 6),
    vocabulary:
      lesson && lesson.vocabulary.length > 0
        ? lesson.vocabulary
        : scenarioTerms.length > 0
          ? scenarioTerms
          : recentVocabulary(profileId),
    summary: conversation.summary,
    lesson: lesson ? { title: lesson.title, objective: lesson.objective, grammar: lesson.grammar } : null,
    topic: conversation.topic,
    scenario,
    locale: localeFor(profile)
  }
}

/**
 * V3: contexto + janela de histórico para a CHAMADA AO VIVO. A sessão live não
 * roda no pipeline de texto (`sendTurn`) — ela fala e ouve — mas precisa das
 * MESMAS informações: nível, objetivo, tags do caderno, persona de cenário e
 * idioma das explicações. O `window` alimenta a reinjeção de histórico quando o
 * motor não tem retomada nativa (e nos testes, quando o fake nunca teve sessão).
 */
export function liveContextFor(
  profileId: number,
  conversationId: number
): { context: TutorContext; window: ChatMessage[] } {
  const conversation = conversationOf(profileId, conversationId)
  if (!conversation) throw new Error('Conversa não encontrada.')

  const rows = messagesOf(conversation.id).filter((row) => row.content.trim().length > 0)
  const slice = rows.length > LIVE_WINDOW ? rows.slice(rows.length - LIVE_WINDOW) : rows

  return {
    context: buildContext(profileId, conversation),
    window: slice.map((row) => ({
      role: row.role === 'user' ? 'user' : 'assistant',
      content: row.content
    }))
  }
}

/** Vocabulário-alvo da trilha: o personagem deve usá-lo, e o aluno precisa dele. */
function scenarioVocabulary(lessonId: number | null): { term: string; translation: string }[] {
  if (lessonId == null) return []

  const row = getDb()
    .select()
    .from(schema.lessons)
    .where(eq(schema.lessons.id, lessonId))
    .get()

  if (!row) return []

  const context = trackContextOf(row)
  if (!context) return []

  return context.vocabulary.slice(0, 8).map((term) => ({ term, translation: term }))
}

function streamReply(
  context: TutorContext,
  turn: ChatMessage[],
  signal: AbortSignal | null,
  onToken?: (token: string) => void
): Promise<string> {
  const model = currentModel()
  if (!model) {
    return Promise.reject(new Error(runtimeText(context.locale.native.code, 'error.noModelStream')))
  }

  // M6 (C2/C3): stream monitorado — conta no aiInFlight (a pré-geração espera
  // quem conversa) e morre no deadline se o provedo emudecer no meio.
  return trackedStream(
    {
      model,
      messages: [{ role: 'system', content: tutorSystem(context) }, ...turn],
      temperature: 0.7,
      ...(signal ? { signal } : {})
    },
    (token) => onToken?.(token)
  )
}

/** Monta a janela rolante: resumo (se houver) + últimas `WINDOW` mensagens. */
function buildWindow(conversation: ConversationRow, pending: string, corrections: Correction[]): ChatMessage[] {
  const rows = messagesOf(conversation.id).filter((row) => row.content.trim().length > 0)
  const slice = rows.length > WINDOW ? rows.slice(rows.length - WINDOW) : rows

  const messages: ChatMessage[] = slice.map((row) => ({
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content
  }))

  if (conversation.summary) {
    messages.unshift({ role: 'system', content: `Resumo da conversa até aqui: ${conversation.summary}` })
  }

  if (corrections.length > 0) {
    messages.push({
      role: 'system',
      content: `Correções da mensagem que o aluno vai enviar: ${corrections
        .map((correction) => `"${correction.original}" → "${correction.corrected}" (${correction.tag})`)
        .join('; ')}. Refaça a frase dele naturalmente na sua resposta; não repita a lista.`
    })
  }

  messages.push({ role: 'user', content: pending })
  return messages
}

export function listConversations(profileId: number): ConversationSummary[] {
  return getDb()
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.profileId, profileId))
    .orderBy(desc(schema.conversations.lastMessageAt), desc(schema.conversations.id))
    .limit(30)
    .all()
    .map(toSummary)
}

export function openConversationView(profileId: number, conversationId: number): ConversationView {
  const row = conversationOf(profileId, conversationId)
  if (!row) throw new Error('Conversa não encontrada.')

  return {
    conversation: toSummary(row),
    messages: messagesOf(conversationId).map(toMessage),
    summary: row.summary,
    scenario: scenarioViewOf(row)
  }
}

/** Última conversa aberta com conteúdo — o "continuar de onde parei" do chat. */
export function latestConversation(profileId: number): ConversationSummary | null {
  const row = getDb()
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.profileId, profileId), isNull(schema.conversations.closedAt)))
    .orderBy(desc(schema.conversations.lastMessageAt), desc(schema.conversations.id))
    .limit(1)
    .get()

  if (!row) return null
  const summary = toSummary(row)
  return summary.messageCount > 0 ? summary : null
}

/** Cria conversa e deixa o tutor puxar assunto (1ª mensagem). */
export async function createConversation(
  profileId: number,
  input: { topic?: string | null; lessonId?: number | null; mode?: ConversationMode } = {}
): Promise<ConversationView> {
  const now = Date.now()
  // V2 (D2): amarrar a conversa a uma lição exige que a lição seja do perfil.
  const lessonId = input.lessonId ?? null
  if (lessonId != null && !lessonForProfile(lessonId, profileId)) {
    throw new Error('Lição não encontrada.')
  }

  const created = getDb()
    .insert(schema.conversations)
    .values({
      profileId,
      lessonId,
      mode: input.mode ?? 'free',
      topic: input.topic?.trim() || null,
      summary: null,
      createdAt: now,
      lastMessageAt: now
    })
    .returning()
    .get()

  getDb()
    .insert(schema.studySessions)
    .values({ profileId, kind: 'conversation', startedAt: now, summary: JSON.stringify({ conversationId: created.id }) })
    .run()

  const context = buildContext(profileId, created)

  try {
    const opener = await streamReply(context, [{ role: 'user', content: tutorOpenerMessage(context) }], null)
    if (opener.trim()) {
      getDb()
        .insert(schema.messages)
        .values({
          conversationId: created.id,
          role: 'assistant',
          content: opener.trim(),
          corrections: null,
          createdAt: Date.now()
        })
        .run()
      touch(created.id)
    }
  } catch (error) {
    console.warn('[tutor] abridor de conversa indisponível:', errorMessage(error))
  }

  return openConversationView(profileId, created.id)
}

/**
 * Um turno completo. `emit` publica eventos no canal `chat:event`:
 * status → corrections (inline) → tokens → done.
 */
export async function sendTurn(
  profileId: number,
  input: { requestId: string; conversationId: number; text: string },
  emit: (event: ChatEvent) => void
): Promise<{ ok: boolean; error?: string }> {
  const text = input.text.trim()
  const conversation = conversationOf(profileId, input.conversationId)

  const native = profileOf(profileId).nativeLang
  if (!conversation) return { ok: false, error: runtimeText(native, 'conversation.notFound') }
  if (!text) return { ok: false, error: runtimeText(native, 'chat.emptyMessage') }
  if (!currentModel()) {
    return { ok: false, error: runtimeText(native, 'error.noModelStream') }
  }

  const controller = new AbortController()
  activeRequests.set(input.requestId, {
    controller,
    profileId,
    conversationId: input.conversationId
  })
  // M6 (E4): todo evento do turno nasce carimbado com a conversa — o canal é
  // global e a troca de conversa no meio do turno não pode despejar eventos aqui.
  const send = (event: ChatEvent): void => emit({ ...event, conversationId: input.conversationId })

  try {
    const profile = profileOf(profileId)
    const level = clampLevel(profile.cefr)
    const hints = errorHints(profileId, 6)
    const locale = localeFor(profile)

    // 1. Correção determinística pelo banco do par (se existir); depois a passada de IA.
    send({ requestId: input.requestId, type: 'status', message: 'corrigindo' })
    const deterministic = bankCorrections(text, interferenceRulesForProfile(profileId))
    const { model: modelCorrections, recast: aiRecast } = await correctWithModel(text, level, hints, locale)

    const corrections = mergeCorrections(deterministic, modelCorrections)
    const recast = aiRecast || bankRecast(text, interferenceRulesForProfile(profileId))

    // 2. Caderno de erros + correções inline para o renderer.
    recordCorrections(profileId, corrections, {
      category: 'conversation',
      context: conversation.topic ?? lessonTitleOf(conversation.lessonId) ?? 'conversa livre'
    })
    send({ requestId: input.requestId, type: 'corrections', corrections, recast })

    getDb()
      .insert(schema.messages)
      .values({
        conversationId: conversation.id,
        role: 'user',
        content: text,
        corrections: corrections.length > 0 ? JSON.stringify(corrections) : null,
        createdAt: Date.now()
      })
      .run()

    // 3. Resposta do tutor em streaming.
    const context = buildContext(profileId, conversation)
    const turn = buildWindow(conversation, text, corrections)
    const reply = await streamTutorWithTokens(context, turn, controller.signal, send, input.requestId)

    if (!reply.trim()) {
      throw new Error(runtimeText(profile.nativeLang, 'error.emptyReply'))
    }

    getDb()
      .insert(schema.messages)
      .values({
        conversationId: conversation.id,
        role: 'assistant',
        content: reply,
        corrections: null,
        createdAt: Date.now()
      })
      .run()

    touch(conversation.id)
    blendWriting(profileId, corrections, text)
    void maybeSummarize(profileId, conversation.id)

    send({ requestId: input.requestId, type: 'done', text: reply })
    return { ok: true }
  } catch (error) {
    if (controller.signal.aborted) {
      send({ requestId: input.requestId, type: 'cancelled' })
      return { ok: false }
    }
    const message = errorMessage(error)
    send({ requestId: input.requestId, type: 'error', message })
    return { ok: false, error: message }
  } finally {
    activeRequests.delete(input.requestId)
  }
}

async function streamTutorWithTokens(
  context: TutorContext,
  turn: ChatMessage[],
  signal: AbortSignal,
  send: (event: ChatEvent) => void,
  requestId: string
): Promise<string> {
  send({ requestId, type: 'status', message: 'respondendo' })
  return streamReply(context, turn, signal, (token) => send({ requestId, type: 'token', token }))
}

async function correctWithModel(
  text: string,
  level: CefrLevel,
  hints: ErrorHint[],
  locale: PromptLocale
): Promise<{ model: Correction[]; recast: string }> {
  try {
    const prompt = correctionPrompt({ text, level, style: getSettings().correctionStyle, errors: hints, locale })
    const graded = await generateStructured(correctionSetSchema, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      // V2: a passada de correção roda no modelo rápido (papel `quick`).
      role: 'quick'
    })

    return {
      model: graded.corrections.map((item) => ({
        original: item.original,
        corrected: item.corrected,
        tag: item.tag,
        note: item.note || undefined,
        source: 'ai' as const
      })),
      recast: graded.recast.trim()
    }
  } catch (error) {
    // Modelo fraco/indisponível: com banco manual para o par, ele continua
    // corrigindo sozinho; sem banco, o turno segue só com o recast do texto.
    console.warn('[tutor] correção por IA indisponível:', errorMessage(error))
    return { model: [], recast: '' }
  }
}

export function cancelTurn(requestId: string): void {
  activeRequests.get(requestId)?.controller.abort()
  activeRequests.delete(requestId)
}

/**
 * V2: trocar de perfil derruba os turnos em andamento **dos outros** perfis.
 * Sem isto, um stream do perfil A continuaria gravando mensagens e queimando
 * tokens enquanto a tela já mostra o perfil B.
 */
export function cancelTurnsExceptProfile(profileId: number): number {
  const doomed = [...activeRequests.entries()].filter(([, turn]) => turn.profileId !== profileId)
  for (const [requestId] of doomed) {
    activeRequests.get(requestId)?.controller.abort()
    activeRequests.delete(requestId)
  }
  return doomed.length
}

/** Resumo rolante: compacta o começo da conversa quando a janela enche. */
async function maybeSummarize(profileId: number, conversationId: number): Promise<void> {
  const conversation = conversationOf(profileId, conversationId)
  if (!conversation) return

  const rows = messagesOf(conversationId)
  if (rows.length <= WINDOW + 4) return

  const transcript = rows
    .slice(0, rows.length - WINDOW)
    .map((row) => `${row.role === 'user' ? 'aluno' : 'tutor'}: ${row.content.slice(0, 200)}`)
    .join('\n')

  try {
    const profile = profileOf(profileId)
    const prompt = summaryPrompt({
      current: conversation.summary,
      transcript,
      locale: localeFor(profile)
    })
    const result = await generateStructured(conversationSummarySchema, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.3,
      role: 'quick'
    })

    getDb()
      .update(schema.conversations)
      .set({ summary: result.summary })
      .where(eq(schema.conversations.id, conversationId))
      .run()
  } catch (error) {
    console.warn('[tutor] resumo automático indisponível:', errorMessage(error))
    const tags = tagsOf(rows.flatMap((row) => parseCorrections(row.corrections)))
    const fallback = [
      `Conversa${conversation.topic ? ` sobre ${conversation.topic}` : ''} com ${rows.length} mensagens.`,
      tags.length > 0 ? `Erros que apareceram: ${tags.join(', ')}.` : 'Sem correções registradas.'
    ].join(' ')

    getDb()
      .update(schema.conversations)
      .set({ summary: fallback })
      .where(eq(schema.conversations.id, conversationId))
      .run()
  }
}

/** Escrever sem erros sobe a estimativa de writing; densidade de correção derruba. */
function blendWriting(profileId: number, corrections: Correction[], text: string): void {
  const words = text.split(/\s+/).filter(Boolean).length
  if (words < 4) return

  const sample = Math.max(0, Math.min(5, 5 - corrections.length * 0.9 + Math.min(1, words / 40)))
  const db = getDb()
  const existing = db
    .select()
    .from(schema.skillsState)
    .where(and(eq(schema.skillsState.profileId, profileId), eq(schema.skillsState.skill, 'writing')))
    .get()

  const estimate = existing ? existing.estimate * 0.82 + sample * 0.18 : sample
  const confidence = Math.min(1, (existing?.confidence ?? 0) + 0.07)

  db.insert(schema.skillsState)
    .values({ profileId, skill: 'writing', estimate, confidence })
    .onConflictDoUpdate({
      target: [schema.skillsState.profileId, schema.skillsState.skill],
      set: { estimate, confidence }
    })
    .run()
}

function skillEstimates(profileId: number): { skill: SkillId; estimate: number; confidence: number }[] {
  return getDb()
    .select()
    .from(schema.skillsState)
    .where(eq(schema.skillsState.profileId, profileId))
    .all()
    .map((row) => ({ skill: row.skill as SkillId, estimate: row.estimate, confidence: row.confidence }))
}

/**
 * Reestimativa de nível a partir das habilidades (v2/D10): média ponderada por
 * confiança, mínimo de habilidades concordando e banda morta na fronteira — o
 * nível não pode mais ficar alternando a cada lição. Persiste no perfil.
 */
export function applyReestimation(profileId: number): { from: CefrLevel; to: CefrLevel } | null {
  const profile = profileOf(profileId)
  const current = clampLevel(profile.cefr)
  const suggestion = reestimateLevel({ skills: skillEstimates(profileId), current })

  if (!suggestion || suggestion.cefr === current) return null
  if (suggestion.reason !== 'up' && suggestion.reason !== 'down') return null

  getDb()
    .update(schema.profiles)
    .set({ cefr: suggestion.cefr })
    .where(eq(schema.profiles.id, profileId))
    .run()

  console.info(
    `[adapt] nível ${current} → ${suggestion.cefr} (média ${suggestion.average.toFixed(2)}, confiança ${suggestion.confidence.toFixed(2)})`
  )

  return { from: current, to: suggestion.cefr }
}

/** Fechamento: recapitulação de correções → cards novos + tags no caderno. */
export function buildRecap(
  profileId: number,
  corrections: Correction[],
  extra: { reviewDone?: number; practice?: { correct: number; total: number }; scenario?: ScenarioFeedbackView | null } = {}
): RecapView {
  const tags = tagsOf(corrections)
  const cardsCreated = cardsForErrorsFrom(
    profileId,
    corrections.slice(0, 5).map((correction) => ({
      original: correction.original,
      corrected: correction.corrected,
      tag: correction.tag,
      note: correction.note ?? null
    }))
  )

  const levelChange = applyReestimation(profileId)

  return {
    corrections,
    tags,
    cardsCreated,
    reviewDone: extra.reviewDone,
    practice: extra.practice,
    levelChange,
    scenario: extra.scenario ?? null,
    message: recapMessage(
      corrections,
      cardsCreated,
      levelChange,
      extra.scenario ?? null,
      nativeLangFor(profileId)
    )
  }
}

function recapMessage(
  corrections: Correction[],
  cardsCreated: number,
  levelChange: { from: CefrLevel; to: CefrLevel } | null,
  scenario: ScenarioFeedbackView | null = null,
  lang: string | null = 'pt-BR'
): string {
  const tags = tagsOf(corrections)
  const parts = [
    corrections.length === 0
      ? runtimeText(lang, 'recap.noCorrections')
      : `${runtimeText(lang, 'recap.corrections', { count: corrections.length })}${
          tags.length > 0 ? runtimeText(lang, 'recap.areas', { tags: tags.join(', ') }) : ''
        }.`,
    scenario
      ? runtimeText(lang, 'recap.scenario', {
          content: Math.round(scenario.contentScore * 100),
          language: Math.round(scenario.languageScore * 100)
        })
      : null,
    cardsCreated > 0 ? runtimeText(lang, 'recap.cards', { count: cardsCreated }) : null,
    levelChange ? runtimeText(lang, 'recap.level', { from: levelChange.from, to: levelChange.to }) : null
  ]

  return parts.filter(Boolean).join(' ')
}

/** Extras que uma sessão guiada/cenário injeta na recapitulação do fechamento. */
export interface RecapExtras {
  reviewDone?: number
  practice?: { correct: number; total: number }
  scenario?: ScenarioFeedbackView | null
}

/**
 * Fechamento da conversa: recapitulação → cards + tags no caderno.
 *
 * M6 (B2): o fechamento é **idempotente e escopado**. Quem chega depois do
 * primeiro (`closedAt` já preenchido) recebe a recapitulação calculada sem
 * reestimativa e sem recriar cards — uma abertura gera um recap, não dois. E o
 * encerramento de `study_sessions` filtra pelo `conversationId` gravado no
 * resumo de abertura: fechar a conversa A não toca mais nas sessões de B.
 */
export function closeConversation(
  profileId: number,
  conversationId: number,
  extra: RecapExtras = {}
): RecapView {
  const db = getDb()
  // V2 (D2): valida a posse ANTES de ler as mensagens — mensagens de conversa
  // alheia não descem para outro perfil.
  const conversation = conversationOf(profileId, conversationId)
  const corrections = conversation ? messagesOf(conversationId).flatMap((row) => parseCorrections(row.corrections)) : []
  const now = Date.now()

  if (!conversation || conversation.closedAt != null) {
    // Recado do segundo fechamento (ou de outra profile): refaz a leitura, não
    // refaz o efeito (nenhuma reestimativa, nenhum card novo).
    return {
      corrections,
      tags: tagsOf(corrections),
      cardsCreated: 0,
      reviewDone: extra.reviewDone,
      practice: extra.practice,
      levelChange: null,
      scenario: extra.scenario ?? null,
      message: recapMessage(corrections, 0, null, extra.scenario ?? null, nativeLangFor(profileId))
    }
  }

  const recap = buildRecap(profileId, corrections, extra)

  // M6 (C7): fechar a conversa e encerrar a sessão de estudo dela são um passo
  // só — meio caminho deixaria sessão aberta eterna (tempo fantasma no painel).
  db.transaction((tx) => {
    tx.update(schema.conversations)
      .set({ closedAt: now })
      .where(and(eq(schema.conversations.id, conversationId), isNull(schema.conversations.closedAt)))
      .run()

    tx.update(schema.studySessions)
      .set({
        endedAt: now,
        summary: JSON.stringify({
          conversationId,
          corrections: corrections.length,
          tags: recap.tags,
          cardsCreated: recap.cardsCreated
        })
      })
      .where(
        and(
          eq(schema.studySessions.profileId, profileId),
          eq(schema.studySessions.kind, 'conversation'),
          isNull(schema.studySessions.endedAt),
          sql`json_extract(${schema.studySessions.summary}, '$.conversationId') = ${conversationId}`
        )
      )
      .run()
  })

  emitStudentEvent('conversation-closed', String(conversationId), profileId)

  return recap
}
