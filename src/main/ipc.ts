import { app, ipcMain } from 'electron'
import { asc, eq } from 'drizzle-orm'
import type {
  AppSettings,
  ChatEvent,
  ChatSendRequest,
  ProviderId,
  SettingsPayload,
  StoredMessage,
  TestResult
} from '../shared/types'
import { getDb, getDefaultProfile, schema } from './db'
import { getProvider } from './providers'
import {
  clearGeminiApiKey,
  getSecureStorageInfo,
  hasGeminiApiKey,
  setGeminiApiKey
} from './secrets'
import { getSettings, updateSettings } from './settings'

const activeRequests = new Map<string, AbortController>()
const TEST_CONVERSATION_TOPIC = 'Chat de teste'

async function settingsPayload(): Promise<SettingsPayload> {
  return {
    ...getSettings(),
    hasGeminiKey: await hasGeminiApiKey(),
    secureStorage: await getSecureStorageInfo(),
    runtime: {
      electron: process.versions.electron ?? '—',
      chrome: process.versions.chrome ?? '—',
      node: process.versions.node,
      platform: process.platform
    }
  }
}

function testConversationId(): number {
  const db = getDb()
  const existing = db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.topic, TEST_CONVERSATION_TOPIC))
    .limit(1)
    .get()

  if (existing) return existing.id

  const profile = getDefaultProfile()
  const created = db
    .insert(schema.conversations)
    .values({
      profileId: profile.id,
      mode: 'free',
      topic: TEST_CONVERSATION_TOPIC,
      createdAt: Date.now()
    })
    .returning()
    .get()

  return created.id
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerIpcHandlers(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName()
  }))

  ipcMain.handle('settings:get', () => settingsPayload())

  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    updateSettings(patch)
    return settingsPayload()
  })

  ipcMain.handle('settings:set-gemini-key', async (_event, key: string) => {
    await setGeminiApiKey(key)
    return settingsPayload()
  })

  ipcMain.handle('settings:clear-gemini-key', () => {
    clearGeminiApiKey()
    return settingsPayload()
  })

  ipcMain.handle('models:list', async (_event, providerId: ProviderId) => {
    return getProvider(providerId).listModels()
  })

  ipcMain.handle('provider:test', async (_event, providerId: ProviderId): Promise<TestResult> => {
    const startedAt = performance.now()
    const settings = getSettings()
    const model = providerId === 'gemini' ? settings.geminiModel : settings.ollamaModel

    try {
      return await getProvider(providerId).test(model)
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        error: errorMessage(error)
      }
    }
  })

  ipcMain.handle('chat:history', (): StoredMessage[] => {
    const db = getDb()
    const conversationId = testConversationId()

    return db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(asc(schema.messages.id))
      .all()
      .filter(
        (message) =>
          message.role === 'user' ||
          (message.role === 'assistant' && message.content.trim().length > 0)
      )
      .map((message) => ({
        id: message.id,
        role: message.role as 'user' | 'assistant',
        content: message.content,
        createdAt: message.createdAt
      }))
  })

  ipcMain.handle('chat:send', async (event, request: ChatSendRequest) => {
    if (!request.model) {
      return { ok: false, error: 'Nenhum modelo selecionado. Escolha um modelo em Configurações.' }
    }

    const db = getDb()
    const conversationId = testConversationId()
    const lastUserMessage = [...request.messages].reverse().find((message) => message.role === 'user')

    if (lastUserMessage) {
      db.insert(schema.messages)
        .values({
          conversationId,
          role: 'user',
          content: lastUserMessage.content,
          createdAt: Date.now()
        })
        .run()
    }

    const controller = new AbortController()
    activeRequests.set(request.requestId, controller)

    const send = (payload: ChatEvent): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('chat:event', payload)
      }
    }

    try {
      const text = await getProvider(request.provider).stream(
        {
          model: request.model,
          messages: request.messages,
          temperature: 0.7,
          signal: controller.signal
        },
        (token) => send({ requestId: request.requestId, type: 'token', token })
      )

      if (!text.trim()) {
        throw new Error(
          'O modelo não retornou texto. Se ele usa raciocínio interno (thinking), escolha outro modelo.'
        )
      }

      db.insert(schema.messages)
        .values({ conversationId, role: 'assistant', content: text, createdAt: Date.now() })
        .run()

      send({ requestId: request.requestId, type: 'done', text })
      return { ok: true }
    } catch (error) {
      const aborted = controller.signal.aborted
      const message = errorMessage(error)

      send({
        requestId: request.requestId,
        type: aborted ? 'cancelled' : 'error',
        message: aborted ? undefined : message
      })

      return { ok: false, error: aborted ? undefined : message }
    } finally {
      activeRequests.delete(request.requestId)
    }
  })

  ipcMain.handle('chat:cancel', (_event, requestId: string) => {
    activeRequests.get(requestId)?.abort()
    activeRequests.delete(requestId)
  })
}
