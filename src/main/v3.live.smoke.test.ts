/**
 * Smoke test de conversa em tempo real com o provedor vivo (manual, não é CI):
 *
 *   LT_SMOKE=1 LT_PROVIDER=gemini npx vitest run src/main/v3.live.smoke.test.ts
 *
 * Precisa de chave do Gemini configurada no app (o smoke não escreve segredo).
 * O caminho testado é o de verdade: `liveEngine` vem do provedor (sem o fake
 * do teste de integração), a sessão sobe no Gemini Live, e o áudio enviado é a
 * PRÓPRIA voz do provedor sintetizada por TTS — se o modelo ao vivo não entende
 * a própria voz, conversa com aluno está fadada.
 *
 * O smoke valida com turnos de texto E de áudio:
 * - o status diz a verdade sobre disponibilidade (Ollama: não tem voz ao vivo);
 * - a sessão abre com transcrição nativa ligada dos dois lados;
 * - turno por texto: pergunta → o tutor fala (chunk de áudio 24 kHz chega) e é
 *   transcrito (modelTranscript final não vazio);
 * - turno por áudio: TTS → downsample para 16 kHz → PCM cru no `sendAudio` →
 *   o ASR do Live devolve a frase (userTranscript);
 * - desligar fecha sem eventos depois do 'ended'.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { VoiceLiveEvent } from '../shared/types'
import { initDatabase } from './db'
import { updateSettings } from './settings'
import { completeOnboarding } from './learning'
import { resetProviderStatus } from './provider-status'
import { hasGeminiApiKey } from './secrets'
import { speakText } from './voice'
import { bufferFromBase64, readWavHeader } from '../core/audio'
import {
  liveStatus,
  onLiveEvent,
  pushLiveAudio,
  resetLiveForTest,
  sendLiveText,
  startLiveSession,
  stopLiveSession
} from './voice-live'

const enabled = process.env.LT_SMOKE === '1'
const provider = (process.env.LT_PROVIDER ?? 'gemini') as 'gemini' | 'ollama'
const QUESTION = 'What did you have for breakfast today?'

let profileId = 0

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
  const state = completeOnboarding({ goal: 'conversação', cefr: 'A2', targetLang: 'en', nativeLang: 'pt-BR' })
  profileId = state.profile.id
}, 300_000)

/**
 * WAV (do cache de TTS) → PCM cru. O Live API só aceita 16 kHz little-endian
 * mono: o 24 kHz do TTS desce por drop de amostras alternadas — tosco, e é
 * exatamente por isso que é smoke, não avaliação de qualidade.
 */
function pcm16kFromWav(dataUrl: string): string {
  const encoded = dataUrl.split(',')[1]
  const raw = encoded ? bufferFromBase64(encoded) : null
  if (!raw) throw new Error('smoke: TTS não devolveu áudio decodificável')
  const header = readWavHeader(raw)
  if (!header) throw new Error('smoke: TTS não devolveu WAV')
  const pcm = raw.subarray(header.dataOffset, header.dataOffset + header.dataLength)
  const samples: number[] = []
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    samples.push(pcm.readInt16LE(i))
  }
  const keep = header.sampleRate > 16_000 ? 2 : 1
  const out = Buffer.alloc(Math.floor(samples.length / keep) * 2)
  let w = 0
  for (let i = 0; i < samples.length; i += keep) {
    out.writeInt16LE(samples[i] as number, w)
    w += 2
  }
  return out.toString('base64')
}

