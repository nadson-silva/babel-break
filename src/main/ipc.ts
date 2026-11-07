import { app, ipcMain } from 'electron'
import type { AppSettings, ProviderId, SettingsPayload, TestResult } from '../shared/types'
import { registerHomeIpc } from './home'
import { registerLearningIpc } from './learning'
import { registerLoopIpc } from './loop'
import { registerScenarioIpc } from './scenario'
import { registerTracksIpc } from './tracks'
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
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName()
  }))

  ipcMain.handle('settings:get', () => settingsPayload())

  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    updateSettings(patch)
    return settingsPayload()
  })

  ipcMain.handle('settings:set-gemini-key', async (_event, key: string) => {
    await setGeminiApiKey(key)
    return settingsPayload()
  })

  ipcMain.handle('settings:clear-gemini-key', () => {
    clearGeminiApiKey()
    return settingsPayload()
  })

  ipcMain.handle('models:list', async (_event, providerId: ProviderId) => {
    return getProvider(providerId).listModels()
  })

  ipcMain.handle('provider:test', async (_event, providerId: ProviderId): Promise<TestResult> => {
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
}
