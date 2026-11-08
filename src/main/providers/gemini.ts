import { GoogleGenAI, type Part } from '@google/genai'
import type { ModelInfo, TestResult } from '../../shared/types'
import { DEFAULT_VOICE, GEMINI_VOICES, asrInstruction, resolveVoice, ttsInstruction } from '../../core/voice'
import { languageMeta } from '../../core/languages'
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
 * Modelos de voz do Gemini (v2). A síntese vive em modelos próprios (`*-tts`);
 * a transcrição usa os modelos multimodais normais, que aceitam áudio na
 * entrada. Nomes e vozes: `core/voice.ts`.
 */
export const GEMINI_TTS_MODELS = [
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
  'gemini-3.1-flash-tts-preview'
]

export const GEMINI_ASR_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']

/** Padrões nomeados: com `noUncheckedIndexedAccess`, indexar a lista não prova nada. */
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts'
export const DEFAULT_GEMINI_ASR_MODEL = 'gemini-2.5-flash'

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', description: 'Rápido e barato (padrão)' },
  { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite', description: 'Mais rápido' },
  { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro', description: 'Maior qualidade' }
]

async function client(): Promise<GoogleGenAI> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) {
    throw new Error('Chave da API do Gemini não configurada.')
  }
  return new GoogleGenAI({ apiKey })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * V2 — fala no Gemini: TTS (`responseModalities: [AUDIO]` + voz prebuilt) e
 * ASR (áudio inline + instrução de transcrição). O TTS devolve PCM cru
 * (`audio/pcm;rate=…`); quem consome isto embrulha em WAV (`core/audio.ts`).
 */
export const geminiSpeech: SpeechCapability = {
  ttsModels: GEMINI_TTS_MODELS,
  asrModels: GEMINI_ASR_MODELS,
  voices: GEMINI_VOICES.map((voice) => voice.id),
  defaultVoice: DEFAULT_VOICE,

  async speak(request: SpeakRequest): Promise<SpeakResult> {
    const ai = await client()
    const model = request.model.trim() || DEFAULT_GEMINI_TTS_MODEL

    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: ttsInstruction({ text: request.text, rate: request.rate }) }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: resolveVoice(request.voice) } }
        },
        ...(request.signal ? { abortSignal: request.signal } : {})
      }
    })

    const parts = (response.candidates?.[0]?.content?.parts ?? []) as Part[]
    for (const part of parts) {
      const inline = part.inlineData
      if (inline?.data) {
        return {
          mimeType: inline.mimeType ?? 'audio/pcm;rate=24000',
          data: Buffer.from(inline.data, 'base64')
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
        model: model || 'gemini-2.5-flash',
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
