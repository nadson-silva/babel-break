import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  exercisePrompt,
  lessonContentPrompt,
  scenarioFeedbackPrompt,
  scenarioGenPrompt,
  trackPlanPrompt,
  tutorSystem
} from './prompts'
import { fallbackLessonContent } from './fallback'
import {
  TRACK_SUGGESTIONS,
  criterionWords,
  detectBucket,
  fallbackScenario,
  fallbackTrackPlan,
  isScenarioLesson,
  levelRangeFrom,
  normalizeTrackPlan,
  pickRecommendationOrigin,
  scenarioFeedbackFrom,
  trackTerms
} from './tracks'
import { scenarioSchema, trackPlanSchema } from './schemas'

describe('domínio da trilha', () => {
  it('recogniza o pedido em português e em inglês', () => {
    expect(detectBucket('quero passar numa entrevista para dev backend')).toBe('interview')
    expect(detectBucket('hiring')).toBe('interview')
    expect(detectBucket('daily standup com o time')).toBe('work')
    expect(detectBucket('viagem para lisboa')).toBe('travel')
    expect(detectBucket('ielts speaking')).toBe('exam')
    expect(detectBucket('qualquer coisa aleatória')).toBe('general')
  })

  it('as sugestões do onboarding cabem no próprio detector', () => {
    for (const suggestion of TRACK_SUGGESTIONS) {
      expect(detectBucket(suggestion.objective)).toBe(suggestion.goalTag)
      expect(suggestion.title.length).toBeGreaterThan(3)
    }
  })
})

describe('esboço gerado pela IA', () => {
  it('normaliza, limita e não deixa lição sem vocabulário', () => {
    const inflated = {
      title: '  Entrevista para dev  ',
      goalTag: 'Entrevista Para DEV!!',
      lessons: Array.from({ length: 14 }, (_, index) => ({
        title: index === 0 ? 'Se apresentar' : `Lição ${index}`,
        objective: 'falar de si',
        focusVocabulary: ['  background ', '', 'stack']
      }))
    }

    const plan = normalizeTrackPlan({ raw: inflated, objective: 'entrevista para dev', level: 'A2' })

    expect(plan.title).toBe('Entrevista para dev')
    expect(plan.goalTag).toBe('entrevista-para-dev')
    expect(plan.lessons.length).toBeLessThanOrEqual(8)
    expect(plan.lessons[0].focusVocabulary).toEqual(['background', 'stack'])
  })

  it('preenche do banco local quando a IA devolve esboço vazio', () => {
    const plan = normalizeTrackPlan({ raw: { lessons: [] }, objective: 'viagem', level: 'B1' })

    expect(plan.lessons.length).toBeGreaterThan(0)
    expect(plan.lessons.every((lesson) => lesson.focusVocabulary.length > 0)).toBe(true)
    expect(detectBucket(plan.title)).toBe('travel')
  })

  it('rejeita duplicatas de título', () => {
    const plan = normalizeTrackPlan({
      raw: {
        title: 'X',
        goalTag: 'x',
        lessons: [
          { title: 'Mesma coisa', objective: 'a', focusVocabulary: ['one'] },
          { title: 'Mesma coisa', objective: 'b', focusVocabulary: ['two'] },
          { title: 'Outra', objective: 'c', focusVocabulary: ['three'] },
          { title: 'Quarta', objective: 'd', focusVocabulary: ['four'] }
        ]
      },
      objective: 'trabalho',
      level: 'A2'
    })

    expect(plan.lessons.filter((lesson) => lesson.title === 'Mesma coisa')).toHaveLength(1)
  })
})

