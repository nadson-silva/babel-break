import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  CardView,
  ConversationSummary,
  RecapView,
  ReviewRating,
  ReviewState,
  SettingsPayload
} from '../../../shared/types'
import { t } from '../i18n/pt-BR'
import { ReviewQueue } from '../components/ReviewQueue'
import { TutorPanel } from '../components/TutorPanel'

interface TutorScreenProps {
  settings: SettingsPayload
  onOpenSettings: () => void
  /** Abre a conversa criada/continuada a partir de outra tela. */
  initialConversationId?: number | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  if (sameDay) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function TutorScreen({
  settings,
  onOpenSettings,
  initialConversationId
}: TutorScreenProps): JSX.Element {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(initialConversationId ?? null)
  const [topic, setTopic] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [due, setDue] = useState<ReviewState | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [recap, setRecap] = useState<RecapView | null>(null)
  const started = useRef(false)

  const model = settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel

  const refresh = useCallback(async (): Promise<void> => {
    const [list, review] = await Promise.all([window.api.tutor.list(), window.api.review.state(1)])
    setConversations(list)
    setDue(review)
    if (list.length > 0) setActiveId((current) => current ?? list[0].id)
  }, [])
  useEffect(() => {
    if (started.current) return
    started.current = true

    void refresh().catch((error: unknown) => setError(messageOf(error)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function create(): Promise<void> {
    if (!model) {
      setError(t.common.noModel)
      return
    }

    setCreating(true)
    setError(null)
    try {
      const view = await window.api.tutor.create({ topic: topic.trim() || null })
      setTopic('')
      setActiveId(view.conversation.id)
      await refresh()
    } catch (createError) {
      setError(messageOf(createError))
    } finally {
      setCreating(false)
    }
  }

  async function answerReview(cardId: number, rating: ReviewRating): Promise<void> {
    const result = await window.api.review.answer({ cardId, rating })
    const next = await window.api.review.state(1)
    setDue({ ...next, dueCount: result.dueCount })

    if (result.dueCount === 0) setReviewing(false)
  }

  function openedRecap(value: RecapView): void {
    setRecap(value)
    void refresh().catch(() => undefined)
  }

  const reviewQueue: CardView[] = due?.due ?? []

  return (
    <div className="flex h-full min-w-0">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-panel lg:flex">
        <div className="border-b border-line-soft p-4">
          <div className="text-[10px] uppercase tracking-wider text-faint">{t.tutor.conversations}</div>
          <div className="mt-2 space-y-2">
            <input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder={t.tutor.topicPlaceholder}
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-ink outline-none placeholder:text-faint focus:border-accent/50"
            />
            <button
              type="button"
              onClick={() => void create()}
              disabled={creating}
              className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {creating ? t.tutor.thinking : t.tutor.newConversation}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="px-3 py-4 text-xs leading-relaxed text-muted">{t.tutor.emptyBody}</p>
          ) : (
            conversations.map((conversation) => {
              const active = conversation.id === activeId
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => {
                    setActiveId(conversation.id)
                    setRecap(null)
                  }}
                  className={`mb-1 w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    active ? 'bg-panel-2 text-ink' : 'text-muted hover:bg-panel-2/60 hover:text-ink'
                  }`}
                >
                  <div className="truncate text-xs font-medium">
                    {conversation.topic ?? conversation.lessonTitle ?? t.tutor.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-faint">
                    <span>{formatTime(conversation.lastMessageAt)}</span>
                    <span>· {conversation.messageCount}</span>
                    {conversation.closed && <span>· {t.tutor.ended}</span>}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{t.tutor.title}</h1>
            <p className="truncate text-xs text-muted">{t.tutor.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted">
              {settings.provider === 'gemini' ? t.provider.gemini : t.provider.ollama} ·{' '}
              <span className="text-ink">{model || 'sem modelo'}</span>
            </div>
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
            >
              {t.common.openSettings}
            </button>
          </div>
        </header>

        {!model && (
          <div className="border-b border-warn/30 bg-warn-soft px-8 py-2.5 text-xs text-warn">
            {t.common.noModel}
          </div>
        )}

        {error && (
          <div className="border-b border-danger/30 bg-danger-soft px-8 py-2.5 text-xs text-danger">{error}</div>
        )}

        {due && due.dueCount > 0 && !reviewing && (
          <div className="flex items-center justify-between gap-4 border-b border-line bg-panel-2/60 px-8 py-2.5 text-xs text-muted">
            <span>{t.tutor.reviewBanner.replace('{count}', String(due.dueCount))}</span>
            <button
              type="button"
              onClick={() => setReviewing(true)}
              className="shrink-0 rounded-lg border border-accent/40 px-3 py-1.5 font-medium text-accent transition-colors hover:bg-accent-soft"
            >
              {t.tutor.reviewBannerCta}
            </button>
          </div>
        )}

        {recap && (
        <div className="border-b border-accent/30 bg-accent-soft/30 px-8 py-3 text-xs text-ink">
          <span className="font-semibold text-accent">{t.tutor.recapTitle}: </span>
          {recap.message}
          {recap.tags.length > 0 && (
            <span className="ml-2 text-muted">
              {' '}
              {t.guided.recapTags.replace('{tags}', recap.tags.join(', '))}
            </span>
          )}
        </div>
      )}

      {reviewing ? (
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <div className="mx-auto max-w-2xl space-y-4">
              <ReviewQueue
                cards={reviewQueue}
                onAnswer={answerReview}
                onSkip={() => setReviewing(false)}
                skipLabel={t.common.back}
              />
            </div>
          </div>
        ) : activeId ? (
          <TutorPanel key={activeId} conversationId={activeId} onClosed={openedRecap} />
        ) : (
          <div className="flex flex-1 items-center justify-center px-8">
            <div className="max-w-md text-center">
              <h2 className="text-lg font-semibold">{t.tutor.emptyTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t.tutor.emptyBody}</p>
              <button
                type="button"
                onClick={() => void create()}
                disabled={creating || !model}
                className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {t.tutor.startConversation}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
