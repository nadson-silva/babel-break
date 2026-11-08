/**
 * V2 — voz: TTS, ASR e score de pronúncia, sobre jobs nomeados (E9).
 *
 * Três princípios deste módulo:
 *
 * 1. **Cache primeiro, como o conteúdo das lições.** A mesma frase na mesma voz
 *    é sintetizada uma vez e servida do SQLite (offline, sem token). É o mesmo
 *    argumento do M5, aplicado a áudio.
 * 2. **O score é determinístico.** O provedor transcreve; quem dá nota é
 *    `core/pronunciation.ts`. Se a transcrição estiver errada, o app mostra o
 *    que ouviu — o aluno discorda com o texto na frente, não com uma nota mágica.
 * 3. **Degradação honesta.** Provedor sem voz ≠ app quebrado: a tela diz qual
 *    metade existe (ouvir pela voz do sistema, sem score) em vez de prometer.
 *
 * Nada aqui roda no renderer sem passar pelo main: o áudio do micro chega em
 * WAV 16 kHz mono, e o segredo do provedor continua fora da ponte.
 */
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type {
  ListeningResultView,
  SpeechAudioView,
  SpeechGradeRequest,
  SpeechGradeView,
  SpeechHistoryView,
  SpeechRunView,
  VoicePhraseView,
  VoiceStatus
} from '../shared/types'
import { MAX_AUDIO_BYTES, WAV_MIME, audioCacheKey, base64FromBuffer, bufferFromBase64, encodeWav, pcmDurationMs, sampleRateFromMime, wavDurationMs } from '../core/audio'
import { scorePronunciation, weakWords } from '../core/pronunciation'
import { PROMPT_VERSION, SCHEMA_VERSION } from '../core/schemas'
import { scorePercent, skillSample, speechPassed } from '../core/score'
import { runtimeText } from '../core/runtime-text'
import { getDb, schema } from './db'
import { exerciseForProfile } from './scope'
import { activeProfileId } from './profiles'
import { nativeLangFor, profileRow } from './locale'
import { getProvider } from './providers'
import type { SpeechCapability } from './providers/types'
import { getSettings } from './settings'
import { modelForRole } from './ai'
import { JOB_DEADLINE_MS, startJob } from './jobs'
import { handle } from './ipc-contract'
import { gradeDeterministic, normalizeText } from '../core/grading'
import type { ExerciseType } from '../shared/types'

/** Teto do cache de áudio por perfil: 240 clipes (~14 MB em 16 kHz, menos em 24). */
const MAX_AUDIO_ROWS = 240

/** Payload JSON de linha: podre ou ausente vira null, nunca derruba a tela. */
function readJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/**
 * Capacidade de fala do provedor atual (`null` = Ollama, sem voz).
 *
 * `setSpeechEngineForTest` é a costura de teste: o score de pronúncia, o cache e
 * a persistência precisam ser exercitados sem rede e sem chave de API.
 */
let engineOverride: SpeechCapability | null = null
let overrideActive = false

export function setSpeechEngineForTest(engine: SpeechCapability | null): void {
  engineOverride = engine
  overrideActive = true
}

export function clearSpeechEngineOverrideForTest(): void {
  engineOverride = null
  overrideActive = false
}

function speech(): SpeechCapability | null {
  const settings = getSettings()
  if (!settings.voiceEnabled) return null
  if (overrideActive) return engineOverride
  return getProvider(settings.provider).speech ?? null
}

/** O que o provedor atual consegue fazer com voz (decisão de prompt e de UI). */
export function voiceCapabilityFlags(): { enabled: boolean; tts: boolean; asr: boolean } {
  const capability = speech()
  const settings = getSettings()
  const ttsModel = settings.ttsModel.trim() || capability?.ttsModels[0] || ''
  return {
    enabled: settings.voiceEnabled && capability != null,
    tts: capability != null && ttsModel.length > 0,
    asr: capability != null
  }
}

