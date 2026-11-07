/**
 * Smoke test com IA real (manual, não é CI): roda os três contratos novos do M3
 * contra o provedor configurado. Só executa com LT_SMOKE=1, porque depende de um
 * modelo local de pé:
 *
 *   LT_SMOKE=1 LT_MODEL=gemma4:12b npx vitest run src/main/m3.smoke.test.ts
 *
 * O que ele guarda é o que o produto promete: o esboço da trilha vem preenchido,
 * o cenário vem com personagem e o feedback vem com as duas rubricas separadas.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { completeOnboarding } from './learning'
import { getDb, initDatabase, schema } from './db'
import { updateSettings } from './settings'
import { createTrackDraft, approveTrack, tracksView } from './tracks'
import { ensureLessonScenario, startScenarioRun, finishScenarioRun } from './scenario'

const enabled = process.env.LT_SMOKE === '1'
const model = process.env.LT_MODEL ?? ''

let profileId = 0

beforeAll(async () => {
  if (!enabled) return
  initDatabase()
  updateSettings({ provider: 'ollama', ollamaModel: model, focusMix: 0.3 })
  profileId = completeOnboarding({ goal: 'entrevista para dev', cefr: 'A2' }).profile.id
})

describe.skipIf(!enabled)('M3 com IA real', () => {
  it('gera e aprova uma trilha de entrevista', async () => {
    const draft = await createTrackDraft(profileId, { objective: 'entrevista para desenvolvedor backend' })

    expect(draft.plan?.source).toBe('ai')
    expect(draft.plan!.lessons.length).toBeGreaterThanOrEqual(4)
    expect(draft.plan!.lessons.every((lesson) => lesson.focusVocabulary.length > 0)).toBe(true)

    const approved = approveTrack(profileId, draft.id)
    expect(approved.lessons.length).toBe(draft.plan!.lessons.length)
    expect(approved.scenarioLesson).not.toBeNull()
  }, 240_000)

  it('gera cenário por IA e rubrica separada no fechamento', async () => {
    const track = tracksView(profileId).active[0]
    const lesson = track.scenarioLesson!

    const scenario = await ensureLessonScenario(lesson.id)
    expect(scenario.successCriteria.length).toBeGreaterThanOrEqual(2)

    const session = await startScenarioRun(profileId, { lessonId: lesson.id })
    for (const text of [
      'I have a background in backend work, I maintain two services.',
      'I led the migration to Kubernetes and we cut latency.',
      'What does the growth path look like in your team?'
    ]) {
      getDb()
        .insert(schema.messages)
        .values({ conversationId: session.conversation.id, role: 'user', content: text, corrections: null, createdAt: Date.now() })
        .run()
      getDb()
        .insert(schema.messages)
        .values({
          conversationId: session.conversation.id,
          role: 'assistant',
          content: 'Interesting. Tell me more.',
          corrections: null,
          createdAt: Date.now()
        })
        .run()
    }

    const run = await finishScenarioRun(profileId, session.conversation.id)
    expect(run.contentScore).toBeGreaterThanOrEqual(0)
    expect(run.languageScore).toBeGreaterThanOrEqual(0)
    expect(run.criteria).toHaveLength(session.scenario.successCriteria.length)
    expect(run.feedback.length).toBeGreaterThan(10)
  }, 240_000)
})
