import type {
  AppSettings,
  ChatEvent,
  ConversationSummary,
  ConversationView,
  CurriculumView,
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
  SettingsPayload,
  TestResult,
  TutorSendRequest
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
      tutor: {
        onEvent(callback: (event: ChatEvent) => void): () => void
        list(): Promise<ConversationSummary[]>
        latest(): Promise<ConversationSummary | null>
        open(conversationId: number): Promise<ConversationView>
        create(input?: { topic?: string | null; lessonId?: number | null }): Promise<ConversationView>
        send(request: TutorSendRequest): Promise<void>
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
        }
        placement: {
          generate(goal?: string): Promise<PlacementTest>
          submit(answers: number[]): Promise<PlacementResult>
        }
        curriculum: {
          get(): Promise<CurriculumView>
          generate(): Promise<CurriculumView>
        }
        lesson: {
          open(lessonId: number): Promise<LessonDetail>
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
    }
  }
}

export {}