export function voiceStatus(profileId = activeProfileId()): VoiceStatus {
  const settings = getSettings()
  const capability = speech()
  const ttsModel = settings.ttsModel.trim() || (capability?.ttsModels[0] ?? '')
  const asrModel = settings.asrModel.trim() || modelForRole('quick')

  return {
    provider: settings.provider,
    tts: capability != null && ttsModel.length > 0,
    asr: capability != null,
    ttsModel,
    asrModel,
    voice: settings.voiceName,
    voices: capability?.voices ?? [],
    mode: capability ? 'provider' : 'none',
    detail: capability
      ? null
      : runtimeText(nativeLangFor(profileId), 'error.voiceUnavailable')
  }
}

// --- cache de áudio ---------------------------------------------------------

interface CachedAudio {
  mime: string
  bytes: Buffer
  durationMs: number
}

function lookupAudio(key: string): CachedAudio | null {
  const row = getDb()
    .select()
    .from(schema.audioCache)
    .where(eq(schema.audioCache.key, key))
    .get()

  if (!row) return null
  if (row.schemaVersion !== SCHEMA_VERSION) {
    // Formato de áudio de outra versão do app: descartado, não remendado (D1).
    getDb().delete(schema.audioCache).where(eq(schema.audioCache.key, key)).run()
    return null
  }

  getDb()
    .update(schema.audioCache)
    .set({ hits: (row.hits ?? 0) + 1, lastUsedAt: Date.now() })
    .where(eq(schema.audioCache.key, key))
    .run()

  return { mime: row.mime, bytes: Buffer.from(row.bytes), durationMs: row.durationMs ?? wavDurationMs(row.bytes) }
}

function storeAudio(input: { key: string; profileId: number; text: string; lang: string; voice: string; model: string; bytes: Buffer; durationMs: number }): void {
  const db = getDb()
  const now = Date.now()

  db.insert(schema.audioCache)
    .values({
      key: input.key,
      profileId: input.profileId,
      kind: 'tts',
      text: input.text,
      lang: input.lang,
      voice: input.voice,
      model: input.model,
      mime: WAV_MIME,
      bytes: input.bytes,
      durationMs: input.durationMs,
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      lastUsedAt: now,
      hits: 0
    })
    .onConflictDoNothing()
    .run()

  // O cache não pode virar um peso morto no banco: sai o que foi menos usado.
  const total = Number(
    db
      .select({ value: sql<number>`count(*)` })
      .from(schema.audioCache)
      .where(eq(schema.audioCache.profileId, input.profileId))
      .get()?.value ?? 0
  )
  if (total <= MAX_AUDIO_ROWS) return

  const victims = db
    .select({ key: schema.audioCache.key })
    .from(schema.audioCache)
    .where(eq(schema.audioCache.profileId, input.profileId))
    .orderBy(sql`${schema.audioCache.hits} asc`, desc(schema.audioCache.lastUsedAt))
    .limit(total - MAX_AUDIO_ROWS)
    .all()

  if (victims.length === 0) return
  db.delete(schema.audioCache)
    .where(sql`${schema.audioCache.key} in (${sql.join(victims.map((v) => sql`${v.key}`), sql`, `)})`)
    .run()
}

/** Transforma o que o provedor devolve (PCM cru ou WAV/OGG) em WAV tocável. */
function toPlayableWav(mimeType: string, data: Buffer): { bytes: Buffer; durationMs: number } {
  const lower = mimeType.toLowerCase()

  if (lower.startsWith('audio/wav')) {
    return { bytes: data, durationMs: wavDurationMs(data) }
  }

  const rate = sampleRateFromMime(lower) ?? 24_000
  const bytes = encodeWav(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), rate)
  return { bytes, durationMs: pcmDurationMs(data.length, rate) }
}

// --- TTS --------------------------------------------------------------------

export interface SpeakInput {
  text: string
  /** Idiom-alvo do perfil quando omitido. */
  lang?: string
  /** Id da job-event para o renderer casar com a tela. */
  requestId?: string
}

/**
 * Sintetiza (ou reaproveita do cache) o áudio de uma frase. Roda como job:
 * a UI mostra "gerando áudio…" com progresso e pode cancelar.
 */
