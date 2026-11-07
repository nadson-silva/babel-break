export type ProviderId = 'gemini' | 'ollama'

export type CorrectionStyle = 'recast' | 'explicit' | 'both'

export interface AppSettings {
  provider: ProviderId
  geminiModel: string
  ollamaModel: string
  ollamaBaseUrl: string
  correctionStyle: CorrectionStyle
  focusMix: number
}

export interface SecureStorageInfo {
  available: boolean
  backend?: string
}

export interface RuntimeInfo {
  electron: string
  chrome: string
  node: string
  platform: string
}

export interface SettingsPayload extends AppSettings {
  hasGeminiKey: boolean
  secureStorage: SecureStorageInfo
  runtime: RuntimeInfo
}

export interface ModelInfo {
  id: string
  label: string
  description?: string
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatEvent {
  requestId: string
  type: 'token' | 'done' | 'error' | 'cancelled'
  token?: string
  text?: string
  message?: string
}

export interface TestResult {
  ok: boolean
  latencyMs: number
  detail?: string
  error?: string
}

export interface ChatSendRequest {
  requestId: string
  provider: ProviderId
  model: string
  messages: ChatMessage[]
}

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

// --- Aprendizado (M1) -------------------------------------------------------

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1'

export type SkillId = 'reading' | 'writing' | 'listening' | 'speaking' | 'vocab' | 'grammar'

export type ExerciseType =
  | 'multiple_choice'
  | 'cloze'
  | 'translate'
  | 'order'
  | 'free_production'

export interface ProfileView {
  id: number
  targetLang: string
  nativeLang: string
  goal: string | null
  cefr: CefrLevel | null
  focusMix: number
  placementScore: number | null
  onboardingComplete: boolean
}

export interface SkillEstimate {
  skill: SkillId
  estimate: number
  confidence: number
}

export interface ProfileState {
  profile: ProfileView
  skills: SkillEstimate[]
  curriculumReady: boolean
}

export interface OnboardingInput {
  goal: string
  cefr: CefrLevel
}

export interface PlacementQuestion {
  id: string
  level: CefrLevel
  prompt: string
  options: string[]
}

export interface PlacementTest {
  createdAt: number
  questions: PlacementQuestion[]
}

export interface PlacementResult {
  cefr: CefrLevel
  correct: number
  total: number
  score: number
}

export interface LessonExample {
  en: string
  pt: string
}

export interface LessonVocabularyItem {
  term: string
  translation: string
  example: string
}

export interface LessonGrammarPoint {
  title: string
  explanation: string
  examples: string[]
}

export interface LessonContentView {
  title: string
  level: CefrLevel
  objective: string
  explanation: string
  examples: LessonExample[]
  grammarPoints: LessonGrammarPoint[]
  vocabulary: LessonVocabularyItem[]
  /** 'fallback' quando o conteúdo veio do gerador determinístico local. */
  source?: 'ai' | 'fallback'
}

export type LessonStatus = 'not_started' | 'in_progress' | 'completed'

export interface LessonSummary {
  id: number
  unitId: number | null
  unitTitle: string | null
  title: string
  level: CefrLevel
  position: number
  status: LessonStatus
  score: number | null
  hasContent: boolean
}

export interface UnitView {
  id: number
  title: string
  description: string | null
  level: CefrLevel
  position: number
  lessons: LessonSummary[]
}

export interface CurriculumView {
  units: UnitView[]
  generated: boolean
}

export interface ExerciseView {
  id: number
  type: ExerciseType
  instruction: string
  prompt: string
  options: string[]
  tokens: string[]
  source: 'ai' | 'fallback' | null
}

export interface LessonDetail {
  lesson: LessonSummary
  content: LessonContentView
  exercises: ExerciseView[]
  sessionId: number
}

export interface GradeFeedback {
  correct: boolean
  score: number
  feedback: string
  corrected?: string
  errorTags: string[]
}

export interface LessonResultView {
  lessonId: number
  score: number
  correct: number
  total: number
}

export interface HomeState {
  profile: ProfileView
  curriculumReady: boolean
  continueLesson: LessonSummary | null
  nextLesson: LessonSummary | null
  units: UnitView[]
  completedCount: number
  totalCount: number
}
