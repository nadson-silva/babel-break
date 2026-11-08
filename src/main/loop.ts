/**
 * IPC do loop (M2): tutor, caderno de erros, revisão SRS e sessão guiada.
 * Toda chamada de IA continua no processo main; o renderer só vê eventos.
 */
import { type IpcMainInvokeEvent } from 'electron'
import { handle } from './ipc-contract'
import type {
  ChatEvent,
  GuidedStep,
  NotebookView,
  RecapView,
  ReviewRating,
  ReviewResult,
  ReviewState,
  TutorSendRequest
} from '../shared/types'
import { resolveProfileId } from './profiles'
import {
  abandonGuidedSession,
  activeGuidedSession,
  advanceGuidedSession,
  ensureGuidedConversation,
  finishGuidedSession,
  recordGuidedPractice,
  recordGuidedReview,
  startGuidedSession
} from './guided'
import { notebookView, resolveTagErrors, setErrorResolved } from './notebook'
import { answerReview, cardsForRecurringErrors, reviewState } from './review'
import {
  cancelTurn,
  closeConversation,
  createConversation,
  latestConversation,
  listConversations,
  openConversationView,
  sendTurn
} from './tutor'

function profileId(): number {
  // V2: perfil ativo resolvido a cada chamada (nada de segurar a linha no módulo).
  return resolveProfileId()
}

function emit(event: IpcMainInvokeEvent, payload: ChatEvent): void {
  if (!event.sender.isDestroyed()) {
    event.sender.send('chat:event', payload)
  }
}

export function registerLoopIpc(): void {
  // --- Tutor ---------------------------------------------------------------
  handle('tutor:list', () => listConversations(profileId()))

  handle('tutor:latest', () => latestConversation(profileId()))

  handle('tutor:open', (_event, conversationId: number) =>
    openConversationView(profileId(), conversationId)
  )

  handle(
    'tutor:new',
    (_event, input: { topic?: string | null; lessonId?: number | null } = {}) =>
      createConversation(profileId(), input)
  )

  handle('tutor:send', async (event, request: TutorSendRequest) => {
    // M6 (B9): o resultado de pré-condição ({ok,error}) desce até o renderer —
    // sem isto a falha silenciosa deixava o bubble "Pensando…" para sempre.
    return sendTurn(profileId(), request, (payload) => emit(event, payload))
  })

  handle('tutor:cancel', (_event, requestId: string) => cancelTurn(requestId))

  handle('tutor:close', (_event, conversationId: number): RecapView =>
    closeConversation(profileId(), conversationId)
  )

  // --- Caderno de erros ----------------------------------------------------
  handle('notebook:get', (): NotebookView => notebookView(profileId()))

  handle('notebook:resolve', (_event, errorId: number, resolved: boolean) =>
    setErrorResolved(profileId(), errorId, resolved)
  )

  handle('notebook:resolve-tag', (_event, tags: string[]) => resolveTagErrors(profileId(), tags))

  // --- Revisão SRS ---------------------------------------------------------
  handle('review:state', (_event, limit?: number): ReviewState => reviewState(profileId(), limit ?? 20))

  handle(
    'review:answer',
    (_event, input: { cardId: number; rating: ReviewRating }): ReviewResult =>
      answerReview(profileId(), input.cardId, input.rating)
  )

  handle('review:from-errors', () => cardsForRecurringErrors(profileId(), 8))

  // --- Sessão guiada -------------------------------------------------------
  handle('guided:active', () => activeGuidedSession(profileId()))

  handle('guided:start', async () => startGuidedSession(profileId()))

  handle('guided:step', (_event, step: GuidedStep) => advanceGuidedSession(profileId(), step))

  handle('guided:review-count', (_event, done: number) => recordGuidedReview(profileId(), done))

  handle('guided:practice', (_event, practice: { correct: number; total: number }) =>
    recordGuidedPractice(profileId(), practice)
  )

  handle('guided:tutor', async () => ensureGuidedConversation(profileId()))

  handle(
    'guided:finish',
    (_event, input: { reviewDone?: number; practice?: { correct: number; total: number } } = {}) =>
      finishGuidedSession(profileId(), input)
  )

  handle('guided:abandon', () => abandonGuidedSession(profileId()))
}