export async function speakText(input: SpeakInput, profileId = activeProfileId()): Promise<SpeechAudioView> {
  const text = input.text.trim()
  if (!text) return { ok: false, dataUrl: null, mime: null, durationMs: 0, source: 'none', error: 'empty' }

  const capability = speech()
  if (!capability) {
    return {
      ok: false,
      dataUrl: null,
      mime: null,
      durationMs: 0,
      source: 'none',
      error: runtimeText(nativeLangFor(profileId), 'error.voiceUnavailable')
    }
  }

  const settings = getSettings()
  const profile = profileRow(profileId)
  if (!profile) throw new Error('Perfil não encontrado.')
  const lang = (input.lang ?? profile.targetLang).trim()
  const model = settings.ttsModel.trim() || capability.ttsModels[0] || ''
  const voice = settings.voiceName || capability.defaultVoice

  const key = audioCacheKey({ lang, voice, model, text, schemaVersion: SCHEMA_VERSION })

  return startJob({
    kind: 'voice:tts',
    profileId,
    label: runtimeText(nativeLangFor(profileId), 'voice.label.tts'),
    requestId: input.requestId,
    deadlineMs: JOB_DEADLINE_MS,
    run: async (job) => {
      job.progress(0.1)

      const cached = lookupAudio(key)
      if (cached) {
        job.progress(1)
        return {
          ok: true,
          dataUrl: `data:${cached.mime};base64,${base64FromBuffer(cached.bytes)}`,
          mime: cached.mime,
          durationMs: cached.durationMs,
          source: 'cache' as const
        }
      }

      job.progress(0.4)
      const result = await capability.speak({
        model,
        voice,
        text,
        lang,
        rate: settings.speechRate,
        signal: job.signal
      })
      const playable = toPlayableWav(result.mimeType, result.data)

      if (playable.bytes.length === 0 || playable.bytes.length > MAX_AUDIO_BYTES) {
        return {
          ok: false,
          dataUrl: null,
          mime: null,
          durationMs: 0,
          source: 'none',
          error: runtimeText(profile.nativeLang, 'voice.empty')
        }
      }

      storeAudio({
        key,
        profileId,
        text,
        lang,
        voice,
        model,
        bytes: playable.bytes,
        durationMs: playable.durationMs
      })
      job.progress(1)

      return {
        ok: true,
        dataUrl: `data:${WAV_MIME};base64,${base64FromBuffer(playable.bytes)}`,
        mime: WAV_MIME,
        durationMs: playable.durationMs,
        source: 'provider' as const
      }
    }
  })
}

// --- ASR + score ------------------------------------------------------------

export type GradeSpeechInput = SpeechGradeRequest

/**
 * Uma fala do aluno vira nota: transcreve (provedor), alinha com a frase-alvo
 * (`core/pronunciation.ts`), grava em `speech_runs` e mexe na habilidade de
 * `speaking`. Se veio de um exercício, a tentativa também entra em `attempts` —
 * é assim que a lição fecha a conta com voz dentro.
 */
export async function gradeSpeech(input: GradeSpeechInput, profileId = activeProfileId()): Promise<SpeechGradeView> {
  const profile = profileRow(profileId)
  if (!profile) throw new Error('Perfil não encontrado.')

  const capability = speech()
  const target = input.target.trim()
  const startedAt = Date.now()
  const native = profile.nativeLang

  const typed = input.typedAnswer?.trim() ?? ''

  if (!capability) {
    return emptyGrade(profileId, input, target, runtimeText(native, 'error.voiceUnavailable'), startedAt)
  }

  return startJob({
    kind: 'voice:grade',
    profileId,
    label: runtimeText(native, 'voice.label.asr'),
    requestId: input.requestId,
    run: async (job) => {
      job.progress(0.15)

      let transcript: string | null = typed || null

      if (!transcript) {
        const audio = bufferFromBase64(input.audio)
        if (!audio) {
          return finishGrade({
            profileId,
            input,
            target,
            native,
            transcript: null,
            job,
            startedAt
          })
        }

        const settings = getSettings()
        const model = settings.asrModel.trim() || modelForRole('quick')
        job.progress(0.5, runtimeText(native, 'voice.label.asr'))

        transcript = await capability.transcribe({
          model,
          audio,
          mimeType: input.mime || WAV_MIME,
          lang: profile.targetLang,
          hint: target,
          signal: job.signal
        })
      }

      job.progress(0.85, runtimeText(native, 'voice.label.score'))
      return finishGrade({ profileId, input, target, native, transcript, job, startedAt })
    }
  })
}

