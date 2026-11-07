/**
 * Integração do M3 (sem IA e sem GUI): a trilha nasce rascunho, é revisada e
 * aprovada; as lições de foco entram no catálogo certo, no mix de recomendação e
 * no roleplay com rubrica de tarefa separada da de língua.
 *
 * Sem modelo configurado tudo cai no determinístico — que é justamente o caminho
 * que precisa continuar funcionando offline.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Correction } from '../shared/types'
import { bankCorrections } from '../core/correction'
import { isScenarioLesson } from '../core/tracks'
import { getDb, initDatabase, schema } from './db'
import {
  completeOnboarding,
  curriculumView,
  finishLesson,
  generateCurriculum,
  lastOpenedLesson,
  openLesson
} from './learning'
import {
  approveTrack,
  createTrackDraft,
  discardTrackDraft,
  ownerOfLesson,
  reviseTrackDraft,
  setTrackStatus,
  trackContextOf,
  tracksView
} from './tracks'
import { ensureLessonScenario, finishScenarioRun, scenarioRuns, startScenarioRun } from './scenario'
import { homeState } from './home'
import { updateSettings } from './settings'
import { abandonGuidedSession, startGuidedSession } from './guided'
import { openConversationView } from './tutor'
import { reviewState } from './review'

let profileId = 0
let trackId = 0

beforeAll(async () => {
  initDatabase()

  const state = completeOnboarding({ goal: 'entrevista para dev', cefr: 'A2' })
  profileId = state.profile.id

  await generateCurriculum()
})

describe('esboço antes da lição', () => {
  it('gera rascunho revisável sem criar lição nenhuma', async () => {
    const draft = await createTrackDraft(profileId, { objective: 'entrevista para desenvolvedor backend' })
    trackId = draft.id

    expect(draft.status).toBe('draft')
    expect(draft.plan).not.toBeNull()
    expect(draft.lessons).toHaveLength(0)
    expect(draft.totalCount).toBe(0)
    expect(draft.plan?.source).toBe('fallback')
    expect(draft.levelRange).toBe('A2–B1')

    // nada vazou para o catálogo do currículo base
    const baseLessons = curriculumView().units.flatMap((unit) => unit.lessons)
    expect(baseLessons.every((lesson) => lesson.trackId === null)).toBe(true)
  })

  it('rascunho não pode ser arquivado antes da aprovação', async () => {
    expect(() => setTrackStatus(profileId, trackId, 'archived')).toThrowError(/Aprove o esboço/)
  })

  it('a revisão remove lições e mantém no mínimo três', () => {
    const plan = tracksView(profileId).drafts[0].plan
    expect(plan).not.toBeNull()

    const trimmed = plan!.lessons.slice(0, 3).map((lesson) => ({ ...lesson, title: `${lesson.title} (editado)` }))
    const revised = reviseTrackDraft(profileId, trackId, trimmed)

    expect(revised.plan?.lessons).toHaveLength(3)
    expect(revised.plan?.lessons[0].title).toContain('(editado)')
    expect(() => reviseTrackDraft(profileId, trackId, trimmed.slice(0, 2))).toThrowError(/pelo menos 3/i)
  })
})

describe('trilha aprovada', () => {
  it('aprovar cria as lições no nível do aluno, com cenário no fechamento', () => {
    const approved = approveTrack(profileId, trackId)

    expect(approved.status).toBe('active')
    expect(approved.approvedAt).not.toBeNull()
    expect(approved.lessons).toHaveLength(3)
    expect(approved.lessons.every((lesson) => lesson.level === 'A2')).toBe(true)

    const last = approved.lessons[approved.lessons.length - 1]
    expect(last.isScenario).toBe(true)
    expect(approved.scenarioLesson?.id).toBe(last.id)
    expect(isScenarioLesson(2, 3)).toBe(true)
  })

  it('lição de trilha pertence ao perfil pela trilha, não por unidade', () => {
    const lesson = tracksView(profileId).active[0].lessons[0]
    const owner = ownerOfLesson(lesson.id, profileId)

    expect(owner?.trackId).toBe(trackId)
    expect(owner?.unitId).toBeNull()
    expect(owner?.trackTitle).toBeTruthy()
  })

  it('abrir a lição usa o vocabulário-alvo do domínio', async () => {
    const lesson = tracksView(profileId).active[0].lessons[0]
    const detail = await openLesson(lesson.id)

    expect(detail.content.source).toBe('fallback')
    expect(detail.exercises.length).toBeGreaterThanOrEqual(6)
    expect(detail.lesson.trackId).toBe(trackId)
    expect(detail.lesson.trackTitle).toBeTruthy()

    // vocabulário do domínio de entrevista, não o genérico do fallback base
    const terms = detail.content.vocabulary.map((item) => item.term)
    expect(terms.some((term) => /background|stack|maintain|trade-off|deadline/.test(term))).toBe(true)
    expect(terms.some((term) => term === 'study')).toBe(false)

    const row = getDb().select().from(schema.lessons).where(eq(schema.lessons.id, lesson.id)).get()!
    const context = trackContextOf(row)
    expect(context?.vocabulary.length).toBeGreaterThan(0)
    expect(context?.goalTag).toBe('interview')
  })

  it('concluir lição de trilha conta no progresso da trilha', async () => {
    const lesson = tracksView(profileId).active[0].lessons[0]
    const detail = await openLesson(lesson.id)
    finishLesson({ lessonId: lesson.id, sessionId: detail.sessionId })

    const track = tracksView(profileId).active[0]
    expect(track.completedCount).toBe(1)
    expect(homeState().tracks[0]?.id).toBe(trackId)
  })
})

describe('mix nas recomendações', () => {
  it('a sugestão vem da camada que o mix pede naquele momento', () => {
    const suggestion = homeState().suggestion

    expect(suggestion).not.toBeNull()
    if (suggestion?.origin === 'focus') {
      expect(suggestion.lesson.trackId).toBe(trackId)
      expect(suggestion.reason).toContain('trilha')
    } else {
      expect(suggestion?.lesson.trackId).toBeNull()
      expect(suggestion?.reason).toContain('currículo base')
    }
  })

  it('focus_mix = 0 desliga a trilha das sugestões', () => {
    updateSettings({ focusMix: 0 })

    const suggestion = homeState().suggestion
    expect(suggestion?.origin).toBe('base')

    updateSettings({ focusMix: 1 })
    expect(homeState().suggestion?.origin).toBe('focus')

    updateSettings({ focusMix: 0.3 })
  })

  it('nenhuma camada some do mix: base e trilha seguem sugeríveis', () => {
    const state = homeState()

    expect(state.units.length).toBeGreaterThan(0)
    expect(state.tracks).toHaveLength(1)
    expect(state.nextLesson === null || state.nextLesson?.trackId === null).toBe(true)
    expect(state.tracks[0].nextLesson).not.toBeNull()
  })

  it('"continuar de onde parei" alcança lição de trilha', async () => {
    const open = tracksView(profileId).active[0].lessons.find((lesson) => lesson.status !== 'completed')!
    await openLesson(open.id)

    expect(lastOpenedLesson(profileId)?.trackId).toBe(trackId)
    expect(homeState().continueLesson?.trackId).toBe(trackId)
  })
})

describe('modo cenário e rubrica', () => {
  it('lição de foco tem cenário guardado, pronto sem IA', async () => {
    const scenarioLesson = tracksView(profileId).active[0].scenarioLesson!
    const scenario = await ensureLessonScenario(scenarioLesson.id)

    expect(scenario.source).toBe('fallback')
    expect(scenario.successCriteria.length).toBeGreaterThanOrEqual(2)
    expect(scenario.openingLine.length).toBeGreaterThan(5)

    // cache: a segunda leitura não regasta nada
    const again = await ensureLessonScenario(scenarioLesson.id)
    expect(again.persona).toBe(scenario.persona)
  })

  it('abrir o roleplay cria conversa em modo cenário já em personagem', async () => {
    const scenarioLesson = tracksView(profileId).active[0].scenarioLesson!
    const session = await startScenarioRun(profileId, { lessonId: scenarioLesson.id })

    expect(session.conversation.mode).toBe('scenario')
    expect(session.scenario.persona).toBeTruthy()

    const messages = getDb()
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, session.conversation.id))
      .all()

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].content).toBe(session.scenario.openingLine)

    const view = openConversationView(profileId, session.conversation.id)
    expect(view.scenario?.persona).toBe(session.scenario.persona)
  })

  it('encerrar o cenário separa tarefa de língua e grava a rubrica', async () => {
    const session = await startScenarioRun(profileId, { topic: 'entrevista para dev' })
    const conversationId = session.conversation.id

    const corrections: Correction[] = bankCorrections('I have 25 years and I am developer.')
    expect(corrections.length).toBeGreaterThan(0)

    const studentLines = [
      'I have a background in backend, I maintain two services.',
      'I led the migration and we cut latency by forty percent.',
      'What does the growth path look like here?'
    ]

    for (const text of studentLines) {
      getDb()
        .insert(schema.messages)
        .values({
          conversationId,
          role: 'user',
          content: text,
          corrections: JSON.stringify(corrections),
          createdAt: Date.now()
        })
        .run()
      getDb()
        .insert(schema.messages)
        .values({
          conversationId,
          role: 'assistant',
          content: 'Nice. And the next step?',
          corrections: null,
          createdAt: Date.now()
        })
        .run()
    }

    const run = await finishScenarioRun(profileId, conversationId)

    expect(run.source).toBe('fallback')
    expect(run.contentScore).toBeGreaterThan(0)
    expect(run.languageScore).toBeLessThan(1)
    expect(run.contentScore).not.toBe(run.languageScore)
    expect(run.criteria).toHaveLength(session.scenario.successCriteria.length)
    expect(run.followUpDrill.length).toBeGreaterThan(10)

    expect(openConversationView(profileId, conversationId).conversation.closed).toBe(true)

    const stored = getDb()
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.conversationId, conversationId))
      .all()
    expect(stored).toHaveLength(1)
    expect(scenarioRuns(profileId).some((entry) => entry.id === run.runId)).toBe(true)
    expect(reviewState(profileId, 50).total).toBeGreaterThan(0)
  })

  it('conversa curta não ganha nota de tarefa inflada', async () => {
    const session = await startScenarioRun(profileId, { topic: 'daily standup' })
    getDb()
      .insert(schema.messages)
      .values({
        conversationId: session.conversation.id,
        role: 'user',
        content: 'Yesterday I finished the login flow.',
        corrections: null,
        createdAt: Date.now()
      })
      .run()

    const run = await finishScenarioRun(profileId, session.conversation.id)
    expect(run.source).toBe('fallback')
    expect(run.contentScore).toBeLessThan(1)
    expect(run.feedback.length).toBeGreaterThan(10)
  })
})

describe('trilha arquivada preserva progresso', () => {
  it('arquivar tira do mix e reativar devolve as lições prontas', () => {
    const before = tracksView(profileId).active[0]
    const archived = setTrackStatus(profileId, trackId, 'archived')

    expect(archived.status).toBe('archived')
    expect(archived.completedCount).toBe(before.completedCount)
    expect(tracksView(profileId).active.some((track) => track.id === trackId)).toBe(false)

    const revived = setTrackStatus(profileId, trackId, 'active')
    expect(revived.completedCount).toBe(before.completedCount)
    expect(revived.totalCount).toBe(before.totalCount)
  })

  it('rascunho novo pode ser descartado', async () => {
    const draft = await createTrackDraft(profileId, { objective: 'viagem para o japão' })
    expect(draft.status).toBe('draft')

    discardTrackDraft(profileId, draft.id)
    expect(tracksView(profileId).drafts.some((track) => track.id === draft.id)).toBe(false)
  })
})

describe('sessão guiada com trilha', () => {
  it('segue a lição em andamento da trilha', async () => {
    abandonGuidedSession(profileId)

    const session = await startGuidedSession(profileId)
    const owner = session.lessonId ? ownerOfLesson(session.lessonId, profileId) : null

    expect(session.lessonId).not.toBeNull()
    expect(owner?.trackId === trackId || owner?.unitId != null).toBe(true)
  })
})
