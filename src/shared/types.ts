export type ProviderId = 'gemini' | 'ollama'

export type CorrectionStyle = 'recast' | 'explicit' | 'both'

export interface AppSettings {
  provider: ProviderId
  geminiModel: string
  ollamaModel: string
  ollamaBaseUrl: string
  correctionStyle: CorrectionStyle
  focusMix: number
  /** Idioma da interface (M4): 'pt-BR' (padrão) | 'en'. */
  uiLang: string
}

/**
 * Opção de idioma para o seletor do onboarding (M4). Metadados vindos do
 * registro do processo main (`core/languages.ts`) via IPC `languages:list`.
 */
export interface LanguageOption {
  code: string
  /** Nome em inglês (rótulo estável). */
  name: string
  /** Nome no próprio idioma ('日本語', 'español'…). */
  nativeName: string
  /** Nome em PT-BR, para textos do app. */
  promptName: string
  scriptDirection: 'ltr' | 'rtl'
  tokenization: 'space' | 'cjk'
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
  type: 'token' | 'done' | 'error' | 'cancelled' | 'corrections' | 'status'
  token?: string
  text?: string
  message?: string
  /** Correções calculadas para a mensagem do aluno (tipo 'corrections'). */
  corrections?: Correction[]
  /** Texto do aluno reescrito pelo tutor. */
  recast?: string
}

export interface TestResult {
  ok: boolean
  latencyMs: number
  detail?: string
  error?: string
}

export interface TutorSendRequest {
  requestId: string
  conversationId: number
  text: string
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
  /** M4: idioma ensinado (padrão 'en' para perfis antigos). */
  targetLang?: string
  /** M4: idioma das explicações (padrão 'pt-BR'). */
  nativeLang?: string
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

/** Par exemplo no idioma-alvo / tradução no idioma nativo (M4: nomes neutros). */
export interface LessonExample {
  target: string
  native: string
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
  /** Armadilhas de quem fala português, ligadas ao caderno de erros. */
  pitfalls?: LessonPitfall[]
  /** 'fallback' quando o conteúdo veio do gerador determinístico local. */
  source?: 'ai' | 'fallback'
}

export type LessonStatus = 'not_started' | 'in_progress' | 'completed'

export interface LessonSummary {
  id: number
  unitId: number | null
  unitTitle: string | null
  trackId: number | null
  trackTitle: string | null
  title: string
  level: CefrLevel
  position: number
  status: LessonStatus
  score: number | null
  hasContent: boolean
  /** Lição de trilha que fecha com roleplay. */
  isScenario: boolean
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
  /** Tags de erro que o exercício treina — visível no player (M2). */
  targetTags: string[]
}

export interface LessonDetail {
  lesson: LessonSummary
  content: LessonContentView
  exercises: ExerciseView[]
  /** Erros que esta lição está mirando (o loop visível). */
  focus: LessonFocus[]
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
  /** Cards SRS criados a partir do vocabulário e dos erros desta lição. */
  cardsCreated: number
  levelChange?: { from: CefrLevel; to: CefrLevel } | null
}

export interface HomeState {
  profile: ProfileView
  curriculumReady: boolean
  continueLesson: LessonSummary | null
  nextLesson: LessonSummary | null
  units: UnitView[]
  completedCount: number
  totalCount: number
  /** SRS em modo pull: acumula em silêncio, nunca cobra. */
  review: { due: number; total: number; newCount: number }
  notebook: { open: number; tags: { tag: string; occurrences: number }[] }
  continueConversation: ConversationSummary | null
  guided: GuidedSession | null
  /** Trilhas ativas + próximo passo sugerido, já com o mix de foco aplicado. */
  tracks: FocusTrackView[]
  suggestion: NextSuggestion | null
}

// --- Trilhas de foco e cenário (M3) ------------------------------------------

export type TrackStatus = 'draft' | 'active' | 'archived'

export type TrackSource = 'user' | 'suggested'

export interface TrackPlanLesson {
  title: string
  objective: string
  focusVocabulary: string[]
}

export interface TrackPlanDraft {
  title: string
  goalTag: string
  objective: string
  level: CefrLevel
  levelRange: string
  lessons: TrackPlanLesson[]
  /** 'fallback' quando o esboço veio do banco determinístico, sem IA. */
  source: 'ai' | 'fallback'
}

export interface TrackSuggestionView {
  title: string
  objective: string
  goalTag: string
}

export interface FocusTrackView {
  id: number
  title: string
  objective: string | null
  goalTag: string | null
  levelRange: string | null
  status: TrackStatus
  source: TrackSource
  createdAt: number
  approvedAt: number | null
  /** Esboço revisável: existe desde o rascunho, antes de virar lição. */
  plan: TrackPlanDraft | null
  lessons: LessonSummary[]
  completedCount: number
  totalCount: number
  nextLesson: LessonSummary | null
  scenarioLesson: LessonSummary | null
}

export interface TracksView {
  active: FocusTrackView[]
  drafts: FocusTrackView[]
  archived: FocusTrackView[]
  suggestions: TrackSuggestionView[]
  focusMix: number
}

export interface NextSuggestion {
  lesson: LessonSummary
  /** De onde veio a sugestão: currículo base ou trilha de foco. */
  origin: 'base' | 'focus'
  reason: string
}

export interface ScenarioView {
  persona: string
  setting: string
  successCriteria: string[]
  openingLine: string
  source: 'ai' | 'fallback'
}

export interface ScenarioPhrase {
  original: string
  improved: string
  reason: string
}

export interface ScenarioFeedbackView {
  runId: number
  conversationId: number
  lessonId: number | null
  contentScore: number
  languageScore: number
  feedback: string
  bestPhrases: ScenarioPhrase[]
  followUpDrill: string
  /** Tarefas cumpridas da rubrica (para exibir checklist marcado). */
  criteria: { criterion: string; met: boolean }[]
  cardsCreated: number
  levelChange: { from: CefrLevel; to: CefrLevel } | null
  source: 'ai' | 'fallback'
  createdAt: number
}

export interface ScenarioRunView {
  id: number
  lessonId: number | null
  lessonTitle: string | null
  conversationId: number
  contentScore: number | null
  languageScore: number | null
  feedback: string | null
  createdAt: number
}

export interface ScenarioSession {
  conversation: ConversationSummary
  scenario: ScenarioView
  run: ScenarioFeedbackView | null
}

// --- O loop (M2) -------------------------------------------------------------

export type CorrectionSource = 'bank' | 'ai' | 'local'

export type ConversationMode = 'free' | 'scenario'

export interface Correction {
  original: string
  corrected: string
  tag: string
  note?: string
  source: CorrectionSource
}

export interface TutorMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  corrections: Correction[]
}