interface FinishGradeInput {
  profileId: number
  input: GradeSpeechInput
  target: string
  native: string
  transcript: string | null
  job: { progress: (value: number | null, message?: string) => void }
  startedAt: number
}

/** Alinha, pontua e persiste. Separado para o caminho "sem áudio" cair aqui também. */
async function finishGrade(args: FinishGradeInput): Promise<SpeechGradeView> {
  const { profileId, input, target, native, transcript, startedAt } = args
  const profile = profileRow(profileId)
  if (!profile) throw new Error('Perfil não encontrado.')

  const score = scorePronunciation({ target, transcript, lang: profile.targetLang })
  const summary = score.transcriptEmpty
    ? runtimeText(native, 'voice.summary.noAudio')
    : [
        runtimeText(native, 'voice.summary.score', { score: scorePercent(score.score) }),
        transcript ? runtimeText(native, 'voice.summary.heard', { transcript }) : ''
      ]
        .filter(Boolean)
        .join(' ')

  const passed = speechPassed(score.score)
  const skill: 'speaking' | 'listening' = input.kind === 'listen' ? 'listening' : 'speaking'

  const run = getDb()
    .insert(schema.speechRuns)
    .values({
      profileId,
      lessonId: input.lessonId ?? null,
      exerciseId: input.exerciseId ?? null,
      kind: input.kind,
      target,
      transcript: transcript ?? null,
      score: score.score,
      skill,
      metrics: JSON.stringify({
        ...score,
        promptVersion: PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION
      }),
      source: 'provider',
      model: getSettings().asrModel.trim() || modelForRole('quick'),
      latencyMs: Date.now() - startedAt,
      createdAt: Date.now()
    })
    .returning()
    .get()

  // Exercício de voz: a tentativa entra na conta da lição (mesma escala do resto).
  // V2 (D2): só se o exercício for deste perfil — id alheio não escreve ali.
  if (input.exerciseId != null) {
    const exercise = exerciseForProfile(input.exerciseId, profileId)

    if (exercise) {
      getDb()
        .insert(schema.attempts)
        .values({
          exerciseId: exercise.id,
          response: transcript ?? '',
          correct: passed,
          score: score.score,
          latencyMs: Date.now() - startedAt,
          createdAt: Date.now()
        })
        .run()
    }
  }

  blendSpeech(profileId, skill, score.score, score.confidence)

  args.job.progress(1)

  return {
    runId: run.id,
    kind: input.kind,
    target,
    transcript: transcript ?? null,
    score: score.score,
    accuracy: score.accuracy,
    precision: score.precision,
    confidence: score.confidence,
    words: score.words,
    extraWords: score.extraWords,
    transcriptEmpty: score.transcriptEmpty,
    tags: score.tags,
    summary,
    source: 'provider',
    asrModel: getSettings().asrModel.trim() || modelForRole('quick'),
    latencyMs: Date.now() - startedAt,
    skill,
    passed
  }
}

function emptyGrade(
  profileId: number,
  input: GradeSpeechInput,
  target: string,
  reason: string,
  startedAt: number
): SpeechGradeView {
  const skill: 'speaking' | 'listening' = input.kind === 'listen' ? 'listening' : 'speaking'
  const run = getDb()
    .insert(schema.speechRuns)
    .values({
      profileId,
      lessonId: input.lessonId ?? null,
      exerciseId: input.exerciseId ?? null,
      kind: input.kind,
      target,
      transcript: null,
      score: 0,
      skill,
      metrics: JSON.stringify({ reason, schemaVersion: SCHEMA_VERSION }),
      source: 'none',
      latencyMs: Date.now() - startedAt,
      createdAt: Date.now()
    })
    .returning()
    .get()

  return {
    runId: run.id,
    kind: input.kind,
    target,
    transcript: null,
    score: 0,
    accuracy: 0,
    precision: 0,
    confidence: 0,
    words: [],
    extraWords: 0,
    transcriptEmpty: true,
    tags: ['no-audio'],
    summary: reason,
    source: 'none',
    asrModel: null,
    latencyMs: Date.now() - startedAt,
    skill,
    passed: false
  }
}

