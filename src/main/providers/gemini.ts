import { GoogleGenAI, type Part } from '@google/genai'
import type { ModelInfo, TestResult } from '../../shared/types'
import {
  DEFAULT_VOICE,
  GEMINI_VOICES,
  asrInstruction,
  isVerbatimTtsModel,
  resolveVoice,
  ttsInstruction,
  ttsStyle,
  ttsTranscript
} from '../../core/voice'
import { WAV_MIME, readWavHeader } from '../../core/audio'
import { languageMeta } from '../../core/languages'
import { geminiLive } from './gemini-live'
import { getGeminiApiKey } from '../secrets'
import type {
  GenerateRequest,
  Provider,
  SpeakRequest,
  SpeakResult,
  SpeechCapability,
  StreamRequest,
  TranscribeRequest
} from './types'

/**
 * Modelos de voz do Gemini. A síntese vive em modelos próprios (`*-tts`); a
 * transcrição usa os multimodais normais, que aceitam áudio na entrada.
 * Nomes e vozes: `core/voice.ts`.
 *
 * As famílias `2.5-*-preview-tts` e `3.1-flash-tts-preview` saem do ar em
 * 17/11/2026: ficaram os 3.8, que sintetizam uma frase em ~3 s.
 */
export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']

export const GEMINI_ASR_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']

/** Padrões nomeados: com `noUncheckedIndexedAccess`, indexar a lista não prova nada. */
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts'
/**
 * O 3.8-flash transcreve melhor mas levou 20 s numa frase (o aluno espera o
 * score no fim da gravação); o 3.5-flash fez a mesma transcrição em 2,6 s.
 */
export const DEFAULT_GEMINI_ASR_MODEL = 'gemini-3.5-flash'

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash', description: 'Rápido e barato (padrão)' },
  { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite', description: 'Mais rápido' },
  { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash', description: 'Maior qualidade' }
]

/** Versão do endpoint que conhece `speechConfig` (ver `speechClient`). */
const SPEECH_API_VERSION = 'v1beta'

async function client(apiVersion?: string): Promise<GoogleGenAI> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) {
    throw new Error('Chave da API do Gemini não configurada.')
  }
  return apiVersion ? new GoogleGenAI({ apiKey, apiVersion }) : new GoogleGenAI({ apiKey })
}

/**
 * Cliente da fala. O TTS manda `speechConfig`, e esse campo só existe no
 * `generation_config` do **v1beta**: no v1 (que é o padrão do SDK) a API responde
 * `400 INVALID_ARGUMENT — Unknown name "speechConfig"`. O resto do app continua
 * no v1 estável; a transcrição também, porque os modelos 3.x aceitam áudio lá.
 */
async function speechClient(): Promise<GoogleGenAI> {
  return client(SPEECH_API_VERSION)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Fala no Gemini: TTS (`responseModalities: [AUDIO]` + voz prebuilt, no v1beta)
 * e ASR (áudio inline + instrução de transcrição). O 3.8 devolve WAV pronto
 * (`audio/wav`); os previews antigos devolviam PCM cru (`audio/pcm;rate=…`) —
 * quem consome decide pelo mime (`core/audio.ts`).
 */
export const geminiSpeech: SpeechCapability = {
  ttsModels: GEMINI_TTS_MODELS,
  asrModels: GEMINI_ASR_MODELS,
  voices: GEMINI_VOICES.map((voice) => voice.id),
  defaultVoice: DEFAULT_VOICE,

  async speak(request: SpeakRequest): Promise<SpeakResult> {
    const ai = await speechClient()
    const model = request.model.trim() || DEFAULT_GEMINI_TTS_MODEL
    const voiceName = resolveVoice(request.voice)

    const transcript: Part = isVerbatimTtsModel(model)
      ? { text: ttsTranscript(request.text), speechMetadata: { style: ttsStyle(request.rate) } }
      : { text: ttsInstruction({ text: request.text, rate: request.rate }) }

    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [transcript] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } }
        },
        ...(request.signal ? { abortSignal: request.signal } : {})
      }
    })

    const parts = (response.candidates?.[0]?.content?.parts ?? []) as Part[]
    for (const part of parts) {
      const inline = part.inlineData
      if (inline?.data) {
        const data = Buffer.from(inline.data, 'base64')
        return {
          // Sem mime na resposta não se pode adivinhar o contêiner: farejar o
          // cabeçalho RIFF é mais honesto que assumir PCM e embrulhar em WAV
          // em cima de um WAV (o modelo 3.8 devolve WAV por padrão).
          mimeType: inline.mimeType ?? (readWavHeader(data) ? WAV_MIME : 'audio/pcm;rate=24000'),
          data
        }
      }
    }

    throw new Error('O modelo de voz não devolveu áudio.')
  },

  async transcribe(request: TranscribeRequest): Promise<string> {
    const ai = await client()
    const model = request.model.trim() || DEFAULT_GEMINI_ASR_MODEL
    const langName = languageMeta(request.lang).name

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: request.mimeType, data: request.audio.toString('base64') } },
            { text: asrInstruction({ langName, hint: request.hint }) }
          ]
        }
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 400,
        ...(request.signal ? { abortSignal: request.signal } : {})
      }
    })

    return (response.text ?? '').trim()
  }
}

export const geminiProvider: Provider = {
  id: 'gemini',

  async listModels(): Promise<ModelInfo[]> {
    try {
      const ai = await client()
      const pager = await ai.models.list({ config: { pageSize: 50 } })
      const models: ModelInfo[] = []

      for await (const model of pager) {
        const id = (model.name ?? '').replace(/^models\//, '')
        if (!id.startsWith('gemini')) continue

        const actions = model.supportedActions ?? []
        if (actions.length > 0 && !actions.includes('generateContent')) continue

        models.push({
          id,
          label: id,
          description: model.displayName ?? undefined
        })
      }

      return models.length > 0 ? models.sort((a, b) => a.id.localeCompare(b.id)) : FALLBACK_MODELS
    } catch {
      return FALLBACK_MODELS
    }
  },

  async test(model: string): Promise<TestResult> {
    const startedAt = performance.now()
    try {
      const ai = await client()
      const response = await ai.models.generateContent({
        model: model || 'gemini-3.5-flash',
        contents: 'Responda apenas: ok',
        config: { maxOutputTokens: 8, temperature: 0 }
      })

      return {
        ok: true,
        latencyMs: Math.round(performance.now() - startedAt),
        detail: response.text?.trim() || 'resposta vazia'
      }
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  },

  async stream(request: StreamRequest, onToken: (token: string) => void): Promise<string> {
    const ai = await client()

    const systemInstruction = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')

    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }]
      }))

    const stream = await ai.models.generateContentStream({
      model: request.model,
      contents,
      config: {
        temperature: request.temperature ?? 0.7,
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(request.signal ? { abortSignal: request.signal } : {})
      }
    })

    let text = ''
    for await (const chunk of stream) {
      const token = chunk.text
      if (token) {
        text += token
        onToken(token)
      }
    }

    return text
  },

  speech: geminiSpeech,

  /** V3: conversa em tempo real (Live API) — mesmo segredo, sessão longa. */
  live: geminiLive,

  async generate(request: GenerateRequest): Promise<string> {
    const ai = await client()

    const systemInstruction = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')

    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }]
      }))

    const response = await ai.models.generateContent({
      model: request.model,
      contents,
      config: {
        temperature: request.temperature ?? 0.4,
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(request.json ? { responseMimeType: 'application/json' } : {}),
        ...(request.signal ? { abortSignal: request.signal } : {})
      }
    })

    return response.text ?? ''
  }
}
