import type { ProviderId } from '../../shared/types'
import { geminiProvider } from './gemini'
import { ollamaProvider } from './ollama'
import type { Provider } from './types'

const providers: Record<ProviderId, Provider> = {
  gemini: geminiProvider,
  ollama: ollamaProvider
}

export function getProvider(id: ProviderId): Provider {
  const provider = providers[id]
  if (!provider) throw new Error(`Provedor desconhecido: ${String(id)}`)
  return provider
}