/**
 * `speaking`/`listening` deixando de ser linhas mortas: a amostra entra na mesma
 * escala 0–5 e com confiança proporcional ao que a fala informa (frase de duas
 * palavras não sustenta conclusão).
 */
function blendSpeech(profileId: number, skill: 'speaking' | 'listening', score: number, confidence: number): void {
  const db = getDb()
  const sample = skillSample(score)
  const existing = db
    .select()
    .from(schema.skillsState)
    .where(and(eq(schema.skillsState.profileId, profileId), eq(schema.skillsState.skill, skill)))
    .get()

  // Confiança do próprio score, não um incremento fixo: 5 falas curtas não valem
  // uma frase longa bem dita.
  const gained = Math.min(0.25, 0.08 + confidence * 0.17)
  const estimate = existing ? existing.estimate * 0.78 + sample * 0.22 : sample
  const nextConfidence = Math.min(1, (existing?.confidence ?? 0) + gained)

  db.insert(schema.skillsState)
    .values({ profileId, skill, estimate, confidence: nextConfidence })
    .onConflictDoUpdate({
      target: [schema.skillsState.profileId, schema.skillsState.skill],
      set: { estimate, confidence: nextConfidence }
    })
    .run()
}

/** Compreensão auditiva sem microfone: o aluno ouviu e respondeu por texto. */
export function recordListening(
  input: { exerciseId: number; response: string; target: string; lessonId?: number | null; correct?: boolean; latencyMs?: number },
  profileId = activeProfileId()
): ListeningResultView {
  const db = getDb()
  const profile = profileRow(profileId)
  if (!profile) throw new Error('Perfil não encontrado.')

  const exercise = exerciseForProfile(input.exerciseId, profileId)
  if (!exercise || exercise.blocked) throw new Error('Exercício não encontrado.')

  const answerKey = JSON.parse(exercise.answerKey || '{}') as { answer?: string; alternatives?: string[] }
  const deterministic = gradeDeterministic(
    exercise.type as ExerciseType,
    { answer: answerKey.answer ?? '', alternatives: answerKey.alternatives ?? [] },
    input.response,
    profile.nativeLang,
    profile.targetLang
  )

  const correct = input.correct ?? deterministic?.correct ?? normalizeText(input.response, profile.targetLang) === normalizeText(answerKey.answer ?? '', profile.targetLang)
  const score = deterministic?.score ?? (correct ? 1 : 0)

  db.insert(schema.attempts)
    .values({
      exerciseId: exercise.id,
      response: input.response,
      correct,
      score,
      latencyMs: input.latencyMs ?? null,
      createdAt: Date.now()
    })
    .run()

  const run = db
    .insert(schema.speechRuns)
    .values({
      profileId,
      lessonId: input.lessonId ?? exercise.lessonId,
      exerciseId: exercise.id,
      kind: 'listen',
      target: input.target || (JSON.parse(exercise.payload || '{}') as { prompt?: string }).prompt || '',
      transcript: input.response,
      score,
      skill: 'listening',
      metrics: JSON.stringify({ via: 'typed', schemaVersion: SCHEMA_VERSION }),
      source: 'provider',
      createdAt: Date.now()
    })
    .returning()
    .get()

  blendSpeech(profileId, 'listening', score, 0.75)

  return {
    ok: true,
    correct,
    score,
    runId: run.id,
    feedback: deterministic?.feedback ?? runtimeText(profile.nativeLang, correct ? 'grade.correct' : 'grade.compare')
  }
}

/**
 * Entrada de voz sem nota: o aluno dita no chat do tutor e o texto vai para o
 * composer, onde ele ainda pode mexer antes de enviar. Não pontua, não grava
 * `speech_runs` — é transcrição, não avaliação.
 */
