import { z } from 'zod'
import { getProvider } from './providers'
import { getSettings } from './settings'
import { profileNativeLang } from './locale'
import type { StreamRequest } from './providers/types'
import { runtimeText } from '../core/runtime-text'

export interface StructuredRequest {
  system: string
  user: string
  temperature?: number
  /** Cancelamento externo (ex.: aluno fechou a tela) — soma-se ao deadline. */
  signal?: AbortSignal
}

/**
 * Chamadas de IA em andamento (M5). A pré-geração usa isto para nunca competir
 * com o aluno: se há uma geração viva na tela, o ciclo ocioso espera.
 */
let inFlight = 0

export function aiInFlight(): number {
  return inFlight
}

/**
 * M6 (C3): deadline em TODA chamada de IA. `AbortSignal.timeout` é o teto
 * absoluto — um request pendurado (Ollama morto no meio, gateway mudo) não
 * pode travar a fila ociosa para sempre. Streams têm teto maior porque o
 * token a token é trabalho legítimo.
 */
export const GENERATE_DEADLINE_MS = 120_000
export const STREAM_DEADLINE_MS = 300_000

/** Backoff exponencial + jitter entre retentativas (nunca no primeiro try). */
function retryDelayMs(attempt: number): number {
  const base = 1_000 * 2 ** attempt
  return base + Math.floor(Math.random() * base) / 2
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Rate limit do free tier não se conserta com retry imediato — 429 é fim de linha. */
export function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /429|rate.?limit|RESOURCE_EXHAUSTED/i.test(message)
}

function withDeadline(signal: AbortSignal | undefined, deadlineMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(deadlineMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/**
 * M6 (C2): streaming também entra no `aiInFlight` e recebe deadline — sem
 * isto o `prewarm` competia com quem conversa (só `generateStructured` era
 * contada) e um stream zumbi nunca largava o contador.
 */
export async function trackedStream(request: StreamRequest, onToken: (token: string) => void): Promise<string> {
  const settings = getSettings()
  const provider = getProvider(settings.provider)
  const signal = withDeadline(request.signal, STREAM_DEADLINE_MS)

  inFlight += 1
  try {
    return await provider.stream({ ...request, signal }, onToken)
  } finally {
    inFlight -= 1
  }
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
    // M6 (C3): retentativa espera com backoff + jitter — bombardear o provedor
    // logo depois de uma falha é o que estoura o rate limit do free tier.
    if (attempt > 0) {
      await sleep(retryDelayMs(attempt))
    }

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
        json: true,
        // Deadline sempre ativo; cancelamento do aluno, quando existir, soma-se.
        signal: withDeadline(request.signal, GENERATE_DEADLINE_MS)
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      // 429: retentar agora só piora a janela de quota.
      if (isRateLimited(error)) {
        throw new Error(
          'O provedor de IA está no limite de uso (429). Aguarde alguns minutos e tente de novo.'
        )
      }
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
