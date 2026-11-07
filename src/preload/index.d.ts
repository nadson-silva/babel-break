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