export async function dictate(input: { mime: string; audio: string; requestId?: string }, profileId = activeProfileId()): Promise<{ ok: boolean; text: string; error?: string }> {
  const profile = profileRow(profileId)
  if (!profile) throw new Error('Perfil não encontrado.')

  const capability = speech()
  if (!capability) {
    return { ok: false, text: '', error: runtimeText(profile.nativeLang, 'error.voiceUnavailable') }
  }

  const settings = getSettings()
  return startJob({
    kind: 'voice:asr',
    profileId,
    label: runtimeText(profile.nativeLang, 'voice.label.asr'),
    requestId: input.requestId,
    run: async (job) => {
      const audio = bufferFromBase64(input.audio)
      if (!audio) return { ok: false, text: '', error: runtimeText(profile.nativeLang, 'voice.empty') }

      job.progress(0.4)
      const text = await capability.transcribe({
        model: settings.asrModel.trim() || modelForRole('quick'),
        audio,
        mimeType: input.mime || WAV_MIME,
        lang: profile.targetLang,
        signal: job.signal
      })
      job.progress(1)
      return { ok: text.trim().length > 0, text: text.trim() }
    }
  })
}

/** Histórico de voz do perfil + médias por habilidade. */
export function speechHistory(profileId = activeProfileId(), limit = 20): SpeechHistoryView {
  const db = getDb()

  const rows = db
    .select({
      run: schema.speechRuns,
      lessonTitle: schema.lessons.title
    })
    .from(schema.speechRuns)
    .leftJoin(schema.lessons, eq(schema.lessons.id, schema.speechRuns.lessonId))
    .where(eq(schema.speechRuns.profileId, profileId))
    .orderBy(desc(schema.speechRuns.id))
    .limit(Math.max(1, Math.min(100, limit)))
    .all()

  const runs: SpeechRunView[] = rows.map((row) => ({
    id: row.run.id,
    kind: row.run.kind as SpeechRunView['kind'],
    target: row.run.target,
    transcript: row.run.transcript,
    score: row.run.score,
    skill: row.run.skill as SpeechRunView['skill'],
    lessonId: row.run.lessonId,
    lessonTitle: row.run.lessonId ? (row.lessonTitle ?? null) : null,
    createdAt: row.run.createdAt,
    source: row.run.source
  }))

  const average = (skill: 'speaking' | 'listening'): number | null => {
    const row = db
      .select({ value: sql<number>`avg(${schema.speechRuns.score})` })
      .from(schema.speechRuns)
      .where(and(eq(schema.speechRuns.profileId, profileId), eq(schema.speechRuns.skill, skill), sql`${schema.speechRuns.score} is not null`))
      .get()
    const value = row?.value
    return value == null ? null : Number(value)
  }

  const total = Number(
    db
      .select({ value: sql<number>`count(*)` })
      .from(schema.speechRuns)
      .where(and(eq(schema.speechRuns.profileId, profileId), or(isNull(schema.speechRuns.score), gt(schema.speechRuns.score, 0))))
      .get()?.value ?? 0
  )

  return {
    runs,
    speakingAverage: average('speaking'),
    listeningAverage: average('listening'),
    total
  }
}

/** Palavras que o aluno não conseguiu dizer — entrada do drill de follow-up. */
export function speechWeakWords(runId: number, profileId = activeProfileId()): string[] {
  const row = getDb()
    .select({ metrics: schema.speechRuns.metrics, profileId: schema.speechRuns.profileId })
    .from(schema.speechRuns)
    .where(eq(schema.speechRuns.id, runId))
    .get()

  if (!row || row.profileId !== profileId || !row.metrics) return []
  try {
    const parsed = JSON.parse(row.metrics) as { words?: { text: string; status: string }[] }
    const words = (parsed.words ?? []).filter((word) => word.status === 'near' || word.status === 'wrong' || word.status === 'missing')
    return weakWords({
      score: 0,
      accuracy: 0,
      precision: 0,
      extraWords: 0,
      targetWords: words.length,
      words: words.map((word) => ({ text: word.text, status: word.status as 'near' | 'wrong' | 'missing' })),
      transcriptEmpty: false,
      confidence: 0,
      tags: []
    }).map((word) => word.text)
  } catch {
    return []
  }
}

/**
 * Frases para a prática de voz do perfil: o vocabulário das lições que ele abriu
 * por último (com a frase de exemplo, não a palavra solta) mais as frases certas
 * do caderno de erros. É a mesma memória do resto do app, falada.
 */