export interface ConversationSummary {
  id: number
  topic: string | null
  mode: ConversationMode
  lessonId: number | null
  lessonTitle: string | null
  createdAt: number
  lastMessageAt: number
  messageCount: number
  closed: boolean
}

export interface ConversationView {
  conversation: ConversationSummary
  messages: TutorMessage[]
  summary: string | null
  /** Presente quando a conversa é um roleplay (M3). */
  scenario: ScenarioView | null
}

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export interface CardInterval {
  rating: ReviewRating
  label: string
}

export interface CardView {
  id: number
  kind: 'vocab' | 'phrase' | 'error'
  front: string
  back: string
  hint: string | null
  tag: string | null
  lessonId: number | null
  state: CardState
  due: number
  dueLabel: string
  reps: number
  lapses: number
  intervals: CardInterval[]
}

export interface ReviewState {
  /** Vencidos, já ordenados (mais atrasados primeiro). */
  due: CardView[]
  dueCount: number
  newCount: number
  total: number
  reviewedToday: number
  learningCount: number
}

export interface ReviewResult {
  cardId: number
  rating: ReviewRating
  nextDueLabel: string
  dueCount: number
  reviewedToday: number
}

export interface NotebookExample {
  id: number
  original: string
  corrected: string
  note: string | null
  lastSeenAt: number
  /** De onde o erro veio: exercício, chat com o tutor, sessão guiada. */
  category: string
  /** Quem corrigiu: banco PT-BR, IA ou corretor local do exercício. */
  source: string | null
}

export interface NotebookTag {
  tag: string
  occurrences: number
  resolved: boolean
  lastSeenAt: number
  examples: NotebookExample[]
}

export interface NotebookView {
  tags: NotebookTag[]
  openCount: number
  resolvedCount: number
  /** Banco de interferência do par nativo→alvo (referência + fixtures). */
  bank: { tag: string; wrong: string; right: string; note: string }[]
  /** Quantas ocorrências o app já corrigiu via banco, sem gastar token. */
  bankHits: number
  /**
   * M4: o par que o banco cobre; null = sem banco manual para este par e a
   * correção é feita pela IA (a UI diz isso em vez de prometer "banco PT-BR").
   */
  bankPair: { native: string; target: string } | null
}

export interface LessonPitfall {
  tag: string
  wrong: string
  right: string
  note: string
}

export interface LessonFocus {
  tag: string
  occurrences: number
  original: string
  corrected: string
  note: string | null
  source: 'student' | 'bank'
}

export type GuidedStep = 'review' | 'lesson' | 'practice' | 'tutor' | 'recap'

/** Recapitulação de uma sessão/conversa: correções → cards → tags. */
export interface RecapView {
  corrections: Correction[]
  tags: string[]
  cardsCreated: number
  reviewDone?: number
  practice?: { correct: number; total: number }
  levelChange: { from: CefrLevel; to: CefrLevel } | null
  message: string
  /** Rubrica do roleplay, quando o fechamento incluiu um cenário (M3). */
  scenario?: ScenarioFeedbackView | null
}

export interface GuidedSession {
  id: number
  step: GuidedStep
  lessonId: number | null
  lessonTitle: string | null
  conversationId: number | null
  review: { dueCount: number; done: number }
  practice: { correct: number; total: number }
  startedAt: number
  recap: RecapView | null
  /** Passo 4 é roleplay com rubrica (lição de trilha marcada para cenário). */
  isScenario: boolean
}

