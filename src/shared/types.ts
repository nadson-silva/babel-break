import type { ReportEffect, ReportKind, ReportReason } from './report-reasons'

// Reexport para quem importa a superfície inteira de `shared/types` (preload e
// telas): os tipos de report continuam com uma única fonte em `report-reasons`.
export type { ReportEffect, ReportKind, ReportReason } from './report-reasons'

export type ProviderId = 'gemini' | 'ollama'

export type CorrectionStyle = 'recast' | 'explicit' | 'both'

/**
 * Papel de modelo (v1 pendência §3, entregue na v2): nem toda tarefa quer o
 * mesmo modelo. Corrigir e resumir pedem rápido; gerar currículo e lição pedem
 * forte; voz tem modelo próprio (TTS) e outro para transcrição.
 */
export type ModelRole = 'chat' | 'quick' | 'strong' | 'tts' | 'asr'

/** Ritmo da fala sintetizada. */
export type SpeechRate = 'slow' | 'normal' | 'fast'

export interface AppSettings {
  provider: ProviderId
  geminiModel: string
  ollamaModel: string
  ollamaBaseUrl: string
  correctionStyle: CorrectionStyle
  focusMix: number
  /** Idioma da interface (M4): 'pt-BR' (padrão) | 'en'. */
  uiLang: string
  /** M5: pré-gerar o próximo conteúdo provável quando o app está ocioso. */
  pregenerate: boolean
  /**
   * V2: modelos por papel. Vazio = usar o modelo do provedor (`chat`).
   * `quick` manda em correção/nota/resumo; `strong` em currículo/lição/trilha/cenário.
   */
  quickModel: string
  strongModel: string
  /** V2: voz. `voiceEnabled` desliga a prática de fala inteira (UI + geração). */
  voiceEnabled: boolean
  /** Modelo TTS do provedor (Gemini). Vazio = padrão do provedor. */
  ttsModel: string
  /** Modelo de transcrição. Vazio = `quick` (que costuma ser o flash). */
  asrModel: string
  /** Nome da voz prebuilt (Kore, Puck…) — chave estável, exibida como está. */
  voiceName: string
  speechRate: SpeechRate
  /** Usa a voz do sistema (Web Speech) em vez de gastar token no provedor. */
  preferSystemVoices: boolean
}

/**
 * Papel de modelo resolvido no main (v2). O **rótulo** não vem daqui: é texto de
 * interface, vive no dicionário do renderer (`t.settings.role*`).
 */
