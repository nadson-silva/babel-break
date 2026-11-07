import type { ModelInfo, TestResult } from '../../shared/types'
import { getSettings } from '../settings'
import type { GenerateRequest, Provider, StreamRequest } from './types'

interface OllamaTag {
  name: string
  size?: number
  details?: { parameter_size?: string }
  /** Presente em modelos remotos (ex.: gemma4:31b-cloud) — nada baixado localmente. */
  remote_model?: string
  remote_host?: string
}

function baseUrl(): string {
  return getSettings().ollamaBaseUrl.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434'
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function connectionHint(): string {
  return `Não foi possível conectar ao Ollama em ${baseUrl()}. Verifique se ele está rodando com "ollama serve".`
}

function formatSize(bytes?: number): string | undefined {
  // Modelos remotos (cloud) trazem size minúsculo — não faz dizer "0.0 GB".
  if (!bytes || bytes < 1024 * 1024) return undefined
  const gb = bytes / 1024 ** 3
  return `${gb.toFixed(1)} GB`
}

async function fetchJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, { signal: requestSignal(undefined, timeoutMs) })
  } catch {
    throw new Error(connectionHint())
  }

  if (!response.ok) {
    throw new Error(`Ollama respondeu ${response.status} em ${path}.`)
  }

  return (await response.json()) as T
}

export const ollamaProvider: Provider = {
  id: 'ollama',

  async listModels(): Promise<ModelInfo[]> {
    const data = await fetchJson<{ models?: OllamaTag[] }>('/api/tags')
    const models = data.models ?? []

    return models
      .map((model) => ({
        id: model.name,
        label: model.name,
        description: [
          model.details?.parameter_size,
          formatSize(model.size),
          model.remote_model ? 'nuvem' : null
        ]
          .filter(Boolean)
          .join(' · '),
        remote: Boolean(model.remote_model)
      }))
      .sort((a, b) => {
        // locais primeiro: o padrão auto-selecionado precisa funcionar offline
        if (a.remote !== b.remote) return a.remote ? 1 : -1
        return a.id.localeCompare(b.id)
      })
      .map(({ remote, ...info }) => info)
  },

  async test(model: string): Promise<TestResult> {
    const startedAt = performance.now()

    const version = await fetchJson<{ version: string }>('/api/version')
    const latencyMs = Math.round(performance.now() - startedAt)

    if (model) {
      const data = await fetchJson<{ models?: OllamaTag[] }>('/api/tags')
      const names = (data.models ?? []).map((entry) => entry.name)
      const found = names.includes(model) || names.includes(`${model}:latest`)

      if (!found) {
        return {
          ok: false,
          latencyMs,
          detail: `Ollama ${version.version}`,
          error: `Modelo "${model}" não encontrado. Rode: ollama pull ${model}`
        }
      }
    }

    return {
      ok: true,
      latencyMs,
      detail: `Ollama ${version.version}`
    }
  },

  async stream(request: StreamRequest, onToken: (token: string) => void): Promise<string> {
    let response: Response
    try {
      response = await fetch(`${baseUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: true,
          // Modelos "thinking" (qwen3, deepseek-r1 etc.) gastam muito tempo em
          // raciocínio interno e podem devolver content vazio. Para conversação
          // de tutoria queremos a resposta direta.
          think: false,
          options: { temperature: request.temperature ?? 0.7 }
        }),
        signal: request.signal
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new Error(connectionHint())
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Ollama respondeu ${response.status}${body ? `: ${body}` : ''}`)
    }
    if (!response.body) {
      throw new Error('Ollama retornou uma resposta vazia.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let payload: {
          error?: string
          message?: { content?: string }
          done?: boolean
        }

        try {
          payload = JSON.parse(trimmed)
        } catch {
          continue
        }

        if (payload.error) throw new Error(payload.error)

        const token = payload.message?.content
        if (token) {
          text += token
          onToken(token)
        }
      }
    }

    return text
  },

  async generate(request: GenerateRequest): Promise<string> {
    let response: Response
    try {
      response = await fetch(`${baseUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          think: false,
          ...(request.json ? { format: 'json' } : {}),
          options: { temperature: request.temperature ?? 0.4 }
        }),
        signal: request.signal
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new Error(connectionHint())
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Ollama respondeu ${response.status}${body ? `: ${body}` : ''}`)
    }

    const payload = (await response.json()) as {
      message?: { content?: string }
      error?: string
    }

    if (payload.error) throw new Error(payload.error)

    return payload.message?.content ?? ''
  }
}
