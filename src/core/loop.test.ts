import { describe, expect, it } from 'vitest'
import { errorFocus } from './adapt'
import { fallbackExercises, fallbackLessonContent } from './fallback'
import { DEFAULT_LOCALE, exercisePrompt, lessonContentPrompt, tutorSystem } from './prompts'

const content = fallbackLessonContent({
  title: 'Rotina e passado',
  objective: 'Contar ações concluídas no passado',
  level: 'A2'
})

describe('conteúdo determinístico adaptado ao caderno', () => {
  it('traz armadilhas PT-BR mesmo sem IA', () => {
    expect(content.pitfalls?.length).toBeGreaterThan(0)
    for (const pitfall of content.pitfalls ?? []) {
      expect(pitfall.wrong).not.toBe(pitfall.right)
      expect(pitfall.note.length).toBeGreaterThan(8)
    }
  })

  it('usa o erro do aluno na explicação quando ele existe', () => {
    const focus = errorFocus([
      {
        tag: 'past-simple',
        category: 'conversation',
        original: "I didn't went there.",
        corrected: "I didn't go there.",
        note: 'Depois de did, forma base.',
        occurrences: 4,
        lastSeen: 2,
        resolvedAt: null
      }
    ])

    const adapted = fallbackLessonContent({
      title: 'Contando o que aconteceu',
      objective: 'Narrar no passado',
      level: 'A2',
      errors: focus
    })

    expect(adapted.explanation).toContain("I didn't go there.")
    expect(adapted.pitfalls?.[0].tag).toBe('past-simple')

    const exercises = fallbackExercises(adapted, focus)
    const targeted = exercises.exercises.filter((exercise) => exercise.targetTags.includes('past-simple'))
    expect(targeted.length).toBeGreaterThanOrEqual(1)
  })

  it('gera 6 a 8 exercícios com gabarito coerente', () => {
    const exercises = fallbackExercises(content)
    expect(exercises.exercises.length).toBeGreaterThanOrEqual(6)
    for (const exercise of exercises.exercises) {
      expect(exercise.answer.length).toBeGreaterThan(0)
      if (exercise.type === 'multiple_choice') {
        expect(exercise.options).toContain(exercise.answer)
      }
      if (exercise.type === 'order') {
        expect(exercise.tokens.length).toBeGreaterThan(1)
      }
    }
  })

  it('cloze do fallback traz a tradução da palavra como dica no enunciado', () => {
    const exercises = fallbackExercises(content)
    const cloze = exercises.exercises.find((exercise) => exercise.type === 'cloze')
    expect(cloze).toBeDefined()
    expect(cloze?.prompt).toContain('___')
    // sem dica entre parênteses o aluno não tem como saber qual palavra esperar
    expect(cloze?.prompt).toMatch(/\([^)]+\)/)
    expect(cloze?.prompt.replace(/___/g, '')).not.toContain(cloze!.answer)
  })

  it('conteúdo local respeita o nível: C1 não recebe frases de A2', () => {
    const c1 = fallbackLessonContent({
      title: 'Discourse markers',
      objective: 'organizar um discurso com marcadores naturais',
      level: 'C1'
    })

    expect(c1.examples[0].target).not.toBe('I study English every day.')
    expect(c1.vocabulary.map((item) => item.term)).toContain('nevertheless')
    expect(c1.vocabulary.map((item) => item.term)).not.toContain('sometimes')

    // e o exercício local de C1 sai do vocabulário avançado, com dica de tradução
    const cloze = fallbackExercises(c1).exercises.find((exercise) => exercise.type === 'cloze')
    expect(cloze?.prompt).toContain('___')
    expect(cloze?.prompt).toContain('ainda assim')

    const a2 = fallbackLessonContent({ title: 'X', objective: 'y', level: 'A2' })
    expect(a2.vocabulary.map((item) => item.term)).toContain('study')
  })
})

describe('prompts do loop', () => {
  const focus = errorFocus(
    [
      {
        tag: 'articles',
        category: 'exercise',
        original: 'I am developer.',
        corrected: 'I am a developer.',
        note: 'Profissão pede artigo.',
        occurrences: 3,
        lastSeen: 1,
        resolvedAt: null
      }
    ],
    4
  )

  it('lição e exercícios recebem os erros recorrentes', () => {
    const lesson = lessonContentPrompt({
      title: 'Profissões',
      objective: 'Falar do que você faz',
      unitTitle: 'Trabalho',
      level: 'A2',
      goal: 'entrevista para dev',
      errors: focus.map((entry) => ({ ...entry })),
      locale: DEFAULT_LOCALE
    })
    expect(lesson.user).toContain('articles (3x)')
    expect(lesson.user).toContain('I am a developer.')
    expect(lesson.user).toContain('pitfalls')

    const exercises = exercisePrompt({
      content,
      level: 'A2',
      goal: 'entrevista para dev',
      errors: focus.map((entry) => ({ ...entry })),
      locale: DEFAULT_LOCALE
    })
    expect(exercises.user).toContain('targetTags')
    expect(exercises.user).toContain('Pelo menos 2 exercícios')
  })

  it('system do tutor carrega nível, política, erros e resumo', () => {
    const system = tutorSystem({
      level: 'B1',
      goal: 'viagem',
      style: 'explicit',
      errors: focus.map((entry) => ({ ...entry })),
      vocabulary: [{ term: 'flight', translation: 'voo' }],
      summary: 'O aluno falou do trabalho.',
      lesson: { title: 'Passado simples', objective: 'Narrar', grammar: ['Past simple'] },
      topic: 'rotina',
      locale: DEFAULT_LOCALE
    })

    expect(system).toContain('B1')
    expect(system).toContain('correção explícita')
    expect(system).toContain('articles (3x)')
    expect(system).toContain('flight')
    expect(system).toContain('O aluno falou do trabalho.')
    expect(system).toContain('Passado simples')
    expect(system).toContain('rotina')
  })
})
