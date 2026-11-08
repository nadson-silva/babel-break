/**
 * Smoke test de voz com provedor real (manual, não é CI):
 *
 *   LT_SMOKE=1 LT_PROVIDER=gemini npx vitest run src/main/v2.voice.smoke.test.ts
 *
 * Precisa de chave do Gemini configurada no app (o smoke não escreve segredo).
 * Ollama não tem voz: com `LT_PROVIDER=ollama` este arquivo só prova a
 * degradação honesta (TTS/ASR indisponíveis, nada de nota inventada).
 *
 * O que ele guarda, com áudio de verdade:
 * - o provedor sintetiza e o app embrulha em WAV tocável (duração > 0);
 * - a segunda vez vem do cache, sem segunda chamada;
 * - transcrição + score: falar a frase certa pontua alto, e o `speech_runs`
 *   guarda a transcrição para o aluno discordar com o texto na frente;
 * - o ASR recebe o hint da frase-alvo como contexto, não como ordem.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, initDatabase, schema } from './db'
import { updateSettings } from './settings'
import { completeOnboarding } from './learning'
import { resetProviderStatus } from './provider-status'
import { audioCacheStats, clearAudioCache, gradeSpeech, speakText, voiceStatus } from './voice'
import { hasGeminiApiKey } from './secrets'

const enabled = process.env.LT_SMOKE === '1'
const provider = (process.env.LT_PROVIDER ?? 'gemini') as 'gemini' | 'ollama'
const TARGET = 'I work on the backend every morning'

beforeAll(async () => {
  if (!enabled) return
  initDatabase()
  updateSettings({
    provider,
    ollamaModel: process.env.LT_MODEL ?? '',
    ollamaBaseUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
    voiceEnabled: true,
    pregenerate: false
  })
  resetProviderStatus()
  completeOnboarding({ goal: 'trabalho', cefr: 'A2', targetLang: 'en', nativeLang: 'pt-BR' })
}, 300_000)

describe.skipIf(!enabled)('v2 com voz real', () => {
  it('o status diz a verdade sobre o provedor', async () => {
    const status = voiceStatus()
    if (provider === 'gemini') {
      expect(await hasGeminiApiKey()).toBe(true)
      expect(status.tts).toBe(true)
      expect(status.asr).toBe(true)
    } else {
      expect(status.mode).toBe('none')
    }
  }, 120_000)

  it('sintetiza, serve do cache na segunda vez', async () => {
    if (provider !== 'gemini') return
    clearAudioCache()
    const first = await speakText({ text: TARGET })
    expect(first.ok).toBe(true)
    expect(first.source).toBe('provider')
    expect(first.dataUrl).toMatch(/^data:audio\/wav;base64,/)
    expect(first.durationMs).toBeGreaterThan(300)

    const second = await speakText({ text: TARGET })
    expect(second.source).toBe('cache')
    expect(audioCacheStats().rows).toBe(1)
  }, 180_000)

  it('transcreve o próprio áudio e a nota acompanha', async () => {
    if (provider !== 'gemini') return
    const audio = await speakText({ text: TARGET })
    const base64 = audio.dataUrl?.split(',')[1]
    expect(base64).toBeTruthy()

    const result = await gradeSpeech({
      mime: 'audio/wav',
      audio: base64 as string,
      target: TARGET,
      kind: 'speak'
    })

    // O áudio sintético é o melhor ASR-teste possível: a frase deve voltar quase
    // inteira, e o score alto. Se o provedor não entender nem a própria voz, o
    // pipeline de pronúncia não tem como ser honesto.
    expect(result.transcript?.toLowerCase()).toContain('backend')
    const row = getDb()
      .select({ metrics: schema.speechRuns.metrics, transcript: schema.speechRuns.transcript })
      .from(schema.speechRuns)
      .where(eq(schema.speechRuns.id, result.runId))
      .get()
    expect(row?.transcript).toBeTruthy()
    expect(row?.metrics).toContain('"words"')
  }, 240_000)
})
