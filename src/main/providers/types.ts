import type { ChatMessage, ModelInfo, ProviderId, SpeechRate, TestResult } from '../../shared/types'

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
}
