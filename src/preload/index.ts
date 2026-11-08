import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CacheStats,
  ChatEvent,
  CreateProfileInput,
  ConversationSummary,
  ConversationView,
  CurriculumView,
  DashboardView,
  FocusTrackView,
  GradeFeedback,
  GuidedSession,
  GuidedStep,
  AudioCacheStats,
  ExportFileView,
  JobEvent,
  JobView,
  ListeningResultView,
  ImportResultView,
  InspectView,
  SpeechAudioView,
  SpeechGradeRequest,
  SpeechGradeView,
  SpeechHistoryView,
  VoicePhraseView,
  VoiceStatus,
  VoiceLiveEvent,
  VoiceLiveStartInput,
  VoiceLiveStartView,
  VoiceLiveStatusView,
  VoiceLiveTurnMode,
  HomeState,
  LanguageOption,
  LessonDetail,
  LessonResultView,
  ModelInfo,
  NotebookView,
  OnboardingInput,
  PlacementResult,
  PlacementTest,
  ProfileState,
  ProfileView,
  ProfilesView,
  ProviderId,
  ProviderStatus,
  PrewarmCycleOutcome,
  PrewarmState,
  UpdateProfileInput,
  RecapView,
  ReminderTestResult,
  ReminderView,
  ReportInput,
  ReportKind,
  ReportItemView,
  ReportsSummary,
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
  TutorSendRequest,
  TutorTurnResult,
  UpdateCheckView,
  DbStatusView,
  LogPathView
} from '../shared/types'

