import type { ChatMessage, ModelInfo, ProviderId, TestResult } from '../../shared/types'

export interface StreamRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  signal?: AbortSignal
}

export interface Provider {
  id: ProviderId
  listModels(): Promise<ModelInfo[]>
  test(model: string): Promise<TestResult>
  stream(request: StreamRequest, onToken: (token: string) => void): Promise<string>
}
