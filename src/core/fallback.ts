import type { CefrLevel } from '../shared/types'
import type { CurriculumOutput, ExerciseSetOutput, LessonContentOutput } from './schemas'

interface FallbackLesson {
  title: string
  objective: string
}

interface FallbackUnit {
  title: string
  description: string
  lessons: FallbackLesson[]
}

const CURRICULUM_BANK: Record<CefrLevel, [FallbackUnit, FallbackUnit]> = {
  A1: [
    {
      title: 'Primeiros passos',
      description: 'Fundamentos para se apresentar e falar de si.',
      lessons: [
        { title: 'Verbo to be e apresentações', objective: 'Apresentar-se e falar a idade com o verbo to be' },
        { title: 'Artigos e objetos do dia a dia', objective: 'Usar a/an/the e nomear objetos comuns' },
        { title: 'Números, horas e idade', objective: 'Dizer números, horas e idade em inglês' }
      ]
    },
    {
      title: 'Vida diária',
      description: 'Rotinas, perguntas simples e frequência.',
      lessons: [
        { title: 'Present simple: rotinas', objective: 'Descrever a rotina com verbos no presente' },
        { title: 'Perguntas com do e does', objective: 'Fazer perguntas simples no presente' },
        { title: 'Advérbios de frequência', objective: 'Falar com que frequência algo acontece' }
      ]
    }
  ],
  A2: [
    {
      title: 'Rotina e passado',
      description: 'Contraste entre presente e passado em situações comuns.',
      lessons: [
        { title: 'Present simple e present continuous', objective: 'Distinguir hábitos de ações em andamento' },
        { title: 'Past simple: verbos regulares', objective: 'Contar ações concluídas no passado' },
        { title: 'Perguntas e negativas no passado', objective: 'Fazer perguntas e negar no passado com did' }
      ]
    },
    {
      title: 'Planos e comparações',
      description: 'Falar do futuro, comparar coisas e localizar lugares.',
      lessons: [
        { title: 'Going to e will', objective: 'Falar de planos e decisões futuras' },
        { title: 'Comparativos e superlativos', objective: 'Comparar pessoas, lugares e objetos' },
        { title: 'There is/are e preposições', objective: 'Descrever lugares e posições' }
      ]
    }
  ],
  B1: [
    {
      title: 'Conectando ideias',
      description: 'Tempos verbais e conectores para narrativas mais longas.',
      lessons: [
        { title: 'Present perfect', objective: 'Falar de experiências e resultados presentes' },
        { title: 'Past continuous', objective: 'Narrar ações em andamento no passado' },
        { title: 'Conectores de causa e contraste', objective: 'Ligar ideias com because, although e however' }
      ]
    },
    {
      title: 'Opinião e trabalho',
      description: 'Expressar opinião, hipóteses e linguagem profissional.',
      lessons: [
        { title: 'First conditional', objective: 'Falar de condições e consequências prováveis' },
        { title: 'Modais de possibilidade', objective: 'Usar might, may e could com precisão' },
        { title: 'Vocabulário de reuniões', objective: 'Participar de reuniões simples em inglês' }
      ]
    }
  ],
  B2: [
    {
      title: 'Nuances da língua',
      description: 'Estruturas mais sofisticadas para precisão e fluidez.',
      lessons: [
        { title: 'Perfect tenses', objective: 'Usar present perfect continuous e past perfect' },
        { title: 'Voz passiva', objective: 'Descrever processos e fatos com a voz passiva' },
        { title: 'Reported speech', objective: 'Relatar o que outras pessoas disseram' }
      ]
    },
    {
      title: 'Fluência e argumentação',
      description: 'Opinião fundamentada, hipóteses e vocabulário avançado.',
      lessons: [
        { title: 'Second and third conditionals', objective: 'Falar de hipóteses irreais no presente e no passado' },
        { title: 'Phrasal verbs frequentes', objective: 'Usar phrasal verbs comuns em contexto' },
        { title: 'Argumentação e concordância', objective: 'Concordar, discordar e justificar opiniões' }
      ]
    }
  ],
  C1: [
    {
      title: 'Precisão avançada',
      description: 'Estruturas complexas e registro formal.',
      lessons: [
        { title: 'Mixed conditionals', objective: 'Combinar hipóteses de tempos diferentes' },
        { title: 'Inversion and emphasis', objective: 'Dar ênfase com inversão e cleft sentences' },
        { title: 'Hedging e registro', objective: 'Suavizar afirmações e ajustar o registro' }
      ]
    },
    {
      title: 'Discurso e persuasão',
      description: 'Conectar ideias e defender pontos de vista com nuance.',
      lessons: [
        { title: 'Discourse markers', objective: 'Organizar um discurso com marcadores naturais' },
        { title: 'Idioms and collocations', objective: 'Usar expressões idiomáticas com naturalidade' },
        { title: 'Persuasive language', objective: 'Argumentar e persuadir em contextos profissionais' }
      ]
    }
  ]
}