export function voicePhrases(profileId = activeProfileId(), limit = 12): VoicePhraseView[] {
  const db = getDb()

  const fromLessons = db
    .select({
      payload: schema.lessonItems.payload,
      lessonTitle: schema.lessons.title,
      openedAt: schema.lessonProgress.lastOpenedAt
    })
    .from(schema.lessonItems)
    .innerJoin(schema.lessons, eq(schema.lessons.id, schema.lessonItems.lessonId))
    .leftJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
    .leftJoin(schema.focusTracks, eq(schema.focusTracks.id, schema.lessons.trackId))
    .leftJoin(
      schema.lessonProgress,
      and(eq(schema.lessonProgress.lessonId, schema.lessons.id), eq(schema.lessonProgress.profileId, profileId))
    )
    .where(
      and(
        eq(schema.lessonItems.kind, 'vocab'),
        sql`coalesce(${schema.lessons.profileId}, ${schema.units.profileId}, ${schema.focusTracks.profileId}) = ${profileId}`
      )
    )
    .orderBy(sql`coalesce(${schema.lessonProgress.lastOpenedAt}, 0) desc`, desc(schema.lessonItems.id))
    .limit(limit * 3)
    .all()

  const seen = new Set<string>()
  const phrases: VoicePhraseView[] = []

  for (const row of fromLessons) {
    if (phrases.length >= limit) break
    const parsed = readJson<{ term?: string; translation?: string; example?: string }>(row.payload)
    const target = (parsed?.example ?? parsed?.term ?? '').trim()
    if (!target) continue
    const key = target.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    phrases.push({
      target,
      native: (parsed?.translation ?? '').trim() || null,
      origin: row.lessonTitle,
      source: 'lesson'
    })
  }

  // Frases certas do caderno: o aluno já escreveu a forma certa — agora fala.
  const errors = db
    .select({ corrected: schema.errors.corrected, tag: schema.errors.tag })
    .from(schema.errors)
    .where(and(eq(schema.errors.profileId, profileId), isNull(schema.errors.resolvedAt)))
    .orderBy(desc(schema.errors.lastSeenAt))
    .limit(limit)
    .all()

  for (const row of errors) {
    if (phrases.length >= limit) break
    const target = row.corrected.trim()
    if (!target || seen.has(target.toLowerCase())) continue
    seen.add(target.toLowerCase())
    phrases.push({ target, native: null, origin: row.tag, source: 'error' })
  }

  return phrases
}

/** Tamanho do cache de áudio (Configurações mostra e oferece limpar). */
export function audioCacheStats(profileId = activeProfileId()): { rows: number; bytes: number; max: number } {
  const row = getDb()
    .select({
      rows: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(length(${schema.audioCache.bytes})), 0)`
    })
    .from(schema.audioCache)
    .where(eq(schema.audioCache.profileId, profileId))
    .get()

  return { rows: Number(row?.rows ?? 0), bytes: Number(row?.bytes ?? 0), max: MAX_AUDIO_ROWS }
}

export function clearAudioCache(profileId = activeProfileId()): number {
  const before = audioCacheStats(profileId).rows
  getDb().delete(schema.audioCache).where(eq(schema.audioCache.profileId, profileId)).run()
  return before
}

/** Canais de voz. Todo caminho longo é job: cancelável e com deadline. */
export function registerVoiceIpc(): void {
  handle('voice:status', () => voiceStatus())

  handle('voice:speak', (_event, input: { text: string; lang?: string; requestId?: string }) =>
    speakText(input)
  )

  handle('voice:grade', (_event, input: SpeechGradeRequest) => gradeSpeech(input))

  handle(
    'voice:listen',
    (
      _event,
      input: { exerciseId: number; response: string; target: string; lessonId?: number | null; latencyMs?: number }
    ) => recordListening(input)
  )

  handle('voice:dictate', (_event, input: { mime: string; audio: string; requestId?: string }) => dictate(input))

  handle('voice:history', (_event, limit?: number) => speechHistory(activeProfileId(), limit ?? 20))

  handle('voice:phrases', (_event, limit?: number) => voicePhrases(activeProfileId(), limit ?? 12))

  handle('voice:cache', () => audioCacheStats())

  handle('voice:clear-cache', () => clearAudioCache())
}
