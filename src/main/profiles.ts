/**
 * Perfis (v2): o app deixou de assumir "o perfil é a primeira linha da tabela".
 *
 * Regras que este módulo guarda:
 *
 * - **perfil ativo é explícito**, nunca singleton de módulo: mora em `settings`
 *   (chave `activeProfile`, estado do aparelho, não do aluno) e é lido a cada
 *   chamada — trocar de perfil no meio de um job não pode herdar o anterior.
 * - **um id de perfil que não existe não cai no perfil padrão** (era o que
 *   `tutor.profileOf()` fazia): quem pede perfil inexistente recebe erro.
 * - **apagar um perfil apaga a memória daquele aluno**, e só dela: as tabelas
 *   sem `ON DELETE CASCADE` (exercícios, trilhas↔lições, runs de cenário,
 *   progresso, sessões) são resolvidas aqui, numa transação só.
 * - Configurações de IA e chaves **não** são por perfil: são do app.
 */
import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { ProfileView } from '../shared/types'
import {
  activeProfile,
  getDb,
  readActiveProfileId,
  schema,
  touchProfileUsed,
  writeActiveProfileId
} from './db'
import { emitStudentEvent } from './events'

/** Paleta estável do avatar — a chave de cor viaja no banco, o CSS vive no renderer. */
export const PROFILE_COLORS = ['teal', 'amber', 'violet', 'rose', 'sky', 'lime'] as const
export type ProfileColor = (typeof PROFILE_COLORS)[number]

export type ProfileRow = typeof schema.profiles.$inferSelect

type NewProfileInput = {
  name?: string | null
  color?: string | null
  targetLang?: string
  nativeLang?: string
}

function isProfileColor(value: string | null | undefined): value is ProfileColor {
  return value != null && (PROFILE_COLORS as readonly string[]).includes(value)
}

function colorFor(index: number): ProfileColor {
  return PROFILE_COLORS[index % PROFILE_COLORS.length] ?? 'teal'
}

function insertProfile(index: number, input: NewProfileInput = {}): ProfileRow {
  const now = Date.now()
  return getDb()
    .insert(schema.profiles)
    .values({
      name: input.name?.trim() || null,
      color: isProfileColor(input.color) ? input.color : colorFor(index),
      targetLang: input.targetLang ?? 'en',
      nativeLang: input.nativeLang ?? 'pt-BR',
      goal: null,
      cefr: null,
      focusMix: 0.3,
      prefs: null,
      createdAt: now,
      // Só o primeiro perfil nasce "usado": os outros esperam a primeira troca.
      lastUsedAt: index === 0 ? now : null
    })
    .returning()
    .get()
}

export function profileById(profileId: number): ProfileRow | null {
  return getDb().select().from(schema.profiles).where(eq(schema.profiles.id, profileId)).get() ?? null
}

/** Perfis do aparelho: os usados por último primeiro (seletor e tela de perfis). */
export function listProfiles(): ProfileRow[] {
  return getDb()
    .select()
    .from(schema.profiles)
    .orderBy(
      sql`${schema.profiles.lastUsedAt} is null`,
      desc(sql`coalesce(${schema.profiles.lastUsedAt}, 0)`),
      asc(schema.profiles.id)
    )
    .all()
}

/**
 * Reexportado: `main/db` resolve o ponteiro (é estado de conexão), e os handlers
 * importam tudo de `./profiles` — um lugar só para "quem está estudando".
 */
export { activeProfile }

export function activeProfileId(): number {
  return activeProfile().id
}

/**
 * Como os handlers resolvem "de quem é isto": sem id = perfil ativo; com id
 * inexistente = erro (nunca o perfil de outra pessoa).
 */
export function resolveProfileId(profileId?: number | null): number {
  if (profileId == null) return activeProfileId()
  if (!profileById(profileId)) throw new Error('Perfil não encontrado.')
  return profileId
}

/** Troca o perfil ativo e avisa o resto do app (jobs em andamento, fila ociosa, renderer). */
export function setActiveProfile(profileId: number): ProfileRow {
  const row = profileById(profileId)
  if (!row) throw new Error('Perfil não encontrado.')

  writeActiveProfileId(row.id)
  touchProfileUsed(row.id)
  emitStudentEvent('profile-switched', String(row.id), row.id)
  return row
}

export function createProfile(input: NewProfileInput = {}): ProfileRow {
  const row = insertProfile(listProfiles().length, input)
  setActiveProfile(row.id)
  return row
}

export interface ProfilePatch {
  name?: string | null
  color?: string | null
  goal?: string | null
  focusMix?: number
}

/** Renomear / recolore / editar objetivo e mix de um perfil existente. */
export function updateProfile(profileId: number, patch: ProfilePatch): ProfileRow {
  if (!profileById(profileId)) throw new Error('Perfil não encontrado.')

  const set: {
    name?: string | null
    color?: string | null
    goal?: string | null
    focusMix?: number
  } = {}

  if (patch.name !== undefined) {
    const name = (patch.name ?? '').trim()
    if (name.length > 80) throw new Error('Nome de perfil tem no máximo 80 caracteres.')
    set.name = name || null
  }
  if (patch.color !== undefined) {
    if (patch.color && !isProfileColor(patch.color)) throw new Error('Cor de perfil inválida.')
    set.color = patch.color || null
  }
  if (patch.goal !== undefined) set.goal = (patch.goal ?? '').trim() || null
  if (patch.focusMix !== undefined) {
    if (!(patch.focusMix >= 0 && patch.focusMix <= 1)) throw new Error('Mix de foco fora de 0–1.')
    set.focusMix = patch.focusMix
  }

  if (Object.keys(set).length > 0) {
    getDb().update(schema.profiles).set(set).where(eq(schema.profiles.id, profileId)).run()
  }

  const fresh = profileById(profileId)
  if (!fresh) throw new Error('Perfil não encontrado.')
  return fresh
}

