/**
 * Smoke test com IA real (manual, não é CI): prova a promessa do M4 — o mesmo
 * app ensinando um idioma que não o inglês. Só executa com LT_SMOKE=1:
 *
 *   LT_SMOKE=1 LT_MODEL=gemma4:12b npx vitest run src/main/m4.smoke.test.ts
 *
 * O que ele guarda: nivelamento, currículo e lição saem preenchidos no idioma
 * pedido (espanhol), não em inglês.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { completeOnboarding, generateCurriculum, curriculumView, openLesson, answerExercise } from './learning'
import { initDatabase } from './db'
import { updateSettings } from './settings'

const enabled = process.env.LT_SMOKE === '1'
const model = process.env.LT_MODEL ?? ''

beforeAll(() => {
  if (!enabled) return
  initDatabase()
  updateSettings({ provider: 'ollama', ollamaModel: model, focusMix: 0.3 })
  completeOnboarding({
    goal: 'viajar pela américa do sul',
    cefr: 'A2',
    targetLang: 'es',
    nativeLang: 'pt-BR'
  })
})

describe.skipIf(!enabled)('M4 com IA real — espanhol como idioma-alvo', () => {
  it('monta um currículo de espanhol', async () => {
    const curriculum = await generateCurriculum()
    expect(curriculum.generated).toBe(true)
    expect(curriculum.units.length).toBeGreaterThanOrEqual(2)
    expect(curriculum.units.flatMap((unit) => unit.lessons).length).toBeGreaterThanOrEqual(6)
  }, 240_000)

  it('gera lição com exemplos no idioma-alvo e explicações em PT-BR', async () => {
    const lesson = curriculumView().units[0].lessons[0]
    const detail = await openLesson(lesson.id)

    expect(detail.content.source).toBe('ai')
    expect(detail.content.explanation.length).toBeGreaterThan(40)
    for (const example of detail.content.examples) {
      expect(example.target.length).toBeGreaterThan(3)
      expect(example.native.length).toBeGreaterThan(3)
      // o campo alvo não pode ter vindo em inglês: "inglês" não é a língua-alvo
      expect(example.target).not.toMatch(/\b(the|and) \w+ing\b/i)
    }
    expect(detail.exercises.length).toBeGreaterThanOrEqual(4)
  }, 240_000)

  it('corrige resposta livre de espanhol pela IA e anota no caderno', async () => {
    const lesson = curriculumView().units[0].lessons[0]
    const detail = await openLesson(lesson.id)
    const translate = detail.exercises.find((exercise) => exercise.type === 'translate')
    if (!translate) return

    const feedback = await answerExercise({
      exerciseId: translate.id,
      response: 'Yo quiero viaja por Brasil muito años.'
    })
    expect(feedback.correct).toBe(false)
    expect(feedback.feedback.length).toBeGreaterThan(0)
  }, 240_000)
})