export interface ModelRoleView {
  role: 'chat' | 'quick' | 'strong'
  /** O modelo de fato em uso para aquele papel. */
  resolved: string
  /** Override gravado nas settings; vazio = herdado do provedor. */
  override: string
  inherited: boolean
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
  /** V2: modelo realmente usado em cada papel (chat/quick/strong). */
  roles: ModelRoleView[]
  /** V2: o que o provedor atual consegue fazer com voz. */
  voice: VoiceStatus
  /** V2: modelos TTS listados pelo provedor (vazio = só o padrão). */
  ttsModels: string[]
  /** V2: vozes disponíveis (catálogo do provedor). */
  voices: string[]
  /** V2: dá para usar a voz do sistema aqui? (o renderer responde de verdade) */
  systemVoicesPossible: boolean
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
  /**
   * M6 (E4): a conversa dona do evento. O canal `chat:event` é global — sem
   * isto, trocar de conversa no meio de um turno despejava correção/token no
   * chat errado.
   */
  conversationId?: number
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

/** Resultado da pré-condição de `tutor:send` (M6/B9) — eventos continuam no `ChatEvent`. */
export interface TutorTurnResult {
  ok: boolean
  error?: string
}

/** M6 (C10): caminho do log rotativo do processo main, para relatório de bug. */
export interface LogPathView {
  path: string
}

/** M6 (C4): estado do banco no último boot — `recovered` aciona a tela de recuperação. */
export interface DbStatusView {
  ok: boolean
  recovered: boolean
  /** Arquivo `.db` corrompido posto de lado (com os irmãos WAL/SHM) — backup para investigação. */
  backupPath: string | null
  error: string | null
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
  /** V2 (voz): ouvir o áudio e escolher/transcrever o que ouviu. */
  | 'listen_repeat'
  /** V2 (voz): ler a frase em voz alta e receber score de pronúncia. */
  | 'speak_sentence'

export interface ProfileView {
  id: number
  /** V2: identidade escolhida pelo usuário; sem nome a UI deriva do idioma-alvo. */
  name: string | null
  /** Chave de cor do avatar (ver `PROFILE_COLORS` no main). */
  color: string | null
  targetLang: string
  nativeLang: string
  goal: string | null
  cefr: CefrLevel | null
  focusMix: number
  placementScore: number | null
  onboardingComplete: boolean
  createdAt: number
  lastUsedAt: number | null
}

/** V2: um perfil na lista do seletor/tela de perfis, com o peso da memória dele. */
export interface ProfileSummary extends ProfileView {
  /** Quantas lições concluídas (o rótulo "3 lições" do seletor). */
  completedLessons: number
  /** Cards na fila de revisão do perfil. */
  dueCards: number
  /** Erros abertos no caderno do perfil. */
  openErrors: number
  /** Trilhas ativas deste perfil. */
  activeTracks: number
  active: boolean
}

/** V2: payload de `profile:list` — a tela de perfis não consulta o banco. */
export interface ProfilesView {
  profiles: ProfileSummary[]
  activeProfileId: number
  colors: string[]
  /** Perfil único = sem seletor na UI (v1 continua parecendo v1). */
  multiProfile: boolean
}

export interface CreateProfileInput {
  name?: string | null
  color?: string | null
  targetLang?: string
  nativeLang?: string
  goal?: string
  cefr?: CefrLevel
}

export interface UpdateProfileInput {
  name?: string | null
  color?: string | null
  goal?: string | null
  focusMix?: number
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
  /** V2: nome do perfil criado no onboarding (o "Perfil da Ana"). */
  name?: string | null
  /** V2: cor do avatar escolhida no onboarding. */
  color?: string | null
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
  /** M6 (D1): carimbo do contrato de prompt/schema com que o cache foi gravado. */
  promptVersion?: number
  schemaVersion?: number
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
  /** Lição dona (V2: histórico de voz e drills apontam para ela). */
  lessonId: number | null
  instruction: string
  prompt: string
  options: string[]
  tokens: string[]
  source: 'ai' | 'fallback' | null
  /** Tags de erro que o exercício treina — visível no player (M2). */
  targetTags: string[]
  /**
   * V2: texto que o áudio deste exercício deve dizer. `listen_repeat` toca isto
   * (o enunciado não revela a resposta); `speak_sentence` é o que o aluno lê.
   */
  speechText: string | null
  /** Tradução/apoio da frase falada, quando existe. */
  speechHint: string | null
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
  /** M5: o aluno marcou esta correção como injusta (sai do foco das lições). */
  disputed: boolean
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
  /** Correções disputadas: continua no caderno, mas o app parou de usá-las. */
  disputedCount: number
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


// --- M5: produto (dashboard, cache, offline, reportar conteúdo ruim) ---------
//
// Os tipos de report (kind/motivo/efeito) moram em `./report-reasons`: o menu do
// renderer e o efeito no processo main precisam das MESMAS chaves.


/**
 * Reportar conteúdo ruim (PLANO §11: "botão 'essa correção foi injusta' que
 * recalibra"). Cada tipo tem um efeito real sobre o modelo do aluno — ver
 * `core/reports.ts`.
 */
export interface ReportInput {
  kind: ReportKind
  /** Id do alvo (exercício, lição, erro do caderno, trilha, conversa). */
  targetId: number | null
  reason: ReportReason
  note?: string
  /** Snapshot do conteúdo reportado: o banco é o registro, não a UI. */
  context?: { text?: string; replacement?: string; tag?: string }
}

export interface ReportItemView {
  id: number
  kind: ReportKind
  targetId: number | null
  reason: ReportReason
  note: string | null
  effect: ReportEffect
  /** Rótulo do alvo no momento do report (título da lição, tag do erro…). */
  targetLabel: string | null
  /** Snapshot do conteúdo reportado (o trecho que o aluno achou ruim). */
  text: string | null
  replacement: string | null
  createdAt: number
  undoneAt: number | null
}

export interface ReportsSummary {
  total: number
  byKind: { kind: ReportKind; count: number }[]
  recent: ReportItemView[]
}

export interface ProviderStatus {
  provider: ProviderId
  model: string
  /** 'ok' | sem modelo | sem chave | provedor inacessível | sondando. */
  state: 'ok' | 'no-model' | 'no-key' | 'unreachable' | 'probing'
  reachable: boolean
  /** true = roda na máquina (Ollama): funciona sem internet; false = nuvem. */
  local: boolean
  detail: string | null
  latencyMs: number | null
  checkedAt: number | null
}

export interface CacheStats {
  /** Lições com conteúdo salvo (abrem offline, sem gastar token). */
  lessonsCached: number
  lessonsTotal: number
  /** Lições aquecidas pela pré-geração, não por abertura do aluno. */
  prewarmedLessons: number
  exercisesCached: number
  /** Exercícios removidos por report de conteúdo ruim. */
  exercisesHidden: number
  scenariosCached: number
  dbBytes: number
}

export type StudyKind = 'lesson' | 'conversation' | 'guided' | 'review'

export interface PrewarmOutcome {
  at: number
  lessonId: number | null
  lessonTitle: string | null
  /** O que foi aquecido nesta rodada. */
  warmed: { content: number; exercises: number; scenarios: number }
  /** 'ai' | 'fallback' | 'skip' (nada a fazer) | 'unavailable' (IA fora). */
  source: 'ai' | 'fallback' | 'skip' | 'unavailable'
  detail: string | null
}

/** Resultado de um ciclo de aquecimento (o `attempted` conta itens da fila). */
export interface PrewarmCycleOutcome extends PrewarmOutcome {
  attempted: number
}

export interface PrewarmState extends CacheStats {
  enabled: boolean
  running: boolean
  lastOutcome: PrewarmOutcome | null
  ai: ProviderStatus
}

export interface DashboardActivityDay {
  /** 'aaaa-mm-dd' no fuso local. */
  day: string
  minutes: number
  exercises: number
  reviews: number
}

export interface DashboardTime {
  totalMinutes: number
  last7DaysMinutes: number
  last30DaysMinutes: number
  /** Dias distintos com prática — substitui streak: nada a quebrar. */
  practiceDays: number
  daysSinceLastActivity: number | null
  lastActivityAt: number | null
  perDay: DashboardActivityDay[]
  byKind: { kind: StudyKind; minutes: number; sessions: number }[]
}

export interface DashboardLessons {
  completed: number
  inProgress: number
  total: number
  averageScore: number | null
  cached: number
  prewarmed: number
}

export interface VocabularyCardView {
  term: string
  translation: string
  reps: number
  lapses: number
  stability: number
  /** Estimativa de retenção do FSRS agora (0–1), quando o card já foi revisado. */
  retention: number | null
}

export interface DashboardVocabulary {
  total: number
  fresh: number
  learning: number
  /** Cards em revisão espaçada consolidada (state 'review'). */
  mastered: number
  due: number
  reviews30Days: number
  /** Fração das revisões dos últimos 30 dias que não foram "de novo". */
  passRate: number | null
  strongest: VocabularyCardView[]
}

export interface DashboardErrorInsight {
  open: number
  resolved: number
  /** Correções que o aluno marcou como injustas (saem do foco das lições). */
  disputed: number
  bankHits: number
  resolvedRate: number | null
  topTags: { tag: string; occurrences: number; lastSeenAt: number; disputed: boolean }[]
}

export interface DashboardTrack {
  id: number
  title: string
  completed: number
  total: number
  scenarios: number
  avgContentScore: number | null
  avgLanguageScore: number | null
  lastActivityAt: number | null
}

// --- V2: backup portável (export/import) ------------------------------------

/** O que o app mostra sobre um arquivo de backup, antes de decidir importá-lo. */
export interface ExportManifestView {
  kind: 'profile' | 'app'
  /** Versão do formato do arquivo. */
  format: number
  schemaVersion: number
  promptVersion: number
  /** Nº de migrações aplicadas quando o arquivo foi gravado. */
  dbVersion: number
  appVersion: string
  exportedAt: number
  includesAudio: boolean
  audioRows: number
  profile: {
    name: string | null
    color: string | null
    targetLang: string
    nativeLang: string
    goal: string | null
    cefr: string | null
    focusMix: number
    placementScore: number | null
    onboardingCompletedAt: number | null
  }
  counts: Record<string, number>
  /** Conteúdo que o app trata como velho: vai pela fila de regeneração. */
  stale: { lessonContent: number; exercises: number }
}

/** Por que um backup não entra. Cada código tem uma frase na UI. */
export type InspectFailure =
  | 'no-source'
  | 'not-json'
  | 'shape'
  | 'unknown-app'
  | 'format-version'
  | 'schema-version'
  | 'orphan-rows'
  | 'too-large'

export type InspectView =
  | {
      ok: true
      manifest: ExportManifestView
      counts: Record<string, number>
      warnings: string[]
      notes: string[]
    }
  | { ok: false; code: InspectFailure; errors: string[] }

export interface ExportFileView {
  /** O usuário canceou o diálogo — não é erro. */
  cancelled: boolean
  path: string | null
  bytes: number
  manifest: ExportManifestView
}

export interface ImportResultView {
  profileId: number
  name: string | null
  targetLang: string
  nativeLang: string
  counts: Record<string, number>
  /** Linhas descartadas por id de fora do arquivo (nunca meia entrada). */
  warnings: string[]
  audioSkipped: number
  stale: { lessonContent: number; exercises: number }
}

// --- V2: voz (TTS + ASR + score de pronúncia) e jobs nomeados ----------------

/** Tipos de trabalho longo que a v2 expõe como job cancelável. */
export type JobKind =
  | 'voice:tts'
  | 'voice:asr'
  | 'voice:grade'
  | 'lesson:generate'
  | 'curriculum:generate'
  | 'track:draft'

export type JobState = 'queued' | 'progress' | 'done' | 'error' | 'cancelled'

export interface JobEvent {
  id: string
  kind: JobKind
  profileId: number
  label: string
  state: JobState
  /** 0–1 quando se sabe; jobs de streaming às vezes só sabem "andando". */
  progress?: number
  message?: string
  at: number
  requestId?: string
  durationMs?: number
}

export interface JobView {
  id: string
  kind: JobKind
  profileId: number
  label: string
  progress: number
  startedAt: number
}

/** O que o app consegue fazer com voz, agora, no provedor do aluno. */
export interface VoiceStatus {
  provider: ProviderId
  /** Síntese de fala disponível (provedor com TTS configurado). */
  tts: boolean
  /** Transcrição de fala disponível (provedor que aceita áudio). */
  asr: boolean
  /** Modelo/voz usados, para a UI dizer a verdade. */
  ttsModel: string
  asrModel: string
  voice: string
  voices: string[]
  /** O provedor atual tem capacidade de fala alguma. */
  mode: 'provider' | 'none'
  detail: string | null
}

/** Resposta de `voice:speak`: áudio pronto para tocar. */
export interface SpeechAudioView {
  ok: boolean
  /** `data:audio/wav;base64,…` quando o provedor sintetizou. */
  dataUrl: string | null
  mime: string | null
  durationMs: number
  /** 'cache' = veio do SQLite (offline, sem token); 'provider' = gerado agora. */
  source: 'cache' | 'provider' | 'none'
  error?: string
}

/** Uma tentativa de fala do aluno. */
export interface SpeechGradeView {
  runId: number
  kind: 'speak' | 'listen'
  target: string
  transcript: string | null
  /** 0–1 (escala única do app). */
  score: number
  accuracy: number
  precision: number
  confidence: number
  words: PronunciationWordView[]
  extraWords: number
  transcriptEmpty: boolean
  tags: string[]
  /** Frase honesta no idioma das explicações ("Pronúncia: 82% …"). */
  summary: string
  source: 'provider' | 'none'
  asrModel: string | null
  latencyMs: number
  /** Skill afetada: speaking (fala) ou listening (ouvido). */
  skill: 'speaking' | 'listening'
  passed: boolean
}

export interface PronunciationWordView {
  text: string
  status: 'ok' | 'near' | 'wrong' | 'missing' | 'extra'
  heard?: string
}

/** Uma frase oferecida pela prática de voz (lição recente ou caderno de erros). */
export interface VoicePhraseView {
  target: string
  native: string | null
  origin: string | null
  source: 'lesson' | 'error'
}

export interface SpeechRunView {
  id: number
  kind: 'speak' | 'listen'
  target: string
  transcript: string | null
  score: number | null
  skill: 'speaking' | 'listening'
  lessonId: number | null
  lessonTitle: string | null
  createdAt: number
  source: string
}

/** Estatísticas do cache de áudio do perfil (Configurações). */
export interface AudioCacheStats {
  rows: number
  bytes: number
  max: number
}

export interface SpeechHistoryView {
  runs: SpeechRunView[]
  /** Médias por skill, no formato do painel (0–1). */
  speakingAverage: number | null
  listeningAverage: number | null
  total: number
}

/** Pedido de correção de fala vindo do renderer (áudio já gravado). */
export interface SpeechGradeRequest {
  /** `audio/wav` ou `audio/webm` — o main converte o que der. */
  mime: string
  /** base64 sem data URL. */
  audio: string
  target: string
  kind: 'speak' | 'listen'
  lessonId?: number | null
  exerciseId?: number | null
  requestId?: string
  /** 'answer' = o aluno digitou em vez de gravar (listening sem microfone). */
  typedAnswer?: string
}

/** Resultado de `voice:listen-check` (compreensão sem microfone). */
export interface ListeningResultView {
  ok: boolean
  correct: boolean
  score: number
  runId: number
  feedback: string
  error?: string
}

export interface DashboardView {
  generatedAt: number
  profile: ProfileView
  skills: SkillEstimate[]
  lessons: DashboardLessons
  time: DashboardTime
  vocabulary: DashboardVocabulary
  errors: DashboardErrorInsight
  tracks: DashboardTrack[]
  scenarios: { runs: number; avgContentScore: number | null; avgLanguageScore: number | null }
  reports: ReportsSummary
  cache: CacheStats
  ai: ProviderStatus
}
