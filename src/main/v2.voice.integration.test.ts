/**
 * V2 — voz, do provedor ao banco, sem rede.
 *
 * A capacidade de fala é injetada (`setSpeechEngineForTest`): o que este teste
 * prova é o que o app faz em volta dela — cache de áudio no SQLite, score
 * determinístico vindo da transcrição, `speech_runs`, tentativa no exercício,
 * `speaking`/`listening` no painel, escopo por perfil e degradação honesta quando
 * o provedor não tem voz (Ollama).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import type { SpeakRequest, SpeakResult, SpeechCapability, TranscribeRequest } from './providers/types'
import { getDb, initDatabase, schema } from './db'
import { updateSettings } from './settings'
import { completeOnboarding, generateCurriculum, curriculumView, openLesson } from './learning'
import { recordCorrections } from './notebook'
import { activeProfileId, createProfile, setActiveProfile } from './profiles'
import { resetProviderStatus } from './provider-status'
import {
  audioCacheStats,
  clearAudioCache,
  gradeSpeech,
  recordListening,
  setSpeechEngineForTest,
  speakText,
  speechHistory,
  speechWeakWords,
  voicePhrases,
  voiceStatus
} from './voice'

/** 443 bytes de PCM (uma "fala" de ~9 ms) — suficiente para virar WAV válido. */
const FAKE_PCM = Buffer.alloc(44 + 44, 0x11)

const scripted: { transcript: string; calls: TranscribeRequest[]; speakCalls: SpeakRequest[] } = {
  transcript: 'I work on the backend',
  calls: [],
  speakCalls: []
}

const fakeSpeech: SpeechCapability = {
  ttsModels: ['fake-tts'],
  asrModels: ['fake-asr'],
  voices: ['Kore'],
  defaultVoice: 'Kore',
  async speak(request: SpeakRequest): Promise<SpeakResult> {
    scripted.speakCalls.push(request)
    return { mimeType: 'audio/pcm;rate=24000', data: FAKE_PCM }
  },
  async transcribe(request: TranscribeRequest): Promise<string> {
    scripted.calls.push(request)
    return scripted.transcript
  }
}

const silentSpeech: SpeechCapability = {
  ...fakeSpeech,
  async transcribe(): Promise<string> {
    return ''
  }
}

const learner = { profileId: 0, lessonId: 0, speakExerciseId: 0, listenExerciseId: 0 }

beforeAll(async () => {
  initDatabase()
  updateSettings({
    provider: 'ollama',
    ollamaModel: '',
    ollamaBaseUrl: 'http://127.0.0.1:1',
    pregenerate: false,
    voiceEnabled: true,
    ttsModel: 'fake-tts',
    asrModel: 'fake-asr',
    voiceName: 'Kore',
    speechRate: 'normal'
  })
  resetProviderStatus()
  setSpeechEngineForTest(fakeSpeech)

  const state = completeOnboarding({ goal: 'trabalho', cefr: 'A2' })
  learner.profileId = state.profile.id
  await generateCurriculum(state.profile.id)

  const lesson = curriculumView(state.profile.id).units[0]?.lessons[0]
  if (!lesson) throw new Error('currículo vazio')
  learner.lessonId = lesson.id
  const detail = await openLesson(lesson.id, state.profile.id)
  learner.speakExerciseId = detail.exercises[0]?.id as number
  learner.listenExerciseId = detail.exercises[1]?.id as number
})

beforeEach(() => {
  scripted.calls.length = 0
  scripted.speakCalls.length = 0
})

describe('status', () => {
  it('diz o que o provedor consegue fazer (e o padrão dos modelos)', () => {
    const status = voiceStatus()
    expect(status.mode).toBe('provider')
    expect(status.tts).toBe(true)
    expect(status.asr).toBe(true)
    expect(status.ttsModel).toBe('fake-tts')
    expect(status.asrModel).toBe('fake-asr')
    expect(status.voices).toContain('Kore')
    expect(status.detail).toBeNull()
  })

  it('sem capacidade, o modo é none e a mensagem explica a degradação', () => {
    setSpeechEngineForTest(null)
    const status = voiceStatus()
    expect(status.mode).toBe('none')
    expect(status.tts).toBe(false)
    expect(status.detail).toMatch(/não tem voz/i)
    setSpeechEngineForTest(fakeSpeech)
  })
})