/** Ids das lições de um perfil: coluna nova + a cadeia antiga (unidade/trilha). */
function lessonIdsOf(profileId: number): number[] {
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
    for (const row of db
      .select({ id: schema.lessons.id })
      .from(schema.lessons)
      .where(inArray(schema.lessons.trackId, trackIds))
      .all()) {
      ids.add(row.id)
    }
  }

  return [...ids]
}

/**
 * Apaga um perfil e toda a memória dele. Deixar órfão para trás é o que faria o
 * export de um perfil posterior carregar linhas corrompidas — por isso as
 * tabelas sem FK cascade entram aqui explicitamente.
 */
export function deleteProfile(profileId: number): { remaining: number; switchedTo: number | null } {
  if (!profileById(profileId)) throw new Error('Perfil não encontrado.')

  const db = getDb()
  const lessonIds = lessonIdsOf(profileId)
  const trackIds = db
    .select({ id: schema.focusTracks.id })
    .from(schema.focusTracks)
    .where(eq(schema.focusTracks.profileId, profileId))
    .all()
    .map((row) => row.id)
  const conversationIds = db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.profileId, profileId))
    .all()
    .map((row) => row.id)

  db.transaction((tx) => {
    if (lessonIds.length > 0) {
      const exerciseIds = tx
        .select({ id: schema.exercises.id })
        .from(schema.exercises)
        .where(inArray(schema.exercises.lessonId, lessonIds))
        .all()
        .map((row) => row.id)

      if (exerciseIds.length > 0) {
        tx.delete(schema.attempts).where(inArray(schema.attempts.exerciseId, exerciseIds)).run()
      }
      tx.delete(schema.exercises).where(inArray(schema.exercises.lessonId, lessonIds)).run()
      tx.delete(schema.lessonProgress).where(inArray(schema.lessonProgress.lessonId, lessonIds)).run()
      tx.delete(schema.scenarioRuns).where(inArray(schema.scenarioRuns.lessonId, lessonIds)).run()
      // `lesson_items` sai pelo cascade da FK (foreign_keys = ON na conexão).
      tx.delete(schema.lessons).where(inArray(schema.lessons.id, lessonIds)).run()
    }

    if (conversationIds.length > 0) {
      tx.delete(schema.scenarioRuns).where(inArray(schema.scenarioRuns.conversationId, conversationIds)).run()
      // `messages` sai pelo cascade da FK.
      tx.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds)).run()
    }

    if (trackIds.length > 0) tx.delete(schema.trackLessons).where(inArray(schema.trackLessons.trackId, trackIds)).run()

    // `reviews` sai pelo cascade da FK de cards.
    tx.delete(schema.cards).where(eq(schema.cards.profileId, profileId)).run()
    tx.delete(schema.studySessions).where(eq(schema.studySessions.profileId, profileId)).run()
    tx.delete(schema.errors).where(eq(schema.errors.profileId, profileId)).run()
    tx.delete(schema.contentReports).where(eq(schema.contentReports.profileId, profileId)).run()
    tx.delete(schema.focusTracks).where(eq(schema.focusTracks.profileId, profileId)).run()
    tx.delete(schema.units).where(eq(schema.units.profileId, profileId)).run()
    tx.delete(schema.skillsState).where(eq(schema.skillsState.profileId, profileId)).run()

    // Segurança: lição marcada com o perfil mas não pega pela cadeia antiga.
    tx.delete(schema.lessons).where(eq(schema.lessons.profileId, profileId)).run()

    tx.delete(schema.profiles).where(eq(schema.profiles.id, profileId)).run()
  })

  emitStudentEvent('profile-deleted', String(profileId))

  const rest = listProfiles()
  if (rest.length === 0) {
    const created = insertProfile(0)
    writeActiveProfileId(created.id)
    emitStudentEvent('profile-switched', String(created.id), created.id)
    return { remaining: 1, switchedTo: created.id }
  }

  if (readActiveProfileId() === profileId) {
    const next = rest[0]
    if (next) {
      writeActiveProfileId(next.id)
      touchProfileUsed(next.id)
      emitStudentEvent('profile-switched', String(next.id), next.id)
      return { remaining: rest.length, switchedTo: next.id }
    }
  }

  return { remaining: rest.length, switchedTo: readActiveProfileId() }
}

/**
 * Projeção do perfil para a ponte IPC (v2): nome/cor/uso entram no
 * `ProfileView` — a UI de perfis não lê o banco, lê isto.
 */
export function profileViewOf(row: ProfileRow): ProfileView {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    targetLang: row.targetLang,
    nativeLang: row.nativeLang,
    goal: row.goal,
    cefr: (row.cefr as ProfileView['cefr']) ?? null,
    focusMix: row.focusMix,
    placementScore: row.placementScore,
    onboardingComplete: row.onboardingCompletedAt != null,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt
  }
}

export function countProfiles(): number {
  return Number(
    getDb()
      .select({ value: sql<number>`count(*)` })
      .from(schema.profiles)
      .get()?.value ?? 0
  )
}
