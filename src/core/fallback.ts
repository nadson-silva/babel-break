import type { CefrLevel } from '../shared/types'
import type { ErrorFocusEntry } from './adapt'
import { DEFAULT_LOCALE, type PromptLocale } from './prompts'
import { tokenize } from './languages'
import { bankEntries } from './interference'
import type { CurriculumOutput, ExerciseSetOutput, GeneratedExercise, LessonContentOutput } from './schemas'

/**
 * Gerador determinístico offline (M2/M4).
 *
 * O inglês é o *fixture de qualidade* do plano: estas frases escritas à mão só
 * existem para o idioma-alvo inglês. Para qualquer outro idioma o chamador
 * verifica `deterministicContentSupported` e degrada com erro claro em vez de
 * inventar conteúdo — conteúdo sem IA em idioma desconhecido seria lixo.
 */

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
  errors?: ErrorFocusEntry[]
  /** Vocabulário do domínio (trilha de foco) — substitui o conjunto genérico. */
  vocabulary?: { term: string; translation: string; example: string }[]
}): LessonContentOutput {
  const exampleSet = [
    { target: 'I study English every day.', native: 'Eu estudo inglês todos os dias.' },
    { target: 'She works from home on Mondays.', native: 'Ela trabalha de casa às segundas.' },
    { target: 'They like to practice together.', native: 'Eles gostam de praticar juntos.' }
  ]

  const focus = input.errors ?? []

  return {
    title: input.title,
    level: input.level,
    objective: input.objective,
    explanation: [
      `Nesta lição você vai praticar ${input.title.toLowerCase()}.`,
      `O foco é ${input.objective.toLowerCase()}. Leia os exemplos em voz alta, observe a estrutura e depois pratique nos exercícios.`,
      focus.length > 0
        ? `Atenção especial aos seus erros recorrentes: ${focus.map((entry) => `"${entry.original}" → "${entry.corrected}"`).join('; ')}.`
        : 'Não se preocupe em acertar tudo de primeira: errar faz parte do processo.'
    ].join('\n\n'),
    examples: exampleSet,
    grammarPoints: [
      {
        title: input.title,
        explanation: input.objective,
        examples: exampleSet.map((example) => example.target)
      }
    ],
    pitfalls: focus.length > 0 ? pitfallsFrom(focus) : pitfallsFrom(bankEntries().slice(0, 2).map(toBankFocus)),
    vocabulary:
      input.vocabulary && input.vocabulary.length > 0
        ? input.vocabulary.slice(0, 10)
        : [
            { term: 'study', translation: 'estudar', example: 'I study English.' },
            { term: 'work', translation: 'trabalhar', example: 'She works from home.' },
            { term: 'every day', translation: 'todos os dias', example: 'I practice every day.' },
            { term: 'sometimes', translation: 'às vezes', example: 'Sometimes I listen to podcasts.' },
            { term: 'because', translation: 'porque', example: 'I study because I want to improve.' },
            { term: 'together', translation: 'juntos', example: 'We practice together.' }
          ]
  }
}

/**
 * Armadilhas do idioma do aluno para o conteúdo local. Vêm do caderno dele
 * quando existe; senão do banco de interferência do par (o app nunca gera
 * lição genérica quando há banco manual disponível).
 */
export function pitfallsFrom(entries: ErrorFocusEntry[]): LessonContentOutput['pitfalls'] {
  return entries
    .slice(0, 3)
    .filter((entry) => entry.original && entry.corrected)
    .map((entry) => ({
      tag: entry.tag,
      wrong: entry.original,
      right: entry.corrected,
      note: entry.note ?? `Erro recorrente: use "${entry.corrected}".`
    }))
}

function toBankFocus(entry: { tag: string; wrong: string; right: string; note: string }): ErrorFocusEntry {
  return {
    tag: entry.tag,
    occurrences: 0,
    original: entry.wrong,
    corrected: entry.right,
    note: entry.note,
    source: 'bank'
  }
}

function focusEntries(errors: ErrorFocusEntry[]): ErrorFocusEntry[] {
  const student = errors.filter((entry) => entry.source === 'student')
  if (student.length > 0) return student
  return bankEntries().slice(0, 3).map(toBankFocus)
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

/** Tokens de "ordene a frase" respeitando a escrita do idioma-alvo (M4). */
function tokenizeFor(sentence: string, targetCode: string): string[] {
  return tokenize(sentence, targetCode)
}

function missingWord(sentence: string): { prompt: string; answer: string } {
  const words = sentence.replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean)
  if (words.length < 2) return { prompt: sentence, answer: words[0] ?? sentence }
  const index = Math.max(0, words.length - 1)
  const answer = words[index]
  const prompt = words.map((word, position) => (position === index ? '___' : word)).join(' ') + '.'
  return { prompt, answer }
}