describe('trilha determinística (sem IA)', () => {
  it('valida contra o mesmo schema que a IA precisa cumprir', () => {
    for (const suggestion of TRACK_SUGGESTIONS) {
      const plan = fallbackTrackPlan({ objective: suggestion.objective, level: 'A2' })
      expect(trackPlanSchema.safeParse(plan).success, suggestion.title).toBe(true)
      expect(plan.lessons.length).toBeGreaterThanOrEqual(4)
    }
  })

  it('mantém o vocabulário do domínio com tradução e exemplo', () => {
    const terms = trackTerms('interview', 0)

    expect(terms.length).toBeGreaterThanOrEqual(4)
    for (const term of terms) {
      expect(term.term).toBeTruthy()
      expect(term.translation).toBeTruthy()
      expect(term.example).toBeTruthy()
    }
  })

  it('trilha de entrevista não entrega linguagem C1: nível é o do aluno', () => {
    const plan = fallbackTrackPlan({ objective: 'entrevista para dev', level: 'A2' })
    expect(levelRangeFrom('A2')).toBe('A2–B1')
    expect(plan.lessons.length).toBeGreaterThan(0)
  })
})

describe('cadência de cenário', () => {
  it('tem roleplay a cada 3ª lição de foco e no fechamento da trilha', () => {
    const total = 6
    const scenarioPositions = Array.from({ length: total }, (_, index) => index).filter((index) =>
      isScenarioLesson(index, total)
    )

    expect(scenarioPositions).toEqual([2, 5])
    expect(isScenarioLesson(0, 1)).toBe(true)
    expect(isScenarioLesson(0, 0)).toBe(false)
  })

  it('cenário local valida no schema e abre a conversa em inglês', () => {
    const scenario = fallbackScenario('interview')

    expect(scenarioSchema.safeParse(scenario).success).toBe(true)
    expect(scenario.successCriteria.length).toBeGreaterThanOrEqual(3)
    expect(scenario.persona.length).toBeGreaterThan(8)
    // A fala do personagem é em inglês; a ficha da tarefa, em português.
    expect(scenario.openingLine).toMatch(/[a-z]/i)
    expect(scenario.setting).toMatch(/[áéíóúçã]/i)
  })
})

describe('mix de recomendação (focus_mix)', () => {
  it('puxa da trilha enquanto ela está abaixo do peso pedido', () => {
    expect(
      pickRecommendationOrigin({ focusMix: 0.3, history: [], hasFocus: true, hasBase: true })
    ).toBe('focus')

    // Depois de duas de foco em duas sugestões, a balança volta para a base.
    expect(
      pickRecommendationOrigin({ focusMix: 0.3, history: ['focus', 'focus'], hasFocus: true, hasBase: true })
    ).toBe('base')

    // 1 de 3 = 33% já cobriu os 30% pedidos: base de novo.
    expect(
      pickRecommendationOrigin({ focusMix: 0.3, history: ['base', 'focus', 'base'], hasFocus: true, hasBase: true })
    ).toBe('base')
  })

  it('respeita os extremos: 0% nunca sugere trilha, 100% nunca sugere base', () => {
    const history = ['base', 'base', 'base'] as ('base' | 'focus')[]
    expect(pickRecommendationOrigin({ focusMix: 0, history, hasFocus: true, hasBase: true })).toBe('base')
    expect(pickRecommendationOrigin({ focusMix: 1, history, hasFocus: true, hasBase: true })).toBe('focus')
  })

  it('não inventa camada que não existe — e sem nada, sem sugestão', () => {
    expect(pickRecommendationOrigin({ focusMix: 0.5, history: [], hasFocus: false, hasBase: true })).toBe('base')
    expect(pickRecommendationOrigin({ focusMix: 0.5, history: [], hasFocus: true, hasBase: false })).toBe('focus')
    expect(pickRecommendationOrigin({ focusMix: 0.5, history: [], hasFocus: false, hasBase: false })).toBeNull()
  })

  it('fora da sessão guiada isso é ordem, não cota: a base nunca some', () => {
    let focus = 0
    let base = 0
    const history: ('base' | 'focus')[] = []

    for (let step = 0; step < 30; step += 1) {
      const origin = pickRecommendationOrigin({ focusMix: 0.3, history, hasFocus: true, hasBase: true })
      if (origin === 'focus') focus += 1
      else base += 1
      history.push(origin ?? 'base')
    }

    expect(base).toBeGreaterThan(0)
    expect(focus / (base + focus)).toBeLessThanOrEqual(0.5)
  })
})

