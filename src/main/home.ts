/**
 * Home do M2: junta currículo, caderno de erros, fila SRS, conversa e sessão
 * guiada num único payload. Nada aqui é obrigatório — vencidos e sugestões são
 * oferecidos, nunca cobrados.
 */
import { ipcMain } from 'electron'
import type { HomeState } from '../shared/types'
import { getDefaultProfile } from './db'
import { focusFor } from './notebook'
import { curriculumView, lastOpenedLesson, profileView } from './learning'
import { reviewState } from './review'
import { activeGuidedSession } from './guided'
import { latestConversation } from './tutor'

export function homeState(): HomeState {
  const profile = getDefaultProfile()
  const curriculum = curriculumView()
  const lessons = curriculum.units.flatMap((unit) => unit.lessons)

  const cards = reviewState(profile.id, 1)
  const focus = focusFor(profile.id, 4)

  return {
    profile: profileView(profile),
    curriculumReady: curriculum.generated,
    continueLesson: lastOpenedLesson(profile.id),
    nextLesson: lessons.find((lesson) => lesson.status === 'not_started') ?? null,
    units: curriculum.units,
    completedCount: lessons.filter((lesson) => lesson.status === 'completed').length,
    totalCount: lessons.length,
    review: { due: cards.dueCount, total: cards.total, newCount: cards.newCount },
    notebook: {
      open: focus.filter((entry) => entry.source === 'student').length,
      tags: focus
        .filter((entry) => entry.source === 'student')
        .map((entry) => ({ tag: entry.tag, occurrences: entry.occurrences }))
    },
    continueConversation: latestConversation(profile.id),
    guided: activeGuidedSession(profile.id)
  }
}

export function registerHomeIpc(): void {
  ipcMain.handle('home:get', () => homeState())
}
