/**
 * IPC do loop (M2): tutor, caderno de erros, revisão SRS e sessão guiada.
 * Toda chamada de IA continua no processo main; o renderer só vê eventos.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
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
import { getDefaultProfile } from './db'
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
  return getDefaultProfile().id
}

function emit(event: IpcMainInvokeEvent, payload: ChatEvent): void {
  if (!event.sender.isDestroyed()) {
    event.sender.send('chat:event', payload)
  }
}

export function registerLoopIpc(): void {
  // --- Tutor ---------------------------------------------------------------
  ipcMain.handle('tutor:list', () => listConversations(profileId()))

  ipcMain.handle('tutor:latest', () => latestConversation(profileId()))

  ipcMain.handle('tutor:open', (_event, conversationId: number) =>
    openConversationView(profileId(), conversationId)
  )

  ipcMain.handle(
    'tutor:new',
    (_event, input: { topic?: string | null; lessonId?: number | null } = {}) =>
      createConversation(profileId(), input)
  )

  ipcMain.handle('tutor:send', async (event, request: TutorSendRequest) => {
    await sendTurn(profileId(), request, (payload) => emit(event, payload))
  })

  ipcMain.handle('tutor:cancel', (_event, requestId: string) => cancelTurn(requestId))

  ipcMain.handle('tutor:close', (_event, conversationId: number): RecapView =>
    closeConversation(profileId(), conversationId)
  )

  // --- Caderno de erros ----------------------------------------------------
  ipcMain.handle('notebook:get', (): NotebookView => notebookView(profileId()))

  ipcMain.handle('notebook:resolve', (_event, errorId: number, resolved: boolean) =>
    setErrorResolved(errorId, resolved)
  )

  ipcMain.handle('notebook:resolve-tag', (_event, tags: string[]) => resolveTagErrors(profileId(), tags))

  // --- Revisão SRS ---------------------------------------------------------
  ipcMain.handle('review:state', (_event, limit?: number): ReviewState => reviewState(profileId(), limit ?? 20))

  ipcMain.handle(
    'review:answer',
    (_event, input: { cardId: number; rating: ReviewRating }): ReviewResult =>
      answerReview(profileId(), input.cardId, input.rating)
  )

  ipcMain.handle('review:from-errors', () => cardsForRecurringErrors(profileId(), 8))

  // --- Sessão guiada -------------------------------------------------------
  ipcMain.handle('guided:active', () => activeGuidedSession(profileId()))

  ipcMain.handle('guided:start', async () => startGuidedSession(profileId()))

  ipcMain.handle('guided:step', (_event, step: GuidedStep) => advanceGuidedSession(profileId(), step))

  ipcMain.handle('guided:review-count', (_event, done: number) => recordGuidedReview(profileId(), done))

  ipcMain.handle('guided:practice', (_event, practice: { correct: number; total: number }) =>
    recordGuidedPractice(profileId(), practice)
  )

  ipcMain.handle('guided:tutor', async () => ensureGuidedConversation(profileId()))

  ipcMain.handle(
    'guided:finish',
    (_event, input: { reviewDone?: number; practice?: { correct: number; total: number } } = {}) =>
      finishGuidedSession(profileId(), input)
  )

  ipcMain.handle('guided:abandon', () => abandonGuidedSession(profileId()))
}
