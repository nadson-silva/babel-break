/**
 * Integração do M5 (sem IA e sem GUI): produto.
 *
 * Cobre os quatro mecanismos que fazem do app um produto e não um protótipo:
 *
 * - **cache primeiro**: lição já gerada abre sem tocar no provedor;
 * - **pré-geração honesta**: sem IA alcançável o ciclo não gera nada (e não
 *   congela a lição no gerador local pobre);
 * - **comportamento offline**: a sonda diz o estado, e o erro de geração vem no
 *   idioma do aluno;
 * - **reportar conteúdo ruim**: cada tipo tem efeito real e reversível.
 *
 * O provedor é apontado para uma porta que recusa conexão de propósito — o
 * caminho offline tem de funcionar igual, e é ele que este teste exercita.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, initDatabase, schema } from './db'
import { updateSettings } from './settings'
import {
  answerExercise,
  completeOnboarding,
  curriculumView,
  finishLesson,
  generateCurriculum,
  openLesson
} from './learning'
import { focusFor, notebookView, recordCorrections } from './notebook'
import { reportsSummary, submitReport, undoReport, undoReportForTarget } from './reports'
import { cacheStats, prewarmState, runPrewarmCycle } from './prewarm'
import { providerStatus, refreshProviderStatus, resetProviderStatus } from './provider-status'
import { dashboardView } from './dashboard'

let profileId = 0
let lessonId = 0

beforeAll(async () => {
  initDatabase()

  // Nada de IA: o teste exercita exatamente o caminho sem provedor.
  updateSettings({
    provider: 'ollama',
    ollamaModel: '',
    ollamaBaseUrl: 'http://127.0.0.1:1',
    pregenerate: true
  })
  resetProviderStatus()

  const state = completeOnboarding({ goal: 'entrevista para dev', cefr: 'A2' })
  profileId = state.profile.id
  await generateCurriculum()

  const first = curriculumView().units[0].lessons[0]
  lessonId = first.id
})

describe('cache primeiro + comportamento offline', () => {
  it('abre a lição e guarda conteúdo/exercícios no banco', async () => {
    const detail = await openLesson(lessonId)
    expect(detail.exercises.length).toBeGreaterThan(0)

    const stored = getDb()
      .select({ content: schema.lessons.content, version: schema.lessons.version })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId))
      .get()

    expect(stored?.content).toBeTruthy()

    // Segunda abertura: mesmo conteúdo, mesma versão — nada foi regerado.
    await openLesson(lessonId)
    const after = getDb()
      .select({ version: schema.lessons.version })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId))
      .get()

    expect(after?.version).toBe(stored?.version)
    expect(cacheStats().lessonsCached).toBeGreaterThan(0)
  })

  it('sonda diz que a IA está inacessível (e não explode)', async () => {
    resetProviderStatus()
    const status = await refreshProviderStatus({ force: true })

    expect(status.state).toBe('unreachable')
    expect(status.reachable).toBe(false)
    expect(status.local).toBe(true)
    expect(providerStatus().state).toBe('unreachable')
  })

  it('pré-geração não piora a lição quando a IA caiu', async () => {
    const before = cacheStats()
    const outcome = await runPrewarmCycle()

    expect(outcome.source).toBe('unavailable')
    expect(outcome.warmed.content).toBe(0)
    expect(outcome.attempted).toBe(0)
    expect(outcome.detail).toBeTruthy()

    const after = cacheStats()
    expect(after.prewarmedLessons).toBe(before.prewarmedLessons)
    expect(prewarmState().enabled).toBe(true)
  })

  it('desligada nas configurações, a fila nem sonda o provedor', async () => {
    updateSettings({ pregenerate: false })
    const outcome = await runPrewarmCycle()

    expect(outcome.source).toBe('skip')
    expect(outcome.detail).toContain('desativado')

    updateSettings({ pregenerate: true })
  })

  it('sessão de lição aberta e não concluída é fechada na próxima abertura', async () => {
    await openLesson(lessonId)
    await openLesson(lessonId)

    const open = getDb()
      .select({ id: schema.studySessions.id })
      .from(schema.studySessions)
      .where(
        and(
          eq(schema.studySessions.profileId, profileId),
          eq(schema.studySessions.kind, 'lesson'),
          isNull(schema.studySessions.endedAt)
        )
      )
      .all()

    // Só a sessão corrente fica em aberto; as órfãs de antes foram encerradas.
    expect(open.length).toBe(1)
  })
})

describe('reportar conteúdo ruim', () => {
  it('exercício reportado sai da prática, e a tentativa continua no histórico', async () => {
    const detail = await openLesson(lessonId)
    const target = detail.exercises[0]

    const report = submitReport({ kind: 'exercise', targetId: target.id, reason: 'wrong_answer', note: 'gabarito trocado' })
    expect(report.effect).toBe('exercise-removed')

    const blocked = getDb()
      .select({ blocked: schema.exercises.blocked })
      .from(schema.exercises)
      .where(eq(schema.exercises.id, target.id))
      .get()
    expect(blocked?.blocked).toBe(true)

    const reopened = await openLesson(lessonId)
    expect(reopened.exercises.some((exercise) => exercise.id === target.id)).toBe(false)
    expect(reopened.exercises.length).toBe(detail.exercises.length - 1)
    expect(cacheStats().exercisesHidden).toBe(1)
  })

  it('desfazer o report devolve o exercício', async () => {
    const before = await openLesson(lessonId)
    const list = reportsSummary(profileId, 50)
    const exerciseReport = list.recent.find((entry) => entry.kind === 'exercise')
    expect(exerciseReport).toBeDefined()

    const undone = undoReport(exerciseReport!.id)
    expect(undone?.undoneAt).toBeTruthy()

    const after = await openLesson(lessonId)
    expect(after.exercises.length).toBe(before.exercises.length + 1)
    expect(cacheStats().exercisesHidden).toBe(0)
  })

  it('explicação reportada marca o cache como velho e abre sem IA', async () => {
    const report = submitReport({ kind: 'lesson_content', targetId: lessonId, reason: 'confusing' })
    expect(report.effect).toBe('content-regenerates')

    const stale = getDb()
      .select({ staleAt: schema.lessons.staleAt })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId))
      .get()
    expect(stale?.staleAt).toBeTruthy()

    // Sem IA, manter o conteúdo bom é melhor que regenerar pior: a lição abre
    // e a marca de "velho" é limpa em vez de pedir para sempre.
    const detail = await openLesson(lessonId)
    expect(detail.content.explanation.length).toBeGreaterThan(20)

    const cleared = getDb()
      .select({ staleAt: schema.lessons.staleAt })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId))
      .get()
    expect(cleared?.staleAt).toBeNull()
  })

  it('correção injusta sai do foco das lições (e o caderno continua igual)', () => {
    const recorded = recordCorrections(
      profileId,
      [{ original: 'I am agree with you', corrected: 'I agree with you', tag: 'agreement', source: 'bank' }],
      { category: 'conversation' }
    )
    expect(recorded).toBe(1)

    const before = focusFor(profileId, 5)
    expect(before.some((entry) => entry.original === 'I am agree with you')).toBe(true)

    // O aluno contesta sem conhecer o id da linha: (tag, frase) resolve.
    const report = submitReport({
      kind: 'correction',
      targetId: null,
      reason: 'unfair_correction',
      context: { text: 'I am agree with you', tag: 'agreement' }
    })
    expect(report.effect).toBe('error-unfocused')
    expect(report.targetId).toBeTruthy()

    const notebook = notebookView(profileId)
    expect(notebook.disputedCount).toBe(1)
    const example = notebook.tags.find((tag) => tag.tag === 'agreement')?.examples[0]
    expect(example?.disputed).toBe(true)

    // Sai do foco de prompt, mas não some do caderno: é histórico, não censura.
    const after = focusFor(profileId, 5)
    expect(after.some((entry) => entry.original === 'I am agree with you')).toBe(false)

    // Reativar pelo alvo (o caderno só sabe o id do erro).
    const undone = undoReportForTarget('correction', report.targetId!)
    expect(undone?.undoneAt).toBeTruthy()
    expect(notebookView(profileId).disputedCount).toBe(0)
    expect(focusFor(profileId, 5).some((entry) => entry.original === 'I am agree with you')).toBe(true)
  })

  it('dois reports no mesmo alvo: desfazer um não desfaz o outro', () => {
    const first = submitReport({ kind: 'scenario', targetId: lessonId, reason: 'off_topic' })
    const second = submitReport({ kind: 'scenario', targetId: lessonId, reason: 'confusing' })

    undoReport(first.id)
    const list = reportsSummary(profileId, 50)
    const stillOpen = list.recent.find((entry) => entry.id === second.id)
    expect(stillOpen?.undoneAt).toBeNull()

    const scenarioReport = list.recent.find((entry) => entry.effect === 'logged')
    expect(scenarioReport).toBeDefined()
  })
})

describe('painel de Progresso', () => {
  it('fecha uma lição e mostra o que o app sabe', async () => {
    const detail = await openLesson(lessonId)
    for (const exercise of detail.exercises.slice(0, 2)) {
      await answerExercise({ exerciseId: exercise.id, response: 'zzz errado de propósito' })
    }
    finishLesson({ lessonId: detail.lesson.id, sessionId: detail.sessionId })

    const view = dashboardView()

    expect(view.profile.cefr).toBeTruthy()
    expect(view.lessons.completed).toBeGreaterThanOrEqual(1)
    expect(view.lessons.total).toBeGreaterThanOrEqual(1)
    expect(view.lessons.cached).toBeGreaterThanOrEqual(1)

    // Tempo: a sessão fechada existe; sem streak em lugar nenhum do payload.
    expect(view.time.totalMinutes).toBeGreaterThanOrEqual(0)
    expect(view.time.perDay).toHaveLength(30)
    expect(JSON.stringify(view)).not.toContain('streak')

    // Vocabulário: concluir lição criou cards; a curva do FSRS dá retenção.
    expect(view.vocabulary.total).toBeGreaterThan(0)

    // Caderno: a passada de correções acima deixou rastro.
    expect(view.errors.open + view.errors.resolved).toBeGreaterThan(0)

    // Reports e cache fazem parte do painel.
    expect(view.reports.total).toBeGreaterThan(0)
    expect(view.cache.lessonsTotal).toBeGreaterThan(0)
    expect(view.ai.state).toBe('unreachable')
  })
})
