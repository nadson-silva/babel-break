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
  UpdateProfileInput,
  ProviderStatus,
  PrewarmCycleOutcome,
  PrewarmState,
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
  DbStatusView,
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
      /** V2: múltiplos perfis (criar, trocar, renomear, apagar). */
      profiles: {
        list(): Promise<ProfilesView>
        switch(profileId: number): Promise<ProfilesView>
        create(input?: CreateProfileInput): Promise<ProfileState>
        update(input: UpdateProfileInput & { profileId?: number }): Promise<ProfileView>
        remove(input: { profileId: number; acknowledged: true }): Promise<{
          remaining: number
          switchedTo: number | null
        }>
      }
      /** V2: backup portável (exportar, conferir, importar). */
      data: {
        export(input?: { profileId?: number; includeAudio?: boolean }): Promise<ExportFileView>
        inspect(input?: { path?: string; json?: string }): Promise<InspectView>
        pickFile(): Promise<string | null>
        import(input: { path?: string; json?: string; name?: string | null; switch?: boolean }): Promise<ImportResultView>
        activeProfile(): Promise<number>
      }
      /** V2: voz (TTS/ASR/pronúncia) e cache de áudio. */
      voice: {
        status(): Promise<VoiceStatus>
        speak(input: { text: string; lang?: string; requestId?: string }): Promise<SpeechAudioView>
        grade(input: SpeechGradeRequest): Promise<SpeechGradeView>
        listen(input: {
          exerciseId: number
          response: string
          target: string
          lessonId?: number | null
          latencyMs?: number
        }): Promise<ListeningResultView>
        phrases(limit?: number): Promise<VoicePhraseView[]>
        dictate(input: { mime: string; audio: string; requestId?: string }): Promise<{ ok: boolean; text: string; error?: string }>
        history(limit?: number): Promise<SpeechHistoryView>
        cache(): Promise<AudioCacheStats>
        clearCache(): Promise<number>
      }
      /** V3: conversa por voz em tempo real. */
      voiceLive: {
        status(): Promise<VoiceLiveStatusView>
        start(input?: VoiceLiveStartInput): Promise<VoiceLiveStartView>
        stop(sessionId?: string): Promise<VoiceLiveStartView>
        audio(input: { sessionId: string; audio: string }): Promise<boolean>
        text(input: { sessionId: string; text: string }): Promise<boolean>
        turnMode(input: { sessionId: string; mode: VoiceLiveTurnMode }): Promise<VoiceLiveStartView>
        interrupt(sessionId: string): Promise<boolean>
        pushToTalk(input: { sessionId: string; open: boolean }): Promise<boolean>
        onEvent(callback: (event: VoiceLiveEvent) => void): () => void
      }
      /** V2: lembrete opt-in. */
      reminder: {
        get(): Promise<ReminderView>
        update(patch: { enabled?: boolean; days?: number[]; time?: string | number }): Promise<ReminderView>
        test(): Promise<ReminderTestResult>
      }
      /** V2 (E9): jobs longos com progresso e cancelamento. */
      job: {
        list(): Promise<JobView[]>
        cancel(jobId: string): Promise<boolean>
        onEvent(callback: (event: JobEvent) => void): () => void
      }
      /** V2: versão nova? (informar com link, nunca instalar sozinho) */
      update: {
        state(): Promise<UpdateCheckView>
        check(force?: boolean): Promise<UpdateCheckView>
        open(url?: string): Promise<boolean>
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