describe('rubrica do cenário sem IA', () => {
  const criteria = ['apresentar sua trajetória', 'descrever um projeto com resultado', 'fazer uma pergunta']

  it('separa tarefa de língua', () => {
    const talkative = scenarioFeedbackFrom({
      studentTurns: [
        'I have a background in backend work.',
        'I led the migration and we cut latency.',
        'What does the growth path look like?'
      ],
      criteria,
      corrections: 0,
      words: 34
    })

    const silent = scenarioFeedbackFrom({
      studentTurns: ['yes'],
      criteria,
      corrections: 6,
      words: 4
    })

    expect(talkative.contentScore).toBeGreaterThan(silent.contentScore)
    expect(talkative.languageScore).toBeGreaterThan(silent.languageScore)
    expect(talkative.contentScore).not.toBe(talkative.languageScore)
  })

  it('não finge checklist quando não pode verificar o sentido da tarefa', () => {
    const run = scenarioFeedbackFrom({
      studentTurns: ['I have a background in Node, I maintain two services.'],
      criteria: ['falar da sua trajetória profissional', 'contar um incidente de produção'],
      corrections: 1,
      words: 12
    })

    expect(run.criteriaMet).toEqual([])
    expect(run.feedback).toContain('participação')
    expect(criterionWords('trajetória profissional')).toEqual(['trajetoria', 'profissional'])
  })

  it('acima de três falas cheias, participação é 100%', () => {
    const run = scenarioFeedbackFrom({
      studentTurns: ['one two three four five', 'six seven eight nine ten', 'eleven twelve thirteen fourteen'],
      criteria,
      corrections: 0,
      words: 400
    })

    expect(run.contentScore).toBe(1)
    expect(run.followUpDrill.length).toBeGreaterThan(10)
  })

  it('sem correções, o drill empurra profundidade, não gramática', () => {
    const clean = scenarioFeedbackFrom({ studentTurns: ['a'.repeat(30)], criteria, corrections: 0, words: 60 })
    const dirty = scenarioFeedbackFrom({ studentTurns: ['a'.repeat(30)], criteria, corrections: 4, words: 60 })

    expect(clean.followUpDrill).toContain('uma frase a mais')
    expect(dirty.followUpDrill).toContain('correções do caderno')
  })
})