/** Reconstruir a frase certa é o drill determinístico do erro recorrente. */
function orderFromFocus(entry: ErrorFocusEntry, locale: PromptLocale): GeneratedExercise {
  const sentence = entry.corrected.replace(/^["“]|["”]$/g, '').trim()
  const tokens = tokenizeFor(sentence, locale.target.code)

  return {
    type: 'order',
    instruction: `Reconstrua a frase correta (área: ${entry.tag}).`,
    prompt: entry.note ?? `Monte a frase correta em ${locale.targetName}.`,
    options: [],
    tokens,
    answer: sentence,
    alternatives: [],
    explanation: `Forma correta: "${sentence}".`,
    targetTags: [entry.tag]
  }
}

/** Reconhecer o erro entre duas frases vem antes de parar de cometê-lo. */
function spotError(entry: ErrorFocusEntry, locale: PromptLocale): GeneratedExercise {
  const other = bankEntries().filter((item) => item.tag !== entry.tag).slice(0, 2)
  const options = [...new Set([entry.corrected, entry.original, ...other.map((item) => item.right)])].slice(0, 4)

  return {
    type: 'multiple_choice',
    instruction: 'Escolha a frase correta.',
    prompt: `Qual destas frases está certa em ${locale.targetName}? (área: ${entry.tag})`,
    options: shuffle(options),
    tokens: [],
    answer: entry.corrected,
    alternatives: [],
    explanation: entry.note ?? `"${entry.corrected}" é a forma natural.`,
    targetTags: [entry.tag]
  }
}

export function fallbackExercises(
  content: LessonContentOutput,
  errors: ErrorFocusEntry[] = [],
  locale: PromptLocale = DEFAULT_LOCALE
): ExerciseSetOutput {
  const vocab = content.vocabulary.slice(0, 4)
  const focus = focusEntries(errors)
  const first = content.examples[0]
  const second = content.examples[1] ?? content.examples[0]
  const cloze = missingWord(first.target)
  const orderTokens = tokenizeFor(second.target, locale.target.code)

  const optionsA = shuffle([...new Set(vocab.map((item) => item.translation))])
  const optionsB = shuffle([...new Set([vocab[1].translation, vocab[0].translation, vocab[2].translation, vocab[3].translation])])

  const exercises: GeneratedExercise[] = [
    {
      type: 'multiple_choice',
      instruction: 'Escolha a tradução correta.',
      prompt: `O que significa "${vocab[0].term}"?`,
      options: optionsA,
      tokens: [],
      answer: vocab[0].translation,
      alternatives: [],
      explanation: `"${vocab[0].term}" significa "${vocab[0].translation}".`,
      targetTags: []
    },
    {
      type: 'cloze',
      instruction: 'Complete a frase com a palavra que falta.',
      prompt: cloze.prompt,
      options: [],
      tokens: [],
      answer: cloze.answer,
      alternatives: [],
      explanation: 'Leia a frase completa para conferir o sentido.',
      targetTags: []
    },
    {
      type: 'order',
      instruction: 'Ordene as palavras para formar a frase.',
      prompt: 'Monte a frase correta.',
      options: [],
      tokens: orderTokens,
      answer: second.target,
      alternatives: [],
      explanation: 'Observe a ordem sujeito + verbo + complemento.',
      targetTags: []
    },
    {
      type: 'translate',
      instruction: `Traduza a frase para o ${locale.targetName}.`,
      prompt: second.native,
      options: [],
      tokens: [],
      answer: second.target,
      alternatives: [],
      explanation: `Compare sua tradução com a versão em ${locale.targetName}.`,
      targetTags: focus[0] ? [focus[0].tag] : []
    },
    {
      type: 'free_production',
      instruction: `Escreva uma resposta curta usando o conteúdo da lição.`,
      prompt: `Escreva 2 frases sobre: ${content.objective}`,
      options: [],
      tokens: [],
      answer: `${first.target} ${second.target}`,
      alternatives: [],
      explanation: `Use o vocabulário e a estrutura que você praticou em ${locale.targetName}.`,
      targetTags: focus[1] ? [focus[1].tag] : []
    }
  ]

  // Os dois últimos exercícios miram o caderno de erros: é a adaptação visível
  // entre a lição #1 e a lição #2, mesmo sem IA disponível.
  if (focus[0]) exercises.push(orderFromFocus(focus[0], locale))
  if (focus[1]) exercises.push(spotError(focus[1], locale))
  else {
    exercises.push({
      type: 'multiple_choice',
      instruction: 'Escolha a tradução correta.',
      prompt: `O que significa "${vocab[1].term}"?`,
      options: optionsB,
      tokens: [],
      answer: vocab[1].translation,
      alternatives: [],
      explanation: `"${vocab[1].term}" significa "${vocab[1].translation}".`,
      targetTags: []
    })
  }

  return { exercises: exercises.slice(0, 8) }
}
