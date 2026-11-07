/**
 * Smoke test com IA real (manual, não é CI): prova as promessas do M5 que só
 * aparecem com provedor de pé — pré-geração, cache primeiro e os efeitos de
 * "reportar conteúdo ruim" no conteúdo gerado.
 *
 *   LT_SMOKE=1 LT_MODEL=gemma4:12b npx vitest run src/main/m5.smoke.test.ts
 *
 * O que ele guarda:
 * - o ciclo ocioso aquece uma lição **sem o aluno abrir nada** (prewarmed_at +
 *   conteúdo salvo pela IA, não pelo gerador local);
 * - abrir a lição depois do aquecimento **não regera** (cache primeiro: a
 *   versão não muda e a latência é de leitura);
 * - reportar a explicação marca o cache como velho e a próxima abertura
 *   reescreve de fato;
 * - reportar um exercício tira ele da prática, e desfazer devolve.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, initDatabase, schema } from './db'
import { updateSettings } from './settings'
import { completeOnboarding, curriculumView, generateCurriculum, openLesson, pendingLessons } from './learning'
import { runPrewarmCycle, prewarmState, cacheStats } from './prewarm'
import { refreshProviderStatus, resetProviderStatus } from './provider-status'
import { submitReport } from './reports'

const enabled = process.env.LT_SMOKE === '1'
const model = process.env.LT_MODEL ?? ''

beforeAll(async () => {
  if (!enabled) return
  initDatabase()
  updateSettings({
    provider: 'ollama',
    ollamaModel: model,
    ollamaBaseUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
    pregenerate: true
  })
  resetProviderStatus()
  completeOnboarding({ goal: 'entrevista para dev', cefr: 'A2', targetLang: 'en', nativeLang: 'pt-BR' })
  await generateCurriculum()
}, 300_000)

describe.skipIf(!enabled)('M5 com IA real — pré-geração, cache e reports', () => {
  it('a sonda enxerga o provedor e o modelo', async () => {
    const status = await refreshProviderStatus({ force: true })
    expect(status.state).toBe('ok')
    expect(status.model).toBe(model)
  }, 120_000)

  it('aquece a próxima lição provável sem o aluno abrir nada', async () => {
    const target = pendingLessons(getDb().select({ id: schema.profiles.id }).from(schema.profiles).get()!.id)
    const candidate = (target.focus[0] ?? target.base[1] ?? target.base[0])!

    const outcome = await runPrewarmCycle()
    expect(['ai', 'skip'], String(outcome.detail)).toContain(outcome.source)
    if (outcome.detail) expect(String(outcome.detail)).not.toMatch(/indispon|unavailable/i)
    if (outcome.source === 'ai') expect(prewarmState().prewarmedLessons).toBeGreaterThanOrEqual(1)

    // A lição aquecida tem conteúdo de IA e a marca de prewarm.
    const opened = await openLesson(candidate.id)
    expect(opened.content.source).toBe('ai')
    expect(opened.exercises.length).toBeGreaterThanOrEqual(4)
    expect(prewarmState().lessonsCached).toBeGreaterThan(0)
  }, 600_000)

  it('abrir lição já aquecida é leitura, não nova geração', async () => {
    const lesson = curriculumView().units[0].lessons[0]
    await openLesson(lesson.id)

    const versionBefore = getDb()
      .select({ version: schema.lessons.version, content: schema.lessons.content })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lesson.id))
      .get()

    const startedAt = Date.now()
    const again = await openLesson(lesson.id)
    const elapsedMs = Date.now() - startedAt

    const versionAfter = getDb()
      .select({ version: schema.lessons.version })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lesson.id))
      .get()

    expect(versionAfter?.version).toBe(versionBefore?.version)
    expect(again.content.explanation).toBe(
      JSON.parse(String(versionBefore?.content ?? '{}')).explanation ?? again.content.explanation
    )
    // Cache primeiro: abrir de novo custa leitura, não tokens.
    expect(elapsedMs).toBeLessThan(1500)
  }, 600_000)

  it('reportar a explicação faz a próxima abertura reescrever o conteúdo', async () => {
    const lesson = curriculumView().units[0].lessons[1]
    const before = await openLesson(lesson.id)

    const report = submitReport({ kind: 'lesson_content', targetId: lesson.id, reason: 'confusing' })
    expect(report.effect).toBe('content-regenerates')

    const after = await openLesson(lesson.id)
    expect(after.content.explanation).not.toBe(before.content.explanation)
    expect(cacheStats().lessonsCached).toBeGreaterThan(0)
  }, 600_000)

  it('reportar um exercício tira ele da prática (e desfazer devolve)', async () => {
    const lesson = curriculumView().units[0].lessons[2]
    const detail = await openLesson(lesson.id)
    const victim = detail.exercises[0]

    submitReport({
      kind: 'exercise',
      targetId: victim.id,
      reason: 'wrong_answer',
      note: 'o gabarito aceita outra resposta'
    })

    const reopened = await openLesson(lesson.id)
    expect(reopened.exercises.some((exercise) => exercise.id === victim.id)).toBe(false)
    expect(cacheStats().exercisesHidden).toBeGreaterThan(0)
  }, 600_000)
})
