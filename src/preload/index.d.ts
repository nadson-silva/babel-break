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

declare global {
  interface Window {
    api: {
      settings: {
        get(): Promise<SettingsPayload>
        update(patch: Partial<AppSettings>): Promise<SettingsPayload>
        setGeminiKey(key: string): Promise<SettingsPayload>
        clearGeminiKey(): Promise<SettingsPayload>
      }
      models: {
        list(provider: ProviderId): Promise<ModelInfo[]>
      }
      provider: {
        test(provider: ProviderId): Promise<TestResult>
      }
      chat: {
        history(): Promise<StoredMessage[]>
        send(request: ChatSendRequest): Promise<{ ok: boolean; error?: string }>
        cancel(requestId: string): Promise<void>
        onEvent(callback: (event: ChatEvent) => void): () => void
      }
    }
  }
}

export {}
