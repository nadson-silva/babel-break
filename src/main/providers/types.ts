import type { ChatMessage, ModelInfo, ProviderId, TestResult } from '../../shared/types'

export interface StreamRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  signal?: AbortSignal
}

export interface GenerateRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  signal?: AbortSignal
  /** Pede ao provedor uma resposta em JSON (quando suportado nativamente). */
  json?: boolean
}

export interface Provider {
  id: ProviderId
  listModels(): Promise<ModelInfo[]>
  test(model: string): Promise<TestResult>
  stream(request: StreamRequest, onToken: (token: string) => void): Promise<string>
  generate(request: GenerateRequest): Promise<string>
}
