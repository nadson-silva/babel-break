import { GoogleGenAI } from '@google/genai'
import type { ModelInfo, TestResult } from '../../shared/types'
import { getGeminiApiKey } from '../secrets'
import type { GenerateRequest, Provider, StreamRequest } from './types'

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
