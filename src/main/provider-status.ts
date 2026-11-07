/**
 * Disponibilidade da IA (M5 — comportamento offline).
 *
 * "Offline" aqui não é "sem internet": com Ollama o app inteiro funciona sem
 * rede. O que importa saber é se **a IA está alcançável agora** — porque aí o
 * caminho honesto é o cache (lições e exercícios já gerados) mais o banco de
 * interferência do par, e a UI deve dizer isso em vez de deixar o aluno girando
 * num spinner até o timeout.
 *
 * Este módulo sonda o provedor atual (com TTL), guarda o último resultado para
 * decisões síncronas e avisa o renderer quando o estado **muda** — o banner da
 * home e o chip da sidebar ligam-se aqui, não em polling.
 */
import { BrowserWindow } from 'electron'
import type { ProviderId, ProviderStatus } from '../shared/types'
import { getProvider } from './providers'
import { hasGeminiApiKey } from './secrets'
import { getSettings } from './settings'
import { currentModel } from './ai'

/** 20 s de TTL: barato o bastante para notar o provedor voltar, caro o bastante para não sonda-lo a cada clique. */
const TTL_MS = 20_000

/** A sonda nunca segura a UI: se o provedor não responde em 12s, está fora. */
const PROBE_TIMEOUT_MS = 12_000

export const STATUS_CHANNEL = 'provider:event'

let cached: ProviderStatus | null = null
let inFlight: Promise<ProviderStatus> | null = null
let timer: NodeJS.Timeout | null = null

function unknown(provider: ProviderId, model: string, local: boolean): ProviderStatus {
  return {
    provider,
    model,
    state: 'probing',
    reachable: false,
    local,
    detail: null,
    latencyMs: null,
    checkedAt: null
  }
}

function snapshot(): ProviderStatus {
  const settings = getSettings()
  const model = currentModel()
  return cached ?? unknown(settings.provider, model, settings.provider === 'ollama')
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

async function probe(): Promise<ProviderStatus> {
  const settings = getSettings()
  const provider: ProviderId = settings.provider
  const model = currentModel()
  const local = provider === 'ollama'

  if (provider === 'gemini' && !(await hasGeminiApiKey())) {
    return {
      provider,
      model,
      state: 'no-key',
      reachable: false,
      local,
      detail: null,
      latencyMs: null,
      checkedAt: Date.now()
    }
  }

  try {
    const result = await withTimeout(
      getProvider(provider).test(model),
      PROBE_TIMEOUT_MS,
      `O ${provider === 'ollama' ? 'Ollama' : 'Gemini'} demorou mais de ${Math.round(PROBE_TIMEOUT_MS / 1000)} s para responder.`
    )

    if (!result.ok) {
      return {
        provider,
        model,
        // O provedor respondeu (ex.: modelo não baixado): está no ar, mas o app
        // não consegue gerar com ele — o detalhe diz exatamente o que falta.
        state: model ? 'no-model' : 'unreachable',
        reachable: Boolean(model),
        local,
        detail: result.error ?? result.detail ?? null,
        latencyMs: result.latencyMs,
        checkedAt: Date.now()
      }
    }

    if (!model) {
      return {
        provider,
        model,
        state: 'no-model',
        reachable: true,
        local,
        detail: result.detail ?? null,
        latencyMs: result.latencyMs,
        checkedAt: Date.now()
      }
    }

    return {
      provider,
      model,
      state: 'ok',
      reachable: true,
      local,
      detail: result.detail ?? null,
      latencyMs: result.latencyMs,
      checkedAt: Date.now()
    }
  } catch (error) {
    return {
      provider,
      model,
      state: 'unreachable',
      reachable: false,
      local,
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: null,
      checkedAt: Date.now()
    }
  }
}

function broadcast(status: ProviderStatus): void {
  const windows =
    typeof BrowserWindow.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : []
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send(STATUS_CHANNEL, status)
    }
  }
}

/** Última sonda, sem esperar (para decisões síncronas e para a primeira tela). */
export function providerStatus(): ProviderStatus {
  return snapshot()
}

/** true quando a última sonda disse que dá para gerar. Sem sonda, false. */
export function aiReady(): boolean {
  return cached?.state === 'ok'
}

export function aiCachedAt(): number | null {
  return cached?.checkedAt ?? null
}

export function aiNeedsProbe(): boolean {
  if (!cached) return true
  if (Date.now() - (cached.checkedAt ?? 0) > TTL_MS) return true
  const settings = getSettings()
  // Provedor/modelo trocados: a sonda antiga não vale nada.
  return cached.provider !== settings.provider || cached.model !== currentModel()
}

export interface RefreshOptions {
  force?: boolean
  /** Emite o evento no renderer mesmo sem mudança (refresh manual). */
  announce?: boolean
}

/**
 * Sonda o provedor (com dedupe de chamadas simultâneas e TTL). Nunca lança:
 * "IA indisponível" é um estado, não uma exceção.
 */
export async function refreshProviderStatus(options: RefreshOptions = {}): Promise<ProviderStatus> {
  if (!options.force && !aiNeedsProbe() && cached) {
    if (options.announce) broadcast(cached)
    return cached
  }

  if (inFlight) return inFlight

  inFlight = probe()
    .then((status) => {
      const changed = !cached || cached.state !== status.state || cached.detail !== status.detail
      cached = status
      if (changed || options.announce) broadcast(status)
      return status
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

/**
 * Monitor: sonda no início e depois a cada `intervalMs`, anunciando só quando o
 * estado muda. Chamado pelo processo principal depois da janela existir.
 */
export function startProviderWatch(intervalMs = 60_000): void {
  stopProviderWatch()
  void refreshProviderStatus({ force: true })
  timer = setInterval(() => {
    void refreshProviderStatus()
  }, intervalMs)
  // O timer não pode segurar o processo de teste/quit.
  timer.unref?.()
}

export function stopProviderWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Só para teste: joga fora a sonda guardada. */
export function resetProviderStatus(): void {
  cached = null
  inFlight = null
}
