/**
 * Escopo de perfil (v2 / M6-D2): **nada** entra por id sem provar a posse.
 *
 * Com um perfil só, "id existe" bastava. Com vários, id de outra pessoa é
 * `não encontrado` — não uma porta para dados alheios, nem um botão que bloqueia
 * exercício alheio. Cada função daqui é a fronteira: ela lê a linha **e** o dono
 * na mesma consulta, em vez de confiar no que o renderer mandou.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { ReportKind } from '../shared/report-reasons'
import { getDb, schema } from './db'

type LessonRow = typeof schema.lessons.$inferSelect
type ExerciseRow = typeof schema.exercises.$inferSelect
type ConversationRow = typeof schema.conversations.$inferSelect
type CardRow = typeof schema.cards.$inferSelect
type ErrorRow = typeof schema.errors.$inferSelect
type TrackRow = typeof schema.focusTracks.$inferSelect

/**
 * Dono de uma lição: `lessons.profile_id` (coluna da v2) e, para linha mais
 * antiga que a coluna, a cadeia `units.profile_id` / `focus_tracks.profile_id`.
 * Quando a cadeia resolve, a coluna é autoconsertada — posse deduzida uma vez
 * continua sendo posse deduzida para sempre, e export/import quer uma coluna.
 */
export function lessonForProfile(lessonId: number, profileId: number): LessonRow | null {
  const db = getDb()

  const row = db
    .select({ lesson: schema.lessons, owner: sql<number | null>`coalesce(${schema.lessons.profileId}, ${schema.units.profileId}, ${schema.focusTracks.profileId})`.as('owner') })
    .from(schema.lessons)
    .leftJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
    .leftJoin(schema.focusTracks, eq(schema.focusTracks.id, schema.lessons.trackId))
    .where(and(eq(schema.lessons.id, lessonId), sql`coalesce(${schema.lessons.profileId}, ${schema.units.profileId}, ${schema.focusTracks.profileId}) = ${profileId}`))
    .get()

  if (!row) return null

  const lesson = row.lesson
  if (lesson.profileId == null) {
    db.update(schema.lessons).set({ profileId }).where(eq(schema.lessons.id, lesson.id)).run()
  }

  return lesson
}

export function requireLessonForProfile(lessonId: number, profileId: number): LessonRow {
  const lesson = lessonForProfile(lessonId, profileId)
  if (!lesson) throw new Error('Lição não encontrada.')
  return lesson
}

/** Exercício só responde se a lição dele for do perfil. */
export function exerciseForProfile(exerciseId: number, profileId: number): ExerciseRow | null {
  return (
    getDb()
      .select({ exercise: schema.exercises })
      .from(schema.exercises)
      .leftJoin(schema.lessons, eq(schema.lessons.id, schema.exercises.lessonId))
      .leftJoin(schema.units, eq(schema.units.id, schema.lessons.unitId))
      .leftJoin(schema.focusTracks, eq(schema.focusTracks.id, schema.lessons.trackId))
      .where(
        and(
          eq(schema.exercises.id, exerciseId),
          sql`coalesce(${schema.lessons.profileId}, ${schema.units.profileId}, ${schema.focusTracks.profileId}) = ${profileId}`
        )
      )
      .get()?.exercise ?? null
  )
}

export function requireExerciseForProfile(exerciseId: number, profileId: number): ExerciseRow {
  const exercise = exerciseForProfile(exerciseId, profileId)
  if (!exercise) throw new Error('Exercício não encontrado.')
  return exercise
}

export function conversationForProfile(conversationId: number, profileId: number): ConversationRow | null {
  return (
    getDb()
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.profileId, profileId)))
      .get() ?? null
  )
}

export function requireConversationForProfile(conversationId: number, profileId: number): ConversationRow {
  const row = conversationForProfile(conversationId, profileId)
  if (!row) throw new Error('Conversa não encontrada.')
  return row
}

