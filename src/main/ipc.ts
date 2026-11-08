import { app, BrowserWindow } from 'electron'
import { handle } from './ipc-contract'
import type { AppSettings, LanguageOption, ProviderId, SettingsPayload, TestResult } from '../shared/types'
import { LANGUAGES } from '../core/languages'
import { RUNTIME_TEXT_LANGUAGES } from '../core/runtime-text'
import { getDbStatus } from './db'
import { registerDashboardIpc } from './dashboard'
import { registerHomeIpc } from './home'
import { registerLearningIpc } from './learning'
import { registerLoopIpc } from './loop'
import { registerPrewarmIpc } from './prewarm'
import { registerReminderIpc } from './reminders'
import { registerUpdateIpc } from './updater'
import { registerPortableIpc } from './portable'
import { registerVoiceIpc } from './voice'
import { registerJobsIpc } from './jobs-ipc'
import { registerReportsIpc } from './reports'
import { refreshProviderStatus } from './provider-status'
import { registerScenarioIpc } from './scenario'
import { registerTracksIpc } from './tracks'
import { emitStudentEvent, onStudentEvent } from './events'
import { logFilePath } from './log'
import { getProvider } from './providers'
import { roleViews } from './ai'
import { GEMINI_TTS_MODELS } from './providers/gemini'
import { GEMINI_VOICES } from '../core/voice'
import { voiceStatus } from './voice'
import {
  clearGeminiApiKey,
  getSecureStorageInfo,
  hasGeminiApiKey,
  setGeminiApiKey
} from './secrets'
import { getSettings, updateSettings } from './settings'

async function settingsPayload(): Promise<SettingsPayload> {
  const settings = getSettings()
  return {
    ...settings,
    hasGeminiKey: await hasGeminiApiKey(),
    secureStorage: await getSecureStorageInfo(),
    runtime: {
      electron: process.versions.electron ?? '—',
      chrome: process.versions.chrome ?? '—',
      node: process.versions.node,
      platform: process.platform
    },
    runtimeLanguages: [...RUNTIME_TEXT_LANGUAGES],
    // V2: a tela de configurações diz qual modelo está em cada papel em vez de
    // mostrar três campos iguais sem contexto.
    roles: roleViews(),
    voice: voiceStatus(),
    ttsModels: settings.provider === 'gemini' ? GEMINI_TTS_MODELS : [],
    voices: settings.provider === 'gemini' ? GEMINI_VOICES.map((voice) => voice.id) : [],
    // O SO é quem sabe se tem voz instalada; o main dá a pista, o renderer confirma.
    systemVoicesPossible: true
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

  // V2: clicar no lembrete traz a janela de volta (o evento chega por `events`).
  onStudentEvent((payload) => {
    if (payload.event !== 'reminder-opened') return
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

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
  registerReminderIpc()
  registerUpdateIpc()
  registerVoiceIpc()
  registerJobsIpc()
}