const api = {
  /** M6: diagnóstico — versão, caminho do log e estado do banco no boot. */
  app: {
    info: (): Promise<{ version: string; name: string }> => ipcRenderer.invoke('app:info'),
    logPath: (): Promise<LogPathView> => ipcRenderer.invoke('log:get-path'),
    dbStatus: (): Promise<DbStatusView> => ipcRenderer.invoke('db:status')
  },
  settings: {
    get: (): Promise<SettingsPayload> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>): Promise<SettingsPayload> =>
      ipcRenderer.invoke('settings:update', patch),
    setGeminiKey: (key: string): Promise<SettingsPayload> =>
      ipcRenderer.invoke('settings:set-gemini-key', key),
    clearGeminiKey: (): Promise<SettingsPayload> => ipcRenderer.invoke('settings:clear-gemini-key')
  },
  /** M4: registro de idiomas (código, direção de escrita, tokenização). */
  languages: {
    list: (): Promise<LanguageOption[]> => ipcRenderer.invoke('languages:list')
  },
  models: {
    list: (provider: ProviderId): Promise<ModelInfo[]> => ipcRenderer.invoke('models:list', provider)
  },
  provider: {
    test: (provider: ProviderId): Promise<TestResult> => ipcRenderer.invoke('provider:test', provider),
    /** M5: último estado da sonda (com TTL) — não dispara rede se estiver fresco. */
    status: (): Promise<ProviderStatus> => ipcRenderer.invoke('provider:status'),
    /** Sonda forçada, para o botão "testar conexão". */
    probe: (): Promise<ProviderStatus> => ipcRenderer.invoke('provider:probe'),
    /** Mudanças de disponibilidade da IA chegam por aqui (banner offline). */
    onStatus: (callback: (status: ProviderStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: ProviderStatus): void => callback(status)
      ipcRenderer.on('provider:event', listener)
      return () => ipcRenderer.removeListener('provider:event', listener)
    }
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
    send: (request: TutorSendRequest): Promise<TutorTurnResult> => ipcRenderer.invoke('tutor:send', request),
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
  /** V2: múltiplos perfis — listar, trocar, criar, renomear, apagar. */
  profiles: {
    list: (): Promise<ProfilesView> => ipcRenderer.invoke('profile:list'),
    switch: (profileId: number): Promise<ProfilesView> => ipcRenderer.invoke('profile:switch', profileId),
    create: (input: CreateProfileInput = {}): Promise<ProfileState> =>
      ipcRenderer.invoke('profile:create', input),
    update: (input: UpdateProfileInput & { profileId?: number }): Promise<ProfileView> =>
      ipcRenderer.invoke('profile:update', input),
    remove: (input: {
      profileId: number
      acknowledged: true
    }): Promise<{ remaining: number; switchedTo: number | null }> =>
      ipcRenderer.invoke('profile:delete', input)
  },
  learning: {
    profile: {
      get: (): Promise<ProfileState> => ipcRenderer.invoke('profile:get'),
      onboard: (input: OnboardingInput): Promise<ProfileState> =>
        ipcRenderer.invoke('profile:onboard', input),
      /** Apaga a memória de aprendizado e volta ao estado de primeiro acesso. */
      resetMemory: (): Promise<ProfileState> => ipcRenderer.invoke('profile:reset-memory')
    },    placement: {
      generate: (
        input?: string | { goal?: string; targetLang?: string; nativeLang?: string }
      ): Promise<PlacementTest> => ipcRenderer.invoke('placement:generate', input),
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
      /** Gera de novo os exercícios da lição (o conteúdo fica). */
      regenerate: (lessonId: number): Promise<LessonDetail> =>
        ipcRenderer.invoke('lesson:regenerate', lessonId),
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
  },
  /** M5: painel de Progresso — tempo, vocabulário, erros, trilhas, cache e reports. */
  dashboard: {
    get: (): Promise<DashboardView> => ipcRenderer.invoke('dashboard:get')
  },
  /** M5: "reportar conteúdo ruim" — cada tipo tem efeito real (ver core/reports.ts). */
  report: {
    submit: (input: ReportInput): Promise<ReportItemView> => ipcRenderer.invoke('report:submit', input),
    undo: (reportId: number): Promise<ReportItemView | null> => ipcRenderer.invoke('report:undo', reportId),
    /** Desfaz o report mais recente sobre um alvo (ex.: reativar uma correção). */
    undoTarget: (kind: ReportKind, targetId: number): Promise<ReportItemView | null> =>
      ipcRenderer.invoke('report:undo-target', kind, targetId),
    list: (limit?: number): Promise<ReportsSummary> => ipcRenderer.invoke('report:list', limit)
  },
  /** V2: voz — status, síntese, correção de fala, frases e cache de áudio. */
  voice: {
    status: (): Promise<VoiceStatus> => ipcRenderer.invoke('voice:status'),
    speak: (input: { text: string; lang?: string; requestId?: string }): Promise<SpeechAudioView> =>
      ipcRenderer.invoke('voice:speak', input),
    grade: (input: SpeechGradeRequest): Promise<SpeechGradeView> => ipcRenderer.invoke('voice:grade', input),
    listen: (input: {
      exerciseId: number
      response: string
      target: string
      lessonId?: number | null
      latencyMs?: number
    }): Promise<ListeningResultView> => ipcRenderer.invoke('voice:listen', input),
    phrases: (limit?: number): Promise<VoicePhraseView[]> => ipcRenderer.invoke('voice:phrases', limit),
    dictate: (input: { mime: string; audio: string; requestId?: string }): Promise<{ ok: boolean; text: string; error?: string }> =>
      ipcRenderer.invoke('voice:dictate', input),
    history: (limit?: number): Promise<SpeechHistoryView> => ipcRenderer.invoke('voice:history', limit),
    cache: (): Promise<AudioCacheStats> => ipcRenderer.invoke('voice:cache'),
    clearCache: (): Promise<number> => ipcRenderer.invoke('voice:clear-cache')
  },
  /** V3: conversa por voz em tempo real (áudio do micro no main, eventos por push). */
  voiceLive: {
    status: (): Promise<VoiceLiveStatusView> => ipcRenderer.invoke('voiceLive:status'),
    start: (input: VoiceLiveStartInput = {}): Promise<VoiceLiveStartView> =>
      ipcRenderer.invoke('voiceLive:start', input),
    stop: (sessionId?: string): Promise<VoiceLiveStartView> => ipcRenderer.invoke('voiceLive:stop', sessionId),
    /** Frame PCM16 16 kHz em base64 (um chunk de ~100 ms do AudioWorklet). */
    audio: (input: { sessionId: string; audio: string }): Promise<boolean> =>
      ipcRenderer.invoke('voiceLive:audio', input),
    text: (input: { sessionId: string; text: string }): Promise<boolean> =>
      ipcRenderer.invoke('voiceLive:text', input),
    /** Troca VAD automático ⇄ push-to-talk na mesma chamada. */
    turnMode: (input: { sessionId: string; mode: VoiceLiveTurnMode }): Promise<VoiceLiveStartView> =>
      ipcRenderer.invoke('voiceLive:turn-mode', input),
    interrupt: (sessionId: string): Promise<boolean> => ipcRenderer.invoke('voiceLive:interrupt', sessionId),
    /** Push-to-talk: botão "falar" (abre) e "terminou" (fecha) o turno. */
    pushToTalk: (input: { sessionId: string; open: boolean }): Promise<boolean> =>
      ipcRenderer.invoke('voiceLive:push-to-talk', input),
    onEvent: (callback: (event: VoiceLiveEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: VoiceLiveEvent): void => callback(payload)
      ipcRenderer.on('voiceLive:event', listener)
      return () => ipcRenderer.removeListener('voiceLive:event', listener)
    }
  },
  /** V2: verificar se existe versão nova (abre a página da release, não instala). */
  update: {
    state: (): Promise<UpdateCheckView> => ipcRenderer.invoke('update:state'),
    check: (force?: boolean): Promise<UpdateCheckView> => ipcRenderer.invoke('update:check', force),
    open: (url?: string): Promise<boolean> => ipcRenderer.invoke('update:open', url)
  },
  /** V2: lembrete opt-in (convite, não cobrança). */
  reminder: {
    get: (): Promise<ReminderView> => ipcRenderer.invoke('reminder:get'),
    update: (patch: { enabled?: boolean; days?: number[]; time?: string | number }): Promise<ReminderView> =>
      ipcRenderer.invoke('reminder:update', patch),
    test: (): Promise<ReminderTestResult> => ipcRenderer.invoke('reminder:test')
  },
  /** V2 (E9): jobs longos com progresso e cancelamento. */
  job: {
    list: (): Promise<JobView[]> => ipcRenderer.invoke('job:list'),
    cancel: (jobId: string): Promise<boolean> => ipcRenderer.invoke('job:cancel', jobId),
    onEvent: (callback: (event: JobEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: JobEvent): void => callback(payload)
      ipcRenderer.on('job:event', listener)
      return () => ipcRenderer.removeListener('job:event', listener)
    }
  },
  /** V2: backup portável — exportar um perfil, conferir um arquivo, importar. */
  data: {
    export: (input: { profileId?: number; includeAudio?: boolean } = {}): Promise<ExportFileView> =>
      ipcRenderer.invoke('data:export', input),
    inspect: (input: { path?: string; json?: string } = {}): Promise<InspectView> =>
      ipcRenderer.invoke('data:inspect', input),
    pickFile: (): Promise<string | null> => ipcRenderer.invoke('data:pick-file'),
    import: (input: { path?: string; json?: string; name?: string | null; switch?: boolean }): Promise<ImportResultView> =>
      ipcRenderer.invoke('data:import', input),
    activeProfile: (): Promise<number> => ipcRenderer.invoke('data:active-profile')
  },
  /** M5: pré-geração e cache de conteúdo. */
  cache: {
    state: (): Promise<PrewarmState> => ipcRenderer.invoke('pregen:state'),
    /** Aquece agora (botão das Configurações). */
    warm: (): Promise<PrewarmCycleOutcome> => ipcRenderer.invoke('pregen:run'),
    stats: (): Promise<CacheStats> => ipcRenderer.invoke('cache:stats')
  }
}

contextBridge.exposeInMainWorld('api', api)
