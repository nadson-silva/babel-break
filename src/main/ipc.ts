import { app } from 'electron'
import { handle } from './ipc-contract'
import type { AppSettings, LanguageOption, ProviderId, SettingsPayload, TestResult } from '../shared/types'
import { LANGUAGES } from '../core/languages'
import { getDbStatus } from './db'
import { registerDashboardIpc } from './dashboard'
import { registerHomeIpc } from './home'
import { registerLearningIpc } from './learning'
import { registerLoopIpc } from './loop'
import { registerPrewarmIpc } from './prewarm'
import { registerPortableIpc } from './portable'
import { registerReportsIpc } from './reports'
import { refreshProviderStatus } from './provider-status'
import { registerScenarioIpc } from './scenario'
import { registerTracksIpc } from './tracks'
import { emitStudentEvent } from './events'
import { logFilePath } from './log'
import { getProvider } from './providers'
import {
  clearGeminiApiKey,
  getSecureStorageInfo,
  hasGeminiApiKey,
  setGeminiApiKey
} from './secrets'
import { getSettings, updateSettings } from './settings'

async function settingsPayload(): Promise<SettingsPayload> {
  return {
    ...getSettings(),
    hasGeminiKey: await hasGeminiApiKey(),
    secureStorage: await getSecureStorageInfo(),
    runtime: {
      electron: process.versions.electron ?? '—',
      chrome: process.versions.chrome ?? '—',
      node: process.versions.node,
      platform: process.platform
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerIpcHandlers(): void {
  handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName()
  }))

  // M6 (C10): o renderer pede o caminho do log para "reportar bug" ter o que anexar.
  handle('log:get-path', (): { path: string } => ({ path: logFilePath() ?? '' }))

  // M6 (C4): a tela de recuperação lê o estado do banco do último boot.
  handle('db:status', () => getDbStatus())

  // M4: o renderer não importa `core/` (são dois projetos TS) — o registro de
  // idiomas cruza a ponte como dado de exibição para os seletores de idioma.
  handle('languages:list', (): LanguageOption[] =>
    LANGUAGES.map(({ code, name, nativeName, promptName, scriptDirection, tokenization }) => ({
      code,
      name,
      nativeName,
      promptName,
      scriptDirection,
      tokenization
    }))
  )

  handle('settings:get', () => settingsPayload())

  handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    updateSettings(patch)
    // M5: mexer em provedor/peso de foco muda o que vale a pena aquecer.
    emitStudentEvent('settings-saved')
    return settingsPayload()
  })

  // M5: estado de disponibilidade da IA — o que faz a UI dizer "offline" com
  // precisão (Ollama local continua "online" sem internet).
  handle('provider:status', () => refreshProviderStatus())
  handle('provider:probe', () => refreshProviderStatus({ force: true, announce: true }))

  handle('settings:set-gemini-key', async (_event, key: string) => {
    await setGeminiApiKey(key)
    return settingsPayload()
  })

  handle('settings:clear-gemini-key', () => {
    clearGeminiApiKey()
    return settingsPayload()
  })

  handle('models:list', async (_event, providerId: ProviderId) => {
    return getProvider(providerId).listModels()
  })

  handle('provider:test', async (_event, providerId: ProviderId): Promise<TestResult> => {
    const startedAt = performance.now()
    const settings = getSettings()
    const model = providerId === 'gemini' ? settings.geminiModel : settings.ollamaModel

    try {
      return await getProvider(providerId).test(model)
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        error: errorMessage(error)
      }
    }
  })

  registerLearningIpc()
  registerHomeIpc()
  registerLoopIpc()
  registerTracksIpc()
  registerScenarioIpc()
  registerDashboardIpc()
  registerReportsIpc()
  registerPrewarmIpc()
  registerPortableIpc()
}
