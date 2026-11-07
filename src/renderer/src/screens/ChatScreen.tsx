import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { ChatMessage, SettingsPayload, StoredMessage } from '../../../shared/types'
import { t } from '../i18n/pt-BR'

interface ChatScreenProps {
  settings: SettingsPayload
  onOpenSettings: () => void
}

interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  error?: boolean
  cancelled?: boolean
}

const SYSTEM_PROMPT = [
  'Você é um tutor de inglês para falantes de português do Brasil.',
  'Responda de forma curta (2 a 4 frases), em inglês simples e adequado ao nível do aluno.',
  'Explique em português apenas quando for realmente útil.',
  'Corrija erros de forma gentil, mostrando a versão correta.',
  'Este é o chat de teste do aplicativo: seja direto e útil.'
].join(' ')

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function fromStored(message: StoredMessage): UiMessage {
  return { id: `stored-${message.id}`, role: message.role, content: message.content }
}

export function ChatScreen({ settings, onOpenSettings }: ChatScreenProps): JSX.Element {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const model = settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel
  const providerLabel = settings.provider === 'gemini' ? t.provider.gemini : t.provider.ollama

  useEffect(() => {
    let alive = true
    window.api.chat
      .history()
      .then((rows) => {
        if (alive) setMessages(rows.map(fromStored))
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    return window.api.chat.onEvent((event) => {
      setMessages((previous) =>
        previous.map((message) => {
          if (message.id !== event.requestId) return message

          if (event.type === 'token') {
            return { ...message, content: message.content + (event.token ?? '') }
          }
          if (event.type === 'done') {
            return { ...message, content: event.text || message.content, pending: false }
          }
          if (event.type === 'error') {
            return {
              ...message,
              content: event.message ?? 'Erro inesperado ao falar com o provedor.',
              pending: false,
              error: true
            }
          }
          return { ...message, pending: false, cancelled: true }
        })
      )

      if (event.type !== 'token') {
        setStreaming((current) => (current === event.requestId ? null : current))
      }
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  async function send(rawText: string): Promise<void> {
    const text = rawText.trim()
    if (!text || streaming) return

    if (!model) {
      setLoadError(t.chat.noModel)
      return
    }

    setLoadError(null)

    const requestId = newId()
    const history: ChatMessage[] = messages
      .filter((message) => !message.error && message.content.trim().length > 0)
      .map((message) => ({ role: message.role, content: message.content }))

    setMessages((previous) => [
      ...previous,
      { id: newId(), role: 'user', content: text },
      { id: requestId, role: 'assistant', content: '', pending: true }
    ])
    setInput('')
    setStreaming(requestId)

    try {
      const result = await window.api.chat.send({
        requestId,
        provider: settings.provider,
        model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: text }]
      })

      if (!result.ok && result.error) {
        setMessages((previous) =>
          previous.map((message) =>
            message.id === requestId && message.pending
              ? { ...message, content: result.error as string, pending: false, error: true }
              : message
          )
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMessages((previous) =>
        previous.map((entry) =>
          entry.id === requestId && entry.pending
            ? { ...entry, content: message, pending: false, error: true }
            : entry
        )
      )
    } finally {
      setStreaming((current) => (current === requestId ? null : current))
    }
  }

  function stop(): void {
    if (!streaming) return
    const requestId = streaming
    void window.api.chat.cancel(requestId)
    setStreaming(null)
    setMessages((previous) =>
      previous.map((message) =>
        message.id === requestId && message.pending
          ? { ...message, pending: false, cancelled: true }
          : message
      )
    )
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send(input)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div>
          <h1 className="text-base font-semibold">{t.chat.title}</h1>
          <p className="text-xs text-muted">{t.chat.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted">
            {providerLabel} · <span className="text-ink">{model || 'sem modelo'}</span>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {t.chat.openSettings}
          </button>
        </div>
      </header>

      {!model && (
        <div className="border-b border-warn/30 bg-warn-soft px-8 py-2.5 text-xs text-warn">
          {t.chat.noModel}
        </div>
      )}

      {loadError && (
        <div className="border-b border-danger/30 bg-danger-soft px-8 py-2.5 text-xs text-danger">
          {loadError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-line bg-panel text-accent">
              <svg viewBox="0 0 24 24" fill="none" className="size-6" aria-hidden="true">
                <path
                  d="M4 5.5h16v10.2H9.1L4 19.3V5.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 9h8M8 12.3h5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold">{t.chat.emptyTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t.chat.emptyBody}</p>
            <div className="mt-6 flex w-full flex-col gap-2">
              {t.chat.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-xl border border-line bg-panel px-4 py-3 text-left text-sm text-muted transition-colors hover:border-accent/40 hover:bg-panel-2 hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    message.role === 'user'
                      ? 'rounded-br-md bg-accent text-accent-ink'
                      : message.error
                        ? 'rounded-bl-md border border-danger/40 bg-danger-soft text-danger'
                        : 'rounded-bl-md border border-line bg-panel text-ink'
                  }`}
                >
                  <div
                    className={`mb-1 text-[10px] uppercase tracking-wider ${
                      message.role === 'user' ? 'text-accent-ink/60' : 'text-faint'
                    }`}
                  >
                    {message.role === 'user' ? t.chat.you : t.chat.tutor}
                  </div>
                  {message.content || (message.pending ? t.chat.thinking : '')}
                  {message.pending && (
                    <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />
                  )}
                  {message.cancelled && (
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-faint">
                      interrompido
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-line bg-panel/60 px-8 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={t.chat.placeholder}
            className="max-h-40 min-h-[52px] flex-1 resize-none rounded-xl border border-line bg-panel px-4 py-3 text-sm leading-relaxed text-ink outline-none placeholder:text-faint focus:border-accent/50"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="h-[52px] shrink-0 rounded-xl border border-line px-5 text-sm font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
            >
              {t.chat.stop}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={!input.trim() || !model}
              className="h-[52px] shrink-0 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t.chat.send}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
