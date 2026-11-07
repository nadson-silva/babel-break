/**
 * M6 (B2 / critérios nº 1–2 do plano): fechar a conversa A não toca nas
 * `study_sessions` de B, e o fechamento é idempotente — um fechamento gera um
 * recap com reestimativa; o segundo não refaz efeito nenhum.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { and, desc, eq } from 'drizzle-orm'
import { getDb, initDatabase, schema } from './db'
import { completeOnboarding } from './learning'
import { closeConversation, createConversation } from './tutor'

let profileId = 0

beforeAll(() => {
  initDatabase()
  profileId = completeOnboarding({ goal: 'conversas de trabalho', cefr: 'B1' }).profile.id
})

function openSessionFor(conversationId: number) {
  return (
    getDb()
      .select()
      .from(schema.studySessions)
      .where(
        and(
          eq(schema.studySessions.profileId, profileId),
          eq(schema.studySessions.kind, 'conversation')
        )
      )
      .orderBy(desc(schema.studySessions.id))
      .all()
      .find((row) => (row.summary ?? '').includes(`"conversationId":${conversationId}`)) ?? null
  )
}

describe('fechamento de conversa escopado e idempotente (M6/B2)', () => {
  it("fechar A encerra só a sessão de A; a de B segue aberta", async () => {
    const a = await createConversation(profileId, { topic: 'café' })
    const b = await createConversation(profileId, { topic: 'trânsito' })

    closeConversation(profileId, a.conversation.id)

    expect(openSessionFor(a.conversation.id)?.endedAt).toBeTruthy()
    expect(openSessionFor(b.conversation.id)?.endedAt).toBeNull()

    const closedA = getDb()
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, a.conversation.id))
      .get()
    const openB = getDb()
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, b.conversation.id))
      .get()
    expect(closedA?.closedAt).toBeTruthy()
    expect(openB?.closedAt).toBeNull()
  })

  it("o segundo fechamento do mesmo recap não reestima nível nem recria cards", async () => {
    const c = await createConversation(profileId, {})
    const first = closeConversation(profileId, c.conversation.id)

    const profileAfterFirst = getDb()
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, profileId))
      .get()
    const cardsAfterFirst = getDb()
      .select()
      .from(schema.cards)
      .all()
      .length

    const second = closeConversation(profileId, c.conversation.id)

    expect(first.cardsCreated).toBeGreaterThanOrEqual(0)
    expect(second.cardsCreated).toBe(0)
    expect(second.levelChange).toBeNull()

    const profileAfterSecond = getDb()
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, profileId))
      .get()
    expect(profileAfterSecond?.cefr).toBe(profileAfterFirst?.cefr)
    expect(getDb().select().from(schema.cards).all().length).toBe(cardsAfterFirst)
  })
})