export function fallbackCurriculum(level: CefrLevel, goal: string): CurriculumOutput {
  const bank = CURRICULUM_BANK[level]
  const suffix = goal ? ` Foco: ${goal}.` : ''

  return {
    units: bank.map((unit) => ({
      title: unit.title,
      description: `${unit.description}${suffix}`,
      level,
      lessons: unit.lessons
    }))
  }
}

export function fallbackLessonContent(input: {
  title: string
  objective: string
  level: CefrLevel
}): LessonContentOutput {
  const exampleSet = [
    { en: 'I study English every day.', pt: 'Eu estudo inglês todos os dias.' },
    { en: 'She works from home on Mondays.', pt: 'Ela trabalha de casa às segundas.' },
    { en: 'They like to practice together.', pt: 'Eles gostam de praticar juntos.' }
  ]

  return {
    title: input.title,
    level: input.level,
    objective: input.objective,
    explanation: [
      `Nesta lição você vai praticar ${input.title.toLowerCase()}.`,
      `O foco é ${input.objective.toLowerCase()}. Leia os exemplos em voz alta, observe a estrutura e depois pratique nos exercícios.`,
      'Não se preocupe em acertar tudo de primeira: errar faz parte do processo.'
    ].join('\n\n'),
    examples: exampleSet,
    grammarPoints: [
      {
        title: input.title,
        explanation: input.objective,
        examples: exampleSet.map((example) => example.en)
      }
    ],
    vocabulary: [
      { term: 'study', translation: 'estudar', example: 'I study English.' },
      { term: 'work', translation: 'trabalhar', example: 'She works from home.' },
      { term: 'every day', translation: 'todos os dias', example: 'I practice every day.' },
      { term: 'sometimes', translation: 'às vezes', example: 'Sometimes I listen to podcasts.' },
      { term: 'because', translation: 'porque', example: 'I study because I want to improve.' },
      { term: 'together', translation: 'juntos', example: 'We practice together.' }
    ]
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

function missingWord(sentence: string): { prompt: string; answer: string } {
  const words = sentence.replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean)
  if (words.length < 2) return { prompt: sentence, answer: words[0] ?? sentence }
  const index = Math.max(0, words.length - 1)
  const answer = words[index]
  const prompt = words.map((word, position) => (position === index ? '___' : word)).join(' ') + '.'
  return { prompt, answer }
}

export function fallbackExercises(content: LessonContentOutput): ExerciseSetOutput {
  const vocab = content.vocabulary.slice(0, 4)
  const first = content.examples[0]
  const second = content.examples[1] ?? content.examples[0]
  const cloze = missingWord(first.en)
  const orderTokens = second.en.split(/\s+/).filter(Boolean)

  const optionsA = shuffle([vocab[0].translation, vocab[1].translation, vocab[2].translation, vocab[3].translation])
  const optionsB = shuffle([vocab[1].translation, vocab[0].translation, vocab[2].translation, vocab[3].translation])

  return {
    exercises: [
      {
        type: 'multiple_choice',
        instruction: 'Escolha a tradução correta.',
        prompt: `O que significa "${vocab[0].term}"?`,
        options: optionsA,
        tokens: [],
        answer: vocab[0].translation,
        alternatives: [],
        explanation: `"${vocab[0].term}" significa "${vocab[0].translation}".`
      },
      {
        type: 'cloze',
        instruction: 'Complete a frase com a palavra que falta.',
        prompt: cloze.prompt,
        options: [],
        tokens: [],
        answer: cloze.answer,
        alternatives: [],
        explanation: 'Leia a frase completa para conferir o sentido.'
      },
      {
        type: 'order',
        instruction: 'Ordene as palavras para formar a frase.',
        prompt: 'Monte a frase correta.',
        options: [],
        tokens: orderTokens,
        answer: second.en,
        alternatives: [],
        explanation: 'Observe a ordem sujeito + verbo + complemento.'
      },
      {
        type: 'translate',
        instruction: 'Traduza a frase para o inglês.',
        prompt: second.pt,
        options: [],
        tokens: [],
        answer: second.en,
        alternatives: [],
        explanation: 'Compare sua tradução com a versão em inglês.'
      },
      {
        type: 'free_production',
        instruction: 'Escreva uma resposta curta usando o conteúdo da lição.',
        prompt: `Escreva 2 frases sobre: ${content.objective}`,
        options: [],
        tokens: [],
        answer: `${first.en} ${second.en}`,
        alternatives: [],
        explanation: 'Use o vocabulário e a estrutura que você praticou.'
      },
      {
        type: 'multiple_choice',
        instruction: 'Escolha a tradução correta.',
        prompt: `O que significa "${vocab[1].term}"?`,
        options: optionsB,
        tokens: [],
        answer: vocab[1].translation,
        alternatives: [],
        explanation: `"${vocab[1].term}" significa "${vocab[1].translation}".`
      }
    ]
  }
}
