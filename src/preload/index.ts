import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ChatEvent,
  ChatSendRequest,
  CurriculumView,
  GradeFeedback,
  HomeState,
  LessonDetail,
  LessonResultView,
  ModelInfo,
  OnboardingInput,
  PlacementResult,
  PlacementTest,
  ProfileState,
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
  },
  learning: {
    profile: {
      get: (): Promise<ProfileState> => ipcRenderer.invoke('profile:get'),
      onboard: (input: OnboardingInput): Promise<ProfileState> =>
        ipcRenderer.invoke('profile:onboard', input)
    },
    placement: {
      generate: (goal?: string): Promise<PlacementTest> =>
        ipcRenderer.invoke('placement:generate', goal),
      submit: (answers: number[]): Promise<PlacementResult> =>
        ipcRenderer.invoke('placement:submit', answers)
    },
    curriculum: {
      get: (): Promise<CurriculumView> => ipcRenderer.invoke('curriculum:get'),
      generate: (): Promise<CurriculumView> => ipcRenderer.invoke('curriculum:generate')
    },
    lesson: {
      open: (lessonId: number): Promise<LessonDetail> =>
        ipcRenderer.invoke('lesson:open', lessonId),
      answer: (input: {
        exerciseId: number
        response: string
        latencyMs?: number
      }): Promise<GradeFeedback> => ipcRenderer.invoke('lesson:answer', input),
      finish: (input: { lessonId: number; sessionId: number }): Promise<LessonResultView> =>
        ipcRenderer.invoke('lesson:finish', input)
    },
    home: {
      get: (): Promise<HomeState> => ipcRenderer.invoke('home:get')
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
