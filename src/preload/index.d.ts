import type {
  AppSettings,
  ChatEvent,
  ConversationSummary,
  ConversationView,
  CurriculumView,
  DashboardView,
  FocusTrackView,
  GradeFeedback,
  GuidedSession,
  GuidedStep,
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
  ProviderId,
  ProviderStatus,
  PrewarmCycleOutcome,
  PrewarmState,
  RecapView,
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
  DbStatusView,
  LogPathView
} from '../shared/types'

declare global {
  interface Window {
    api: {
      /** M6: diagnóstico — versão, log rotativo e estado do banco no boot. */
      app: {
        info(): Promise<{ version: string; name: string }>
        logPath(): Promise<LogPathView>
        dbStatus(): Promise<DbStatusView>
      }
      settings: {
        get(): Promise<SettingsPayload>
        update(patch: Partial<AppSettings>): Promise<SettingsPayload>
        setGeminiKey(key: string): Promise<SettingsPayload>
        clearGeminiKey(): Promise<SettingsPayload>
      }
      /** M4: registro de idiomas para os seletores do onboarding/configurações. */
      languages: {
        list(): Promise<LanguageOption[]>
      }
      models: {
        list(provider: ProviderId): Promise<ModelInfo[]>
      }
      provider: {
        test(provider: ProviderId): Promise<TestResult>
        /** M5: estado da última sonda (TTL) — a UI lê antes de prometer geração. */
        status(): Promise<ProviderStatus>
        /** Sonda forçada (botão "testar conexão"). */
        probe(): Promise<ProviderStatus>
        /** Mudanças de disponibilidade da IA (banner offline). */
        onStatus(callback: (status: ProviderStatus) => void): () => void
      }
      tutor: {
        onEvent(callback: (event: ChatEvent) => void): () => void
        list(): Promise<ConversationSummary[]>
        latest(): Promise<ConversationSummary | null>
        open(conversationId: number): Promise<ConversationView>
        create(input?: { topic?: string | null; lessonId?: number | null }): Promise<ConversationView>
        send(request: TutorSendRequest): Promise<TutorTurnResult>
        cancel(requestId: string): Promise<void>
        close(conversationId: number): Promise<RecapView>
      }
      review: {
        state(limit?: number): Promise<ReviewState>
        answer(input: { cardId: number; rating: ReviewRating }): Promise<ReviewResult>
        fromErrors(): Promise<number>
      }
      notebook: {
        get(): Promise<NotebookView>
        resolve(errorId: number, resolved: boolean): Promise<void>
        resolveTag(tags: string[]): Promise<number>
      }
      guided: {
        active(): Promise<GuidedSession | null>
        start(): Promise<GuidedSession>
        step(step: GuidedStep): Promise<GuidedSession>
        reviewCount(done: number): Promise<GuidedSession>
        practice(practice: { correct: number; total: number }): Promise<GuidedSession>
        tutor(): Promise<GuidedSession>
        finish(input?: { reviewDone?: number; practice?: { correct: number; total: number } }): Promise<GuidedSession>
        abandon(): Promise<void>
      }
      learning: {
        profile: {
          get(): Promise<ProfileState>
          onboard(input: OnboardingInput): Promise<ProfileState>
          resetMemory(): Promise<ProfileState>
        }
        placement: {
          generate(
            input?: string | { goal?: string; targetLang?: string; nativeLang?: string }
          ): Promise<PlacementTest>
          submit(answers: number[]): Promise<PlacementResult>
        }
        curriculum: {
          get(): Promise<CurriculumView>
          generate(): Promise<CurriculumView>
        }
        lesson: {
          open(lessonId: number): Promise<LessonDetail>
          regenerate(lessonId: number): Promise<LessonDetail>
          answer(input: {
            exerciseId: number
            response: string
            latencyMs?: number
          }): Promise<GradeFeedback>
          finish(input: { lessonId: number; sessionId: number }): Promise<LessonResultView>
        }
        home: {
          get(): Promise<HomeState>
        }
      }
      tracks: {
        list(): Promise<TracksView>
        draft(input: { objective: string; replaceId?: number }): Promise<FocusTrackView>
        revise(input: { trackId: number; lessons: TrackPlanLesson[] }): Promise<FocusTrackView>
        approve(trackId: number): Promise<FocusTrackView>
        discard(trackId: number): Promise<void>
        status(input: { trackId: number; status: 'active' | 'archived' }): Promise<FocusTrackView>
      }
      scenario: {
        open(input: { lessonId?: number | null; topic?: string | null }): Promise<ScenarioSession>
        finish(conversationId: number): Promise<ScenarioFeedbackView>
        session(conversationId: number): Promise<ScenarioSession | null>
        runs(limit?: number): Promise<ScenarioRunView[]>
        refresh(lessonId: number): Promise<ScenarioView>
      }
      /** M5: painel de Progresso. */
      dashboard: {
        get(): Promise<DashboardView>
      }
      /** M5: reportar conteúdo ruim (efeito real + registro reversível). */
      report: {
        submit(input: ReportInput): Promise<ReportItemView>
        undo(reportId: number): Promise<ReportItemView | null>
        undoTarget(kind: ReportKind, targetId: number): Promise<ReportItemView | null>
        list(limit?: number): Promise<ReportsSummary>
      }
      /** M5: pré-geração e cache de conteúdo. */
      cache: {
        state(): Promise<PrewarmState>
        warm(): Promise<PrewarmCycleOutcome>
        stats(): Promise<CacheStats>
      }
    }
  }
}

export {}
