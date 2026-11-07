import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ChatEvent,
  ConversationSummary,
  ConversationView,
  CurriculumView,
  FocusTrackView,
  GradeFeedback,
  GuidedSession,
  GuidedStep,
  HomeState,
  LessonDetail,
  LessonResultView,
  ModelInfo,
  NotebookView,
  OnboardingInput,
  PlacementResult,
  PlacementTest,
  ProfileState,
  ProviderId,
  RecapView,
  ReviewRating,
  ReviewResult,
  ReviewState,
  ScenarioFeedbackView,
  ScenarioRunView,
  ScenarioSession,
  ScenarioView,
  SettingsPayload,
  TestResult,
  TrackPlanLesson,
  TracksView,
  TutorSendRequest
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
  /** Eventos do turno do tutor (streaming + correções inline). */
  tutor: {
    onEvent: (callback: (event: ChatEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ChatEvent): void => callback(payload)
      ipcRenderer.on('chat:event', listener)
      return () => ipcRenderer.removeListener('chat:event', listener)
    },
    list: (): Promise<ConversationSummary[]> => ipcRenderer.invoke('tutor:list'),
    latest: (): Promise<ConversationSummary | null> => ipcRenderer.invoke('tutor:latest'),
    open: (conversationId: number): Promise<ConversationView> =>
      ipcRenderer.invoke('tutor:open', conversationId),
    create: (input: { topic?: string | null; lessonId?: number | null } = {}): Promise<ConversationView> =>
      ipcRenderer.invoke('tutor:new', input),
    send: (request: TutorSendRequest): Promise<void> => ipcRenderer.invoke('tutor:send', request),
    cancel: (requestId: string): Promise<void> => ipcRenderer.invoke('tutor:cancel', requestId),
    close: (conversationId: number): Promise<RecapView> => ipcRenderer.invoke('tutor:close', conversationId)
  },
  review: {
    state: (limit?: number): Promise<ReviewState> => ipcRenderer.invoke('review:state', limit),
    answer: (input: { cardId: number; rating: ReviewRating }): Promise<ReviewResult> =>
      ipcRenderer.invoke('review:answer', input),
    fromErrors: (): Promise<number> => ipcRenderer.invoke('review:from-errors')
  },
  notebook: {
    get: (): Promise<NotebookView> => ipcRenderer.invoke('notebook:get'),
    resolve: (errorId: number, resolved: boolean): Promise<void> =>
      ipcRenderer.invoke('notebook:resolve', errorId, resolved),
    resolveTag: (tags: string[]): Promise<number> => ipcRenderer.invoke('notebook:resolve-tag', tags)
  },
  guided: {
    active: (): Promise<GuidedSession | null> => ipcRenderer.invoke('guided:active'),
    start: (): Promise<GuidedSession> => ipcRenderer.invoke('guided:start'),
    step: (step: GuidedStep): Promise<GuidedSession> => ipcRenderer.invoke('guided:step', step),
    reviewCount: (done: number): Promise<GuidedSession> => ipcRenderer.invoke('guided:review-count', done),
    practice: (practice: { correct: number; total: number }): Promise<GuidedSession> =>
      ipcRenderer.invoke('guided:practice', practice),
    tutor: (): Promise<GuidedSession> => ipcRenderer.invoke('guided:tutor'),
    finish: (input: { reviewDone?: number; practice?: { correct: number; total: number } }): Promise<GuidedSession> =>
      ipcRenderer.invoke('guided:finish', input),
    abandon: (): Promise<void> => ipcRenderer.invoke('guided:abandon')
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
  },
  /** Trilhas de foco: rascunho → revisão do esboço → aprovação. */
  tracks: {
    list: (): Promise<TracksView> => ipcRenderer.invoke('track:list'),
    draft: (input: { objective: string; replaceId?: number }): Promise<FocusTrackView> =>
      ipcRenderer.invoke('track:draft', input),
    revise: (input: { trackId: number; lessons: TrackPlanLesson[] }): Promise<FocusTrackView> =>
      ipcRenderer.invoke('track:revise', input),
    approve: (trackId: number): Promise<FocusTrackView> => ipcRenderer.invoke('track:approve', trackId),
    discard: (trackId: number): Promise<void> => ipcRenderer.invoke('track:discard', trackId),
    status: (input: { trackId: number; status: 'active' | 'archived' }): Promise<FocusTrackView> =>
      ipcRenderer.invoke('track:status', input)
  },
  /** Modo cenário: roleplay com persona + rubrica de tarefa no fechamento. */
  scenario: {
    open: (input: { lessonId?: number | null; topic?: string | null }): Promise<ScenarioSession> =>
      ipcRenderer.invoke('scenario:open', input),
    finish: (conversationId: number): Promise<ScenarioFeedbackView> =>
      ipcRenderer.invoke('scenario:finish', conversationId),
    session: (conversationId: number): Promise<ScenarioSession | null> =>
      ipcRenderer.invoke('scenario:session', conversationId),
    runs: (limit?: number): Promise<ScenarioRunView[]> => ipcRenderer.invoke('scenario:runs', limit),
    refresh: (lessonId: number): Promise<ScenarioView> => ipcRenderer.invoke('scenario:refresh', lessonId)
  }
}

contextBridge.exposeInMainWorld('api', api)
