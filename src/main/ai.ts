import { z } from 'zod'
import { getProvider } from './providers'
import { getSettings } from './settings'
import { profileNativeLang } from './locale'
import { runtimeText } from '../core/runtime-text'

export interface StructuredRequest {
  system: string
  user: string
  temperature?: number
}

/**
 * Chamadas de IA em andamento (M5). A pré-geração usa isto para nunca competir
 * com o aluno: se há uma geração viva na tela, o ciclo ocioso espera.
 */
let inFlight = 0

export function aiInFlight(): number {
  return inFlight
}

export function currentModel(): string {
  const settings = getSettings()
  return (settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel).trim()
}

export function ensureModelConfigured(): string {
  const model = currentModel()
  if (!model) {
    throw new Error(runtimeText(profileNativeLang(), 'error.noModel'))
  }
  return model
}

function extractJson(text: string): unknown {
  let candidate = text.trim()
  candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('a resposta não contém um objeto JSON')
  }

  return JSON.parse(candidate.slice(start, end + 1)) as unknown
}

function issuesOf(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`)
    .join('; ')
}

/**
 * Pede ao provedor atual uma resposta estruturada e valida com zod.
 * Uma retentativa com o erro de validação; depois disso, falha com mensagem clara.
 */
export async function generateStructured<T>(
  schema: z.ZodType<T>,
  request: StructuredRequest
): Promise<T> {
  const model = ensureModelConfigured()
  const settings = getSettings()
  const provider = getProvider(settings.provider)

  const schemaJson = JSON.stringify(z.toJSONSchema(schema))
  const system = [
    request.system,
    '',
    'Formato obrigatório: responda apenas com JSON que valide exatamente este JSON Schema:',
    schemaJson
  ].join('\n')

  let correction = ''
  let lastError = ''

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string

    try {
      inFlight += 1
      raw = await provider.generate({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${request.user}${correction}` }
        ],
        temperature: request.temperature ?? 0.4,
        json: true
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      correction =
        '\n\nA tentativa anterior falhou antes de gerar a resposta. Gere o objeto JSON completo agora.'
      continue
    } finally {
      inFlight -= 1
    }

    if (!raw.trim()) {
      lastError = 'o modelo devolveu uma resposta vazia'
      correction = '\n\nSua resposta anterior veio vazia. Responda apenas com o objeto JSON.'
      continue
    }

    let parsed: unknown
    try {
      parsed = extractJson(raw)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      correction = `\n\nSua resposta anterior não era JSON válido (${lastError}). Responda apenas com o objeto JSON, sem markdown.`
      continue
    }

    const result = schema.safeParse(parsed)
    if (result.success) return result.data

    lastError = issuesOf(result.error)
    correction = `\n\nSua resposta anterior não passou na validação (${lastError}). Corrija e responda apenas com o JSON completo.`
  }

  throw new Error(
    `O modelo não conseguiu gerar conteúdo válido (${lastError}). Tente novamente ou escolha um modelo mais forte em Configurações.`
  )
}
