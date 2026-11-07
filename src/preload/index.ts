import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ChatEvent,
  ChatSendRequest,
  ModelInfo,
  ProviderId,
  SettingsPayload,
  StoredMessage,
  TestResult
} from '../shared/types'

const api = {
  settings: {
    get: (): Promise<SettingsPayload> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>): Promise<SettingsPayload> =>
      ipcRenderer.invoke('settings:update', patch),
    setGeminiKey: (key: string): Promise<SettingsPayload> =>
      ipcRenderer.invoke('settings:set-gemini-key', key),
    clearGeminiKey: (): Promise<SettingsPayload> => ipcRenderer.invoke('settings:clear-gemini-key')
  },
  models: {
    list: (provider: ProviderId): Promise<ModelInfo[]> => ipcRenderer.invoke('models:list', provider)
  },
  provider: {
    test: (provider: ProviderId): Promise<TestResult> => ipcRenderer.invoke('provider:test', provider)
  },
  chat: {
    history: (): Promise<StoredMessage[]> => ipcRenderer.invoke('chat:history'),
    send: (request: ChatSendRequest): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('chat:send', request),
    cancel: (requestId: string): Promise<void> => ipcRenderer.invoke('chat:cancel', requestId),
    onEvent: (callback: (event: ChatEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ChatEvent): void => callback(payload)
      ipcRenderer.on('chat:event', listener)
      return () => ipcRenderer.removeListener('chat:event', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
