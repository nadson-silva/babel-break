import type {
  ChatMessage,
  ModelInfo,
  ProviderId,
  SpeechRate,
  TestResult,
  VoiceLiveTurnMode
} from '../../shared/types'

export interface StreamRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  signal?: AbortSignal
  /** V2: papel do modelo — quando presente, o main resolve o modelo por papel. */
  role?: 'chat' | 'quick' | 'strong'
}

export interface GenerateRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  signal?: AbortSignal
  /** Pede ao provedor uma resposta em JSON (quando suportado nativamente). */
  json?: boolean
}

export interface SpeakRequest {
  model: string
  /** Nome da voz prebuilt (Kore, Puck…) ou id de voz própria do provedor. */
  voice: string
  text: string
  lang: string
  rate: SpeechRate
  signal?: AbortSignal
}

export interface SpeakResult {
  /** `audio/pcm;rate=24000`, `audio/wav`, `audio/ogg;codecs=opus`… */
  mimeType: string
  data: Buffer
}

export interface TranscribeRequest {
  model: string
  audio: Buffer
  mimeType: string
  lang: string
  /** Contexto para o transcritor: a frase esperada (aumenta a precisão). */
  hint?: string
  signal?: AbortSignal
}

/**
 * V2 — capacidade de fala do provedor. É opcional de propósito: Ollama não
 * transcreve nem sintetiza, e o app degrada com honestidade (voz do sistema para
 * ouvir, sem score de pronúncia) em vez de prometer o que o provedor não faz.
 */
export interface SpeechCapability {
  /** Modelos que sintetizam fala (o primeiro é o padrão). */
  ttsModels: string[]
  /** Modelos que aceitam áudio na entrada. */
  asrModels: string[]
  voices: string[]
  defaultVoice: string
  speak(request: SpeakRequest): Promise<SpeakResult>
  transcribe(request: TranscribeRequest): Promise<string>
}

export interface Provider {
  id: ProviderId
  listModels(): Promise<ModelInfo[]>
  test(model: string): Promise<TestResult>
  stream(request: StreamRequest, onToken: (token: string) => void): Promise<string>
  generate(request: GenerateRequest): Promise<string>
  /** Ausente = provedor sem voz (UI diz isso em vez de girar para sempre). */
  speech?: SpeechCapability
  /** V3: conversa em tempo real. Ausente = motor sem voz ao vivo (Ollama hoje). */
  live?: RealtimeCapability
}

// --- V3: conversa por voz em tempo real --------------------------------------

/**
 * Evento bruto do motor ao vivo. O contrato **não presume VAD de servidor**:
 * `userTranscript.partial` pode faltar, e `goAway`/`resumption` só existem na
 * nuvem — o motor local (Lote 6) fecha turnos por VAD próprio e emite os
 * mesmos tipos. Quem consome isto é o gerenciador de sessão (`voice-live.ts`),
 * nunca o renderer.
 */
export interface ProviderLiveEvent {
  type:
    | 'ready'
    | 'userTranscript'
    | 'modelTranscript'
    | 'audioChunk'
    | 'turnComplete'
    | 'interrupted'
    | 'userActivity'
    | 'goAway'
    | 'resumption'
    | 'error'
    | 'closed'
  /** Transcrição (parcial ou final, conforme `partial`). */
  text?: string
  partial?: boolean
  /** PCM16 mono em base64, na taxa `sampleRate` (24 kHz no Gemini). */
  audioBase64?: string
  sampleRate?: number
  /** 'userActivity': o aluno começou (true) ou parou (false) de falar. */
  active?: boolean
  /** 'resumption': handle nativo do motor; null = indisponível (usar histórico). */
  resumptionHandle?: string | null
  message?: string
}

export interface LiveStartOptions {
  model: string
  voice: string
  rate: SpeechRate
  turnMode: VoiceLiveTurnMode
  /** Instrução de sistema da chamada (montada em `core/prompts.ts`). */
  systemInstruction: string
  /** Turnos passados para re-injetar quando não há handle de retomada. */
  history?: ChatMessage[]
  /** Retomada nativa do motor (Gemini Live), quando houver. */
  resumptionHandle?: string | null
  /** Deadline da CONEXÃO (não da sessão — voz ao vivo não tem 240 s). */
  signal?: AbortSignal
}

export interface LiveSessionHandle {
  /** Frame PCM16 16 kHz em base64 vindo do microfone do aluno. */
  sendAudio(audioBase64: string): void
  /** Texto no lugar de áudio (ditado durante a chamada; fecha o turno). */
  sendText(text: string): void
  /** Push-to-talk (modo manual): abre/fecha o turno do aluno. */
  pushToTalk(open: boolean): void
  /** Interrompe a fala do tutor (no motor local; na nuvem é feito pelo servidor). */
  interrupt(): void
  close(): void
}

export interface RealtimeCapability {
  /** Identificador estável ('gemini-live' | 'local-sherpa') — selo na UI. */
  engineId: string
  liveModels: string[]
  defaultLiveModel: string
  voices: string[]
  defaultVoice: string
  startLiveSession(
    options: LiveStartOptions,
    onEvent: (event: ProviderLiveEvent) => void
  ): Promise<LiveSessionHandle>
}