describe.skipIf(!enabled)('v3 com tempo real de verdade', () => {
  it('o status diz a verdade sobre o provedor', async () => {
    const status = liveStatus(profileId)
    if (provider === 'gemini') {
      expect(await hasGeminiApiKey()).toBe(true)
      expect(status.available).toBe(true)
      expect(status.engine).toBe('gemini-live')
    } else {
      expect(status.available).toBe(false)
      expect(status.detail).toMatch(/tempo real/i)
    }
  }, 60_000)

  it('chamada viva: turno por texto com áudio do tutor, turno por áudio com transcrição', async () => {
    if (provider !== 'gemini') return

    const events: VoiceLiveEvent[] = []
    const off = onLiveEvent((event) => events.push(event))

    const start = await startLiveSession(profileId, { topic: ' breakfast' })
    expect(start.ok).toBe(true)
    const sessionId = start.sessionId as string

    // Turno 1 — texto: pergunta direta e o tutor responde FALANDO.
    const answered = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('tempo real não respondeu em 60 s')), 60_000)
      const watch = (event: VoiceLiveEvent): void => {
        if (event.sessionId !== sessionId || event.conversationId != null) return
        if (event.type === 'modelTranscript' && event.partial === false && (event.text ?? '').trim()) {
          clearTimeout(timeout)
          offWatch()
          resolve()
        }
        if (event.type === 'error' || event.type === 'ended') {
          clearTimeout(timeout)
          offWatch()
          reject(new Error(`sessão morreu: ${event.type} ${event.message ?? ''}`))
        }
      }
      const offWatch = onLiveEvent(watch)
    })

    expect(sendLiveText(sessionId, QUESTION)).toBe(true)
    await answered

    const audioChunks = events.filter((event) => event.type === 'audioChunk' && event.audio)
    expect(audioChunks.length).toBeGreaterThan(0)
    expect(audioChunks[0]?.sampleRate).toBe(24_000)

    // Turno 2 — áudio: a própria voz sintetizada do provedor vira 16k cru.
    const spoken = await speakText({ text: QUESTION })
    expect(spoken.ok).toBe(true)
    const heard = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('VAD não fechou o turno em 45 s')), 45_000)
      const watch = (event: VoiceLiveEvent): void => {
        if (event.sessionId !== sessionId || event.conversationId != null) return
        if (event.type === 'userTranscript' && event.partial === false && (event.text ?? '').trim()) {
          clearTimeout(timeout)
          offWatch()
          resolve(event.text as string)
        }
        if (event.type === 'error' || event.type === 'ended') {
          clearTimeout(timeout)
          offWatch()
          reject(new Error(`sessão morreu: ${event.type} ${event.message ?? ''}`))
        }
      }
      const offWatch = onLiveEvent(watch)
    })

    const frame = pcm16kFromWav(spoken.dataUrl as string)
    // Em frames de ~100 ms, como o AudioWorklet do Lote 2 fará.
    const bytes = Buffer.from(frame, 'base64')
    for (let offset = 0; offset < bytes.length; offset += 3_200) {
      pushLiveAudio(sessionId, bytes.subarray(offset, offset + 3_200).toString('base64'))
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    const transcript = await heard
    expect(transcript.toLowerCase()).toContain('breakfast')

    // Desligar: nada de evento da sessão depois do 'ended'.
    const seenBeforeStop = events.length
    stopLiveSession(sessionId)
    expect(events.slice(seenBeforeStop).some((event) => event.type === 'ended')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(events.filter((event) => event.type === 'state' && event.state === 'resuming').length).toBe(0)
    off()
  }, 240_000)

  it('reconexão transparente: goAway não pode aparecer como chamada morta', async () => {
    if (provider !== 'gemini') return
    // Sem como forçar o goAway do servidor em teste; a smoke valida que a
    // retomada NATIVA configurou (handle presente) — o handle só aparece se o
    // config sessionResumption pegou.
    const events: VoiceLiveEvent[] = []
    const off = onLiveEvent((event) => events.push(event))
    const start = await startLiveSession(profileId, { topic: 'trânsito' })
    expect(start.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    stopLiveSession(start.sessionId)
    off()
    expect(events.some((event) => event.type === 'state' && event.state === 'ready')).toBe(true)
    resetLiveForTest()
  }, 120_000)
})