export function cardForProfile(cardId: number, profileId: number): CardRow | null {
  return (
    getDb()
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.id, cardId), eq(schema.cards.profileId, profileId)))
      .get() ?? null
  )
}

export function errorForProfile(errorId: number, profileId: number): ErrorRow | null {
  return (
    getDb()
      .select()
      .from(schema.errors)
      .where(and(eq(schema.errors.id, errorId), eq(schema.errors.profileId, profileId)))
      .get() ?? null
  )
}

export function trackForProfile(trackId: number, profileId: number): TrackRow | null {
  return (
    getDb()
      .select()
      .from(schema.focusTracks)
      .where(and(eq(schema.focusTracks.id, trackId), eq(schema.focusTracks.profileId, profileId)))
      .get() ?? null
  )
}

/** Ids de lição do perfil: exported para agregações escopadas (painel, cache). */
export function lessonIdsForProfile(profileId: number): number[] {
  const db = getDb()
  const ids = new Set<number>()

  for (const row of db.select({ id: schema.lessons.id }).from(schema.lessons).where(eq(schema.lessons.profileId, profileId)).all()) {
    ids.add(row.id)
  }

  const unitIds = db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(eq(schema.units.profileId, profileId))
    .all()
    .map((row) => row.id)
  if (unitIds.length > 0) {
    for (const row of db.select({ id: schema.lessons.id }).from(schema.lessons).where(inArray(schema.lessons.unitId, unitIds)).all()) {
      ids.add(row.id)
    }
  }

  const trackIds = db
    .select({ id: schema.focusTracks.id })
    .from(schema.focusTracks)
    .where(eq(schema.focusTracks.profileId, profileId))
    .all()
    .map((row) => row.id)
  if (trackIds.length > 0) {
    for (const row of db.select({ id: schema.lessons.id }).from(schema.lessons).where(inArray(schema.lessons.trackId, trackIds)).all()) {
      ids.add(row.id)
    }
  }

  return [...ids]
}

/**
 * Report tem alvo polimórfico (exercício, lição, erro, trilha, conversa). Sem
 * escopo, "reportar conteúdo ruim" de um perfil bloqueava conteúdo de outro —
 * e o undo desfazia o efeito alheio.
 */
export function reportTargetForProfile(kind: ReportKind, targetId: number | null, profileId: number): boolean {
  if (targetId == null) return false

  switch (kind) {
    case 'exercise':
      return exerciseForProfile(targetId, profileId) != null
    case 'correction':
      return errorForProfile(targetId, profileId) != null
    case 'track_plan':
      return trackForProfile(targetId, profileId) != null
    case 'chat_reply':
      return conversationForProfile(targetId, profileId) != null
    default: {
      // lesson_content | scenario: a lição precisa ser do perfil.
      return lessonForProfile(targetId, profileId) != null
    }
  }
}

/** Erro do caderno do perfil (a busca por frase do report 'correction' não pode varrer os outros). */
export function profileErrorRows(profileId: number, limit: number): Pick<ErrorRow, 'id' | 'tag' | 'original' | 'resolvedAt' | 'disputedAt' | 'lastSeenAt'>[] {
  return getDb()
    .select({
      id: schema.errors.id,
      tag: schema.errors.tag,
      original: schema.errors.original,
      resolvedAt: schema.errors.resolvedAt,
      disputedAt: schema.errors.disputedAt,
      lastSeenAt: schema.errors.lastSeenAt
    })
    .from(schema.errors)
    .where(and(eq(schema.errors.profileId, profileId), or(sql`${schema.errors.resolvedAt} is null`, sql`${schema.errors.disputedAt} is null`)))
    .orderBy(sql`${schema.errors.lastSeenAt} desc`)
    .limit(limit)
    .all()
}

/** Todos os ids de perfil deste aparelho (validação de payload de import/export). */
export function knownProfileIds(): number[] {
  return getDb()
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .all()
    .map((row) => row.id)
}
