import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type {
  ChatEvent,
  ConversationView,
  Correction,
  RecapView,
  ScenarioFeedbackView,
  ScenarioView,
  VoiceStatus
} from '../../../shared/types'
import { t } from '../i18n'
import { targetLabel, targetLanguage } from '../lang'
import { CorrectionList } from './CorrectionList'
import { MicDictate, PlayButton } from './SpeechControls'
import { ScenarioBanner, ScenarioFeedbackPanel } from './ScenarioPanel'

interface TutorPanelProps {
  conversationId: number
  onClosed?: (recap: RecapView) => void
  /** Aviso de que o cenário foi encerrado (a rubrica já aparece aqui dentro). */
  onScenarioClosed?: () => void
  /** O aluno reencenou a lição: a conversa nova precisa ser selecionada lá fora. */
  onScenarioReopened?: (conversationId: number) => void
  /** Altura cheia (tela do tutor) ou compacta (dentro da sessão guiada). */
  variant?: 'full' | 'compact'
}

interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  error?: boolean
  cancelled?: boolean
  corrections?: Correction[]
  recast?: string
}

/** V2: o que o provedor faz com voz hoje (uma consulta por painel aberto). */
function useVoiceStatus(): VoiceStatus | null {
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.voice
      .status()
      .then((next) => {
        if (alive) setStatus(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return status
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function fromView(view: ConversationView): UiMessage[] {
  return view.messages.map((message) => ({
    id: `stored-${message.id}`,
    role: message.role,
    content: message.content,
    corrections: message.corrections.length > 0 ? message.corrections : undefined
  }))
}

export function TutorPanel({
  conversationId,
  onClosed,
  onScenarioClosed,
  onScenarioReopened,
  variant = 'full'
}: TutorPanelProps): JSX.Element {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recap, setRecap] = useState<RecapView | null>(null)
  const [scenario, setScenario] = useState<ScenarioView | null>(null)
  const [scenarioRun, setScenarioRun] = useState<ScenarioFeedbackView | null>(null)
  const [scenarioLessonId, setScenarioLessonId] = useState<number | null>(null)
  const [closing, setClosing] = useState(false)
  // V2: voz disponível = ouvir a resposta do tutor e ditar a própria fala.
  const voice = useVoiceStatus()
  const [refreshing, setRefreshing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // M6 (E4): "seguir o rabo" só quando o aluno já está no fim da lista. Antes,
  // o scrollIntoView por token impedia ler o que acabou de passar.
  const stickToBottom = useRef(true)

  function trackScroll(): void {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  const busy = streaming !== null

  useEffect(() => {
    let alive = true
    setLoadError(null)
    setRecap(null)
    setMessages([])
    setScenario(null)
    setScenarioRun(null)

    window.api.tutor
      .open(conversationId)
      .then((view) => {
        if (!alive) return
        setMessages(fromView(view))
        setScenario(view.scenario)
        setScenarioLessonId(view.conversation.lessonId)
        if (view.scenario) {
          // Rubrica de um cenário já encerrado volta junto da conversa.
          void window.api.scenario
            .session(conversationId)
            .then((session) => {
              if (alive && session?.run) setScenarioRun(session.run)
            })
            .catch(() => undefined)
        }
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      alive = false
    }
  }, [conversationId])

  useEffect(() => {
    return window.api.tutor.onEvent((event: ChatEvent) => {
      // M6 (E4): o canal `chat:event` é global — evento de outra conversa não
      // entra nesta tela nem quando o aluno troca de conversa no meio do turno.
      if (event.conversationId != null && event.conversationId !== conversationId) {
        return
      }

      if (event.type === 'status') {
        setStatus(event.message ?? null)
        return
      }

      if (event.type === 'corrections') {
        // M6 (E4): o evento carimba o `requestId` do turno — as correções vão
        // para o usuário que o gerou, não para "qualquer última".
        setMessages((previous) => {
          const turnIndex = previous.findIndex((message) => message.id === event.requestId)
          if (turnIndex === -1) return previous
          for (let index = turnIndex - 1; index >= 0; index -= 1) {
            if (previous[index]?.role !== 'user') continue
            return previous.map((message, position) =>
              position === index
                ? { ...message, corrections: event.corrections ?? [], recast: event.recast }
                : message
            )
          }
          return previous
        })
        return
      }

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
        setStatus(null)
        setStreaming((current) => (current === event.requestId ? null : current))
      }
    })
    // M6 (E4): dependente da conversa — o filtro de eventos lê o id atual,
    // não o da primeira montagem (o TutorScreen remonta o painel por key, mas
    // o listener não pode depender disso em silêncio).
  }, [conversationId])

  useEffect(() => {
    if (!stickToBottom.current) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  async function send(rawText: string): Promise<void> {
    const text = rawText.trim()
    if (!text || busy) return

    const requestId = newId()
    setLoadError(null)
    setInput('')
    stickToBottom.current = true
    setMessages((previous) => [
      ...previous,
      { id: newId(), role: 'user', content: text },
      { id: requestId, role: 'assistant', content: '', pending: true }
    ])
    setStreaming(requestId)

    try {
      const result = await window.api.tutor.send({ requestId, conversationId, text })
      // M6 (B9): pré-condição recusada (sem conversa/texto/modelo) → nenhum
      // evento `chat:event` vai chegar; o bubble "Pensando…" precisa morrer aqui.
      if (result && !result.ok) {
        setMessages((previous) =>
          previous.map((entry) =>
            entry.id === requestId && entry.pending
              ? { ...entry, content: result.error ?? 'Falha ao enviar a mensagem.', pending: false, error: true }
              : entry
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
      setStatus(null)
    }
  }

  function stop(): void {
    if (!streaming) return
    const requestId = streaming
    void window.api.tutor.cancel(requestId)
    setStreaming(null)
    setMessages((previous) =>
      previous.map((message) =>
        message.id === requestId && message.pending
          ? { ...message, pending: false, cancelled: true }
          : message
      )
    )
  }

  /**
   * Fechar um cenário produz a rubrica (tarefa × língua) e encerra a conversa no
   * main; fechar conversa livre produz só a recapitulação de correções.
   */
  async function close(): Promise<void> {
    setClosing(true)
    try {
      if (scenario) {
        setScenarioRun(await window.api.scenario.finish(conversationId))
        onScenarioClosed?.()
      } else {
        const result = await window.api.tutor.close(conversationId)
        setRecap(result)
        onClosed?.(result)
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setClosing(false)
    }
  }

  /** Reencena a mesma lição: outro personagem, mesma tarefa de nível. */
  async function newPersona(): Promise<void> {
    if (scenarioLessonId == null) return
    setRefreshing(true)
    setLoadError(null)
    try {
      await window.api.scenario.refresh(scenarioLessonId)
      const session = await window.api.scenario.open({ lessonId: scenarioLessonId })
      onScenarioReopened?.(session.conversation.id)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setRefreshing(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // M6 (E2): Enter durante composição (IME de ja/zh/ko) confirma o candidato,
    // não envia a mensagem.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send(input)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loadError && (
        <div className="border-b border-danger/30 bg-danger-soft px-6 py-2.5 text-xs text-danger">
          {loadError}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={trackScroll}
        className={`flex-1 overflow-y-auto px-6 ${variant === 'full' ? 'py-6' : 'py-4'}`}
      >
        {scenario && (
          <div className="mx-auto mb-4 max-w-3xl">
            <ScenarioBanner scenario={scenario} />
            {scenario.source === 'ai' && !scenarioRun && scenarioLessonId != null && (
              <button
                type="button"
                onClick={() => void newPersona()}
                disabled={refreshing || busy}
                className="mt-2 rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-50"
              >
                {refreshing ? t.tutor.thinking : t.scenario.newPersona}
              </button>
            )}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
            <h2 className="text-base font-semibold">{t.tutor.emptyTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t.tutor.emptyBody}</p>
            <div className="mt-5 flex w-full flex-col gap-2">
              {(targetLanguage().split('-')[0] === 'en' ? t.tutor.suggestions : []).map((suggestion) => (
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
                  className={`w-full max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
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
                    {message.role === 'user' ? t.tutor.you : t.tutor.tutor}
                  </div>
                  <span dir="auto" lang={targetLanguage()}>
                    {message.content ||
                      (message.pending ? (status ? t.tutor[statusKey(status)] : t.tutor.thinking) : '')}
                  </span>
                  {message.pending && (
                    <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />
                  )}
                  {message.cancelled && (
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-faint">{t.tutor.interrupted}</div>
                  )}

                  {message.role === 'user' && message.corrections && (
                    <div className="mt-2 rounded-xl bg-accent-ink/10 px-3 py-2">
                      <CorrectionList corrections={message.corrections} recast={message.recast} />
                    </div>
                  )}

                  {/* V2: ouvir a resposta do tutor (pronúncia modelo, não texto). */}
                  {message.role === 'assistant' && !message.pending && voice?.tts && message.content.trim() && (
                    <div className="mt-2">
                      <PlayButton text={message.content} compact label={t.voice.play} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {scenarioRun && (
        <div className="border-t border-line bg-panel px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <ScenarioFeedbackPanel run={scenarioRun} />
          </div>
        </div>
      )}

      {recap && (
        <div className="border-t border-line bg-panel px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <div className="text-[10px] uppercase tracking-wider text-faint">{t.tutor.recapTitle}</div>
            <p className="mt-1 text-sm leading-relaxed text-ink">{recap.message}</p>
            {recap.corrections.length > 0 && (
              <div className="mt-3">
                <CorrectionList corrections={recap.corrections} variant="block" />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-line bg-panel/60 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={variant === 'compact' ? 2 : 3}
            placeholder={t.tutor.placeholder.replace('{lang}', targetLabel())}
            dir="auto"
            lang={targetLanguage()}
            className="max-h-40 min-h-[52px] flex-1 resize-none rounded-xl border border-line bg-panel px-4 py-3 text-sm leading-relaxed text-ink outline-none placeholder:text-faint focus:border-accent/50"
          />
          <div className="flex shrink-0 flex-col gap-2">
            {voice?.asr && (
              <MicDictate
                onText={(text) =>
                  setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text))
                }
              />
            )}
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="h-[25px] rounded-lg border border-line px-4 text-xs font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
              >
                {t.tutor.stop}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={!input.trim()}
                className="h-[25px] rounded-lg bg-accent px-4 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.tutor.send}
              </button>
            )}
            {!recap && !scenarioRun && (
              <button
                type="button"
                onClick={() => void close()}
                disabled={closing || messages.length <= (scenario ? 1 : 0)}
                className="h-[25px] rounded-lg border border-line px-4 text-xs text-muted transition-colors hover:text-ink disabled:opacity-40"
              >
                {closing ? (scenario ? t.scenario.ending : t.common.saving) : scenario ? t.scenario.end : t.tutor.endConversation}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function statusKey(status: string): 'correcting' | 'responding' {
  return status === 'corrigindo' ? 'correcting' : 'responding'
}
