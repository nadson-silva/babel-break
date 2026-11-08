/**
 * V2 — gerador determinístico de exercícios de voz.
 *
 * Importante para o plano: voz **não** depende de IA para existir. As frases vêm
 * do conteúdo da própria lição (qualquer idioma, já que o conteúdo existe), e o
 * lote só ganha `listen_repeat` quando há 4 alternativas reais — o contrato de
 * múltipla escolha não se quebra para enfeitar a lista.
 */
import { describe, expect, it } from 'vitest'
import { exerciseSetSchema, type LessonContentOutput } from './schemas'
import { DEFAULT_LOCALE } from './prompts'
import { fallbackExercises } from './fallback'

function content(overrides: Partial<LessonContentOutput> = {}): LessonContentOutput {
  return {
    title: 'Backend',
    level: 'A2',
    objective: 'Falar do seu trabalho',
    explanation: 'Explicação curta.',
    examples: [
      { target: 'I work on the backend', native: 'Eu trabalho com backend' },
      { target: 'I fix bugs every day', native: 'Eu corrijo erros todo dia' },
      { target: 'My team ships on Friday', native: 'Meu time publica na sexta' },
      { target: 'We review each other code', native: 'A gente revisa o código um do outro' },
      { target: 'The deploy failed twice', native: 'O deploy falhou duas vezes' }
    ],
    grammarPoints: [{ title: 'Present simple', explanation: 'Rotina.', examples: ['I work'] }],
    pitfalls: [],
    vocabulary: [
      { term: 'backend', translation: 'backend', example: 'I work on the backend' },
      { term: 'bug', translation: 'erro', example: 'I fix bugs every day' },
      { term: 'deploy', translation: 'implantação', example: 'The deploy failed twice' },
      { term: 'team', translation: 'time', example: 'My team ships on Friday' }
    ],
    ...overrides
  }
}

describe('com voz', () => {
  it('produz falar + ouvir e passa no contrato de schema', () => {
    const set = fallbackExercises(content(), [], DEFAULT_LOCALE, { tts: true, asr: true })
    const parsed = exerciseSetSchema.safeParse({ exercises: set.exercises })
    expect(parsed.success).toBe(true)

    const speak = set.exercises.find((exercise) => exercise.type === 'speak_sentence')
    const listen = set.exercises.find((exercise) => exercise.type === 'listen_repeat')

    expect(speak?.answer).toBeTruthy()
    expect(speak?.options).toEqual([])
    expect(listen?.options).toHaveLength(4)
    expect(listen?.options).toContain(listen?.answer)
  })

  it('sem alternativas suficientes, `listen_repeat` não nasce quebrado', () => {
    const thin = content({ examples: [{ target: 'I work', native: 'Eu trabalho' }] })
    const set = fallbackExercises(thin, [], DEFAULT_LOCALE, { tts: true, asr: true })
    expect(set.exercises.some((exercise) => exercise.type === 'listen_repeat')).toBe(false)
    expect(set.exercises.some((exercise) => exercise.type === 'speak_sentence')).toBe(true)
  })
})

describe('sem voz', () => {
  it('nenhum exercício de fala é gerado (nada de pedir o que o app não escuta)', () => {
    const set = fallbackExercises(content(), [], DEFAULT_LOCALE, { tts: false, asr: false })
    expect(set.exercises.some((exercise) => exercise.type === 'speak_sentence')).toBe(false)
    expect(set.exercises.some((exercise) => exercise.type === 'listen_repeat')).toBe(false)
  })
})
