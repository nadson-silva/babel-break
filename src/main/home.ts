/**
 * Home do M3: currículo, caderno de erros, fila SRS, conversa, sessão guiada e
 * **trilhas de foco** num único payload. Nada aqui é obrigatório — vencidos,
 * trilhas e sugestões são oferecidos, nunca cobrados.
 *
 * O `focusMix` aparece aqui e só aqui: ele decide a **ordem** da sugestão ("lição
 * base ou lição da trilha?"), não uma cota diária. Quem só quer conversar não
 * recebe lição nenhuma.
 */
import { handle } from './ipc-contract'
import { desc, eq } from 'drizzle-orm'
import type { HomeState, LessonSummary, NextSuggestion } from '../shared/types'
import { pickRecommendationOrigin } from '../core/tracks'
import { getDb, schema } from './db'
import { activeProfileId, profileViewOf } from './profiles'
import { nativeLangFor } from './locale'
import { runtimeText } from '../core/runtime-text'
import { focusFor } from './notebook'
import { curriculumView, lastOpenedLesson, pendingLessons } from './learning'
import { reviewState } from './review'
import { activeGuidedSession } from './guided'
import { tracksView } from './tracks'
import { latestConversation } from './tutor'

/** O que o aluno abriu por último, entre base e trilha — histórico do mix. */
function recentOrigins(profileId: number): ('base' | 'focus')[] {
  const db = getDb()

  return db
    .select({ lessonId: schema.lessonProgress.lessonId })
    .from(schema.lessonProgress)
    .where(eq(schema.lessonProgress.profileId, profileId))
    .orderBy(desc(schema.lessonProgress.lastOpenedAt))
    .limit(6)
    .all()
    .map((row) => {
      const lesson = db
        .select({ trackId: schema.lessons.trackId })
        .from(schema.lessons)
        .where(eq(schema.lessons.id, row.lessonId))
        .get()

      return lesson?.trackId != null ? 'focus' : 'base'
    })
    .reverse()
}

function suggestionFor(
  base: LessonSummary[],
  focus: LessonSummary[],
  focusMix: number,
  history: ('base' | 'focus')[],
  lang: string
): NextSuggestion | null {
  const origin = pickRecommendationOrigin({
    focusMix,
    history,
    hasBase: base.length > 0,
    hasFocus: focus.length > 0
  })

  if (!origin) return null

  const lesson = origin === 'focus' ? focus[0] : base[0]
  if (!lesson) return null

  // M5: o motivo da sugestão é texto do main, então sai no idioma das
  // explicações do perfil (não é string de interface).
  const reason =
    origin === 'focus'
      ? runtimeText(lang, 'suggest.track', { title: lesson.trackTitle ?? '' })
      : lesson.unitTitle
        ? runtimeText(lang, 'suggest.baseUnit', { unit: lesson.unitTitle })
        : runtimeText(lang, 'suggest.base')

  return { lesson, origin, reason }
}

export function homeState(profileId = activeProfileId()): HomeState {
  const profile = getDb()
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, profileId))
    .get()
  if (!profile) throw new Error('Perfil não encontrado.')

  const curriculum = curriculumView(profile.id)
  const lessons = curriculum.units.flatMap((unit) => unit.lessons)
  const pending = pendingLessons(profile.id)

  const cards = reviewState(profile.id, 1)
  const focus = focusFor(profile.id, 4)
  const tracks = tracksView(profile.id)

  return {
    profile: profileViewOf(profile),
    curriculumReady: curriculum.generated,
    continueLesson: lastOpenedLesson(profile.id),
    nextLesson: pending.base[0] ?? null,
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
    guided: activeGuidedSession(profile.id),
    tracks: tracks.active,
    suggestion: suggestionFor(
      pending.base,
      pending.focus,
      tracks.focusMix,
      recentOrigins(profile.id),
      nativeLangFor(profile.id)
    )
  }
}

export function registerHomeIpc(): void {
  handle('home:get', () => homeState())
}