describe('TTS com cache', () => {
  it('sintetiza uma vez, serve do SQLite depois (sem regastar)', async () => {
    clearAudioCache(learner.profileId)
    const first = await speakText({ text: 'I work on the backend' }, learner.profileId)
    expect(first.ok).toBe(true)
    expect(first.source).toBe('provider')
    expect(first.dataUrl).toMatch(/^data:audio\/wav;base64,/)
    expect(scripted.speakCalls).toHaveLength(1)
    // WAV = 44 de cabeçalho + o PCM cru do provedor.
    expect(first.durationMs).toBeGreaterThan(0)

    const second = await speakText({ text: 'I work on the backend' }, learner.profileId)
    expect(second.source).toBe('cache')
    expect(scripted.speakCalls).toHaveLength(1)

    const stats = audioCacheStats(learner.profileId)
    expect(stats.rows).toBe(1)
    expect(stats.bytes).toBeGreaterThan(44)
  })

  it('guarda voz/idioma/modelo junto da frase (a chave do cache é o texto + voz)', async () => {
    await speakText({ text: 'distinct sentence' }, learner.profileId)
    const row = getDb()
      .select({ lang: schema.audioCache.lang, voice: schema.audioCache.voice, model: schema.audioCache.model })
      .from(schema.audioCache)
      .where(eq(schema.audioCache.text, 'distinct sentence'))
      .get()
    expect(row).toMatchObject({ lang: 'en', voice: 'Kore', model: 'fake-tts' })
  })

  it('frase vazia não pede nada ao provedor', async () => {
    const result = await speakText({ text: '   ' }, learner.profileId)
    expect(result).toMatchObject({ ok: false, source: 'none' })
    expect(scripted.speakCalls).toHaveLength(0)
  })

  it('limpar o cache devolve quantos clipes saíram', async () => {
    expect(clearAudioCache(learner.profileId)).toBeGreaterThan(0)
    expect(audioCacheStats(learner.profileId).rows).toBe(0)
  })
})

describe('score de pronúncia', () => {
  it('fala certa: score cheio, skill speaking sobe e o run fica gravado', async () => {
    scripted.transcript = 'I work on the backend'
    const result = await gradeSpeech(
      {
        mime: 'audio/wav',
        audio: FAKE_PCM.toString('base64'),
        target: 'I work on the backend',
        kind: 'speak',
        lessonId: learner.lessonId,
        exerciseId: learner.speakExerciseId
      },
      learner.profileId
    )

    expect(result.score).toBeGreaterThan(0.95)
    expect(result.passed).toBe(true)
    expect(result.skill).toBe('speaking')
    expect(result.transcript).toBe('I work on the backend')
    expect(result.summary).toMatch(/Pronúncia: 100%/i)
    expect(result.words.every((word) => word.status === 'ok')).toBe(true)

    const skill = getDb()
      .select({ estimate: schema.skillsState.estimate, confidence: schema.skillsState.confidence })
      .from(schema.skillsState)
      .where(and(eq(schema.skillsState.profileId, learner.profileId), eq(schema.skillsState.skill, 'speaking')))
      .get()
    expect(skill?.estimate).toBeGreaterThan(0)
    // Confiança cresce com material suficiente, não com uma frase de duas palavras.
    expect(skill?.confidence ?? 0).toBeGreaterThan(0.1)

    const attempts = Number(
      getDb()
        .select({ value: sql<number>`count(*)` })
        .from(schema.attempts)
        .where(eq(schema.attempts.exerciseId, learner.speakExerciseId))
        .get()?.value ?? 0
    )
    expect(attempts).toBe(1)

    const history = speechHistory(learner.profileId, 10)
    expect(history.runs[0]?.target).toBe('I work on the backend')
    expect(history.speakingAverage).not.toBeNull()
  })

  it('parte da frase faltando derruba a nota e marca as palavras', async () => {
    scripted.transcript = 'I work'
    const result = await gradeSpeech(
      {
        mime: 'audio/wav',
        audio: FAKE_PCM.toString('base64'),
        target: 'I work on the backend',
        kind: 'speak'
      },
      learner.profileId
    )

    expect(result.score).toBeLessThan(0.8)
    expect(result.passed).toBe(false)
    expect(result.tags).toContain('missing-words')
    expect(result.words.filter((word) => word.status === 'missing')).toHaveLength(3)
    expect(speechWeakWords(result.runId, learner.profileId).length).toBeGreaterThan(0)
  })

  it('nada ouvido é zero com mensagem honesta, não 20% por educação', async () => {
    setSpeechEngineForTest(silentSpeech)
    const result = await gradeSpeech(
      { mime: 'audio/wav', audio: FAKE_PCM.toString('base64'), target: 'hello there friend', kind: 'speak' },
      learner.profileId
    )
    setSpeechEngineForTest(fakeSpeech)

    expect(result.score).toBe(0)
    expect(result.transcriptEmpty).toBe(true)
    expect(result.summary).toMatch(/não deu para ouvir/i)
  })

  it('o áudio do microfone chega até o transcritor como WAV', async () => {
    scripted.transcript = 'she sells sea shells'
    await gradeSpeech(
      {
        mime: 'audio/wav',
        audio: FAKE_PCM.toString('base64'),
        target: 'she sells sea shells',
        kind: 'speak'
      },
      learner.profileId
    )
    const call = scripted.calls.at(-1)
    expect(call?.mimeType).toBe('audio/wav')
    expect(call?.lang).toBe('en')
    // A frase-alvo vai como contexto, não como ordem de repetir.
    expect(call?.hint).toBe('she sells sea shells')
  })

  it('provedor sem voz: nada é gravado como nota — a razão aparece', async () => {
    setSpeechEngineForTest(null)
    const result = await gradeSpeech(
      { mime: 'audio/wav', audio: FAKE_PCM.toString('base64'), target: 'qualquer frase aqui', kind: 'speak' },
      learner.profileId
    )
    setSpeechEngineForTest(fakeSpeech)

    expect(result.source).toBe('none')
    expect(result.score).toBe(0)
    expect(result.summary).toMatch(/não tem voz/i)
  })
})