describe('prompts das trilhas e do cenário', () => {
  it('o esboço da trilha pede domínio novo e gramática do nível do aluno', () => {
    const prompt = trackPlanPrompt({ objective: 'entrevista para dev', level: 'A2', goal: 'conversação', locale: DEFAULT_LOCALE })

    expect(prompt.user).toContain('A2')
    expect(prompt.user).toContain('entrevista para dev')
    expect(prompt.user).toContain('NÃO muda')
    expect(prompt.user).toContain('focusVocabulary')
    expect(prompt.user).toContain('goalTag')
  })

  it('o esboço nasce do tópico pedido, não do objetivo geral do perfil', () => {
    // Objetivo de onboarding = entrevista; tópico digitado = viagem. O prompt
    // não pode conter âncora que empurre o modelo fraco de volta para dev.
    const prompt = trackPlanPrompt({ objective: 'viagem ao Japão', level: 'B1', goal: 'entrevista para dev', locale: DEFAULT_LOCALE })

    expect(prompt.user).toContain('OBRIGATÓRIO')
    expect(prompt.user).toContain('viagem ao Japão')
    expect(prompt.user).toContain('ignore-o nesta trilha')
    expect(prompt.user).not.toContain('Entrevista para dev')
  })

  it('lição de trilha recebe palavras-alvo e trava de nível', () => {
    const lesson = lessonContentPrompt({
      title: 'Apresente-se em 60 segundos',
      objective: 'falar de quem você é',
      unitTitle: '',
      level: 'A2',
      goal: 'entrevista para dev',
      errors: [],
      track: { title: 'Entrevista para dev', vocabulary: ['background', 'stack'] },
      locale: DEFAULT_LOCALE
    })

    expect(lesson.user).toContain('trilha "Entrevista para dev"')
    expect(lesson.user).toContain('background, stack')
    expect(lesson.user).toContain('Restrição de nível: A2')
    expect(lesson.user).toContain('Dificuldade TRAVADA no nível A2')
    expect(lesson.user).toContain('deve ser exatamente "A2"')

    const exercises = exercisePrompt({
      content: fallbackLessonContent({ title: 'X', objective: 'y', level: 'A2' }),
      level: 'A2',
      goal: 'entrevista para dev',
      errors: [],
      track: { title: 'Entrevista para dev', vocabulary: ['background'] },
      locale: DEFAULT_LOCALE
    })

    expect(exercises.user).toContain('domínio "Entrevista para dev"')
    expect(exercises.user).toContain('Pelo menos 3 exercícios')
    expect(exercises.user).toContain('Dificuldade TRAVADA no nível A2')
  })

  it('lição do currículo base não recebe restrição de trilha', () => {
    const lesson = lessonContentPrompt({
      title: 'Artigos',
      objective: 'usar a/an/the',
      unitTitle: 'Primeiros passos',
      level: 'A1',
      goal: 'viagem',
      errors: [],
      locale: DEFAULT_LOCALE
    })

    expect(lesson.user).toContain('unidade "Primeiros passos"')
    expect(lesson.user).not.toContain('Palavras-alvo')
  })

  it('o cenário entra no system do tutor como personagem, sem virar lista', () => {
    const base = {
      level: 'B1' as const,
      goal: 'entrevista',
      style: 'recast' as const,
      errors: [],
      vocabulary: [],
      summary: null,
      lesson: null,
      topic: null,
      locale: DEFAULT_LOCALE
    }

    const system = tutorSystem({
      ...base,
      scenario: {
        persona: 'entrevistador técnico',
        setting: 'videochamada de entrevista',
        successCriteria: ['falar da sua trajetória']
      }
    })

    expect(system).toContain('MODO CENÁRIO')
    expect(system).toContain('entrevistador técnico')
    expect(system).toContain('falar da sua trajetória')
    expect(system).toContain('não liste nem cheque em voz alta')

    expect(tutorSystem(base)).not.toContain('MODO CENÁRIO')
  })

  it('a rubrica do roleplay cobra tarefa e língua em campos separados', () => {
    const prompt = scenarioFeedbackPrompt({
      persona: 'entrevistador',
      setting: 'videochamada',
      criteria: ['apresentar sua trajetória', 'descrever um projeto'],
      transcript: 'aluno: I maintain two services.\ntutor: Nice.',
      level: 'A2',
      errors: [{ tag: 'articles', original: 'I am developer.', corrected: 'I am a developer.' }],
      locale: DEFAULT_LOCALE
    })

    expect(prompt.user).toContain('1. """apresentar sua trajetória"""')
    expect(prompt.user).toContain('contentScore')
    expect(prompt.user).toContain('languageScore')
    expect(prompt.user).toContain('criteriaMet')
    expect(prompt.user).toContain('Ignore gramática aqui')
    expect(prompt.user).toContain('articles')
  })

  it('o cenário gerado pede fala em inglês e critérios em português', () => {
    const prompt = scenarioGenPrompt({
      lessonTitle: 'Pergunte sobre a vaga',
      objective: 'fazer perguntas',
      level: 'B1',
      goal: 'entrevista para dev',
      locale: DEFAULT_LOCALE
    })

    expect(prompt.user).toContain('openingLine')
    expect(prompt.user).toContain('successCriteria')
    expect(prompt.user).toContain('B1')
    expect(prompt.user).toContain('TAREFA (conteúdo), não a gramática')
  })
})