describe('compreensão (listening)', () => {
  it('responder de ouvido conta como tentativa e mexe em listening', () => {
    const before = speechHistory(learner.profileId, 50)
    // A resposta certa vem do gabarito salvo — o caminho de escuta corrige com
    // a mesma régua determinística do resto (sem IA na sala).
    const exercise = getDb()
      .select({ answerKey: schema.exercises.answerKey })
      .from(schema.exercises)
      .where(eq(schema.exercises.id, learner.listenExerciseId))
      .get()
    const answer = (JSON.parse(exercise?.answerKey ?? '{}') as { answer?: string }).answer ?? ''
    expect(answer.length).toBeGreaterThan(0)

    const result = recordListening(
      {
        exerciseId: learner.listenExerciseId,
        response: answer,
        target: answer,
        lessonId: learner.lessonId
      },
      learner.profileId
    )

    expect(result.ok).toBe(true)
    expect(result.correct).toBe(true)
    expect(result.score).toBeGreaterThan(0)

    const skill = getDb()
      .select({ estimate: schema.skillsState.estimate })
      .from(schema.skillsState)
      .where(and(eq(schema.skillsState.profileId, learner.profileId), eq(schema.skillsState.skill, 'listening')))
      .get()
    expect(skill?.estimate).toBeGreaterThan(0)

    const after = speechHistory(learner.profileId, 50)
    expect(after.runs.length).toBeGreaterThan(before.runs.length)
    expect(after.listeningAverage).not.toBeNull()
  })
})

describe('isolamento entre perfis', () => {
  it('exercício de outro perfil não recebe tentativa', () => {
    const other = createProfile({ name: 'Outro', targetLang: 'en', nativeLang: 'en' })
    setActiveProfile(other.id)

    expect(() =>
      recordListening(
        { exerciseId: learner.listenExerciseId, response: 'x', target: 'I work on the backend' },
        other.id
      )
    ).toThrow(/não encontrado/)

    const attempts = Number(
      getDb()
        .select({ value: sql<number>`count(*)` })
        .from(schema.attempts)
        .where(eq(schema.attempts.exerciseId, learner.listenExerciseId))
        .get()?.value ?? 0
    )
    expect(attempts).toBe(1)
  })

  it('as frases da prática vêm da memória do próprio perfil', () => {
    recordCorrections(
      learner.profileId,
      [{ original: 'I am agree', corrected: 'I agree with that', tag: 'be-vs-verb', source: 'bank' }],
      { category: 'test', context: 'x' }
    )
    setActiveProfile(learner.profileId)
    const mine = voicePhrases(learner.profileId, 10)
    const theirs = voicePhrases(activeProfileId() === learner.profileId ? learner.profileId : learner.profileId, 10)
    expect(mine.length).toBeGreaterThan(0)
    expect(theirs.length).toBe(mine.length)

    // Frase certa do caderno entra como opção de fala (o aluno já a escreveu bem).
    expect(mine.some((phrase) => phrase.target === 'I agree with that' && phrase.source === 'error')).toBe(true)

    const ben = createProfile({ name: 'Ben', targetLang: 'en', nativeLang: 'en' })
    const empty = voicePhrases(ben.id, 10)
    expect(empty).toHaveLength(0)
  })
})
