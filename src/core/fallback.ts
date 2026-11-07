import type { CefrLevel } from '../shared/types'
import type { ErrorFocusEntry } from './adapt'
import { DEFAULT_LOCALE, type PromptLocale } from './prompts'
import { runtimeTextForLocale } from './runtime-text'
import { clozeFromExample } from './srs'
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

/**
 * Conjunto de frases/vocabulário por nível para o conteúdo local. Sem isso a
 * lição C1 caía no banco genérico de A2 ("I study English every day") — o
 * aluno via pergunta e assunto muito abaixo do nível selecionado.
 * As frases de exemplo sempre CONTÊM o termo, para o cloze determinístico.
 */
interface LevelExemplars {
  examples: { target: string; native: string }[]
  vocabulary: { term: string; translation: string; example: string }[]
}

const LEVEL_EXEMPLARS: Record<CefrLevel, LevelExemplars> = {
  A1: {
    examples: [
      { target: 'I am Brazilian and I live in Recife.', native: 'Sou brasileiro e moro em Recife.' },
      { target: 'She has two small cats.', native: 'Ela tem dois gatos pequenos.' },
      { target: 'We eat bread for breakfast.', native: 'Nós comemos pão no café da manhã.' }
    ],
    vocabulary: [
      { term: 'water', translation: 'água', example: 'I drink water every morning.' },
      { term: 'family', translation: 'família', example: 'My family lives in Recife.' },
      { term: 'friend', translation: 'amigo', example: 'She is my best friend.' },
      { term: 'small', translation: 'pequeno', example: 'My city is small.' },
      { term: 'eat', translation: 'comer', example: 'We eat bread for breakfast.' },
      { term: 'work', translation: 'trabalhar', example: 'I work from home.' }
    ]
  },
  A2: {
    examples: [
      { target: 'I study English every day.', native: 'Eu estudo inglês todos os dias.' },
      { target: 'She works from home on Mondays.', native: 'Ela trabalha de casa às segundas.' },
      { target: 'They like to practice together.', native: 'Eles gostam de praticar juntos.' }
    ],
    vocabulary: [
      { term: 'study', translation: 'estudar', example: 'I study English.' },
      { term: 'work', translation: 'trabalhar', example: 'She works from home.' },
      { term: 'every day', translation: 'todos os dias', example: 'I practice every day.' },
      { term: 'sometimes', translation: 'às vezes', example: 'Sometimes I listen to podcasts.' },
      { term: 'because', translation: 'porque', example: 'I study because I want to improve.' },
      { term: 'together', translation: 'juntos', example: 'We practice together.' }
    ]
  },
  B1: {
    examples: [
      { target: 'I have already finished the report.', native: 'Eu já terminei o relatório.' },
      { target: 'We were working when the power went out.', native: 'Estávamos trabalhando quando a luz caiu.' },
      { target: 'Although it rained, we went out.', native: 'Embora tenha chovido, nós saímos.' }
    ],
    vocabulary: [
      { term: 'already', translation: 'já', example: 'I have already seen that movie.' },
      { term: 'although', translation: 'embora', example: 'Although it rained, we went out.' },
      { term: 'however', translation: 'no entanto', example: 'It was tiring; however, I would do it again.' },
      { term: 'experience', translation: 'experiência', example: 'I have a lot of experience with customers.' },
      { term: 'improve', translation: 'melhorar', example: 'I read every night to improve my vocabulary.' },
      { term: 'postpone', translation: 'adiar', example: 'The meeting was postponed to Friday.' }
    ]
  },
  B2: {
    examples: [
      { target: 'The results were announced yesterday.', native: 'Os resultados foram anunciados ontem.' },
      { target: 'She suggested taking a short break.', native: 'Ela sugeriu fazer uma pausa curta.' },
      { target: 'They said they had already left.', native: 'Eles disseram que já haviam saído.' }
    ],
    vocabulary: [
      { term: 'announced', translation: 'anunciado', example: 'The results were announced yesterday.' },
      { term: 'despite', translation: 'apesar de', example: 'Despite the delay, we arrived on time.' },
      { term: 'reliable', translation: 'confiável', example: 'He is a reliable source.' },
      { term: 'suggest', translation: 'sugerir', example: 'She suggested taking a short break.' },
      { term: 'hardly', translation: 'quase não', example: 'I had hardly arrived when they called.' },
      { term: 'in advance', translation: 'com antecedência', example: 'You should book the flight in advance.' }
    ]
  },
  C1: {
    examples: [
      { target: 'Not only did the team ship on time, but they also cut costs.', native: 'A equipe não apenas entregou no prazo, como também reduziu custos.' },
      { target: 'Had we tested earlier, the bug would never have reached production.', native: 'Se tivéssemos testado antes, o bug jamais chegaria à produção.' },
      { target: 'The proposal is, to some extent, a reasonable compromise.', native: 'A proposta é, até certo ponto, um acordo razoável.' }
    ],
    vocabulary: [
      { term: 'nevertheless', translation: 'ainda assim', example: 'The plan was risky; nevertheless, we went ahead.' },
      { term: 'to some extent', translation: 'até certo ponto', example: 'I agree with you to some extent.' },
      { term: 'arguably', translation: 'discutivelmente', example: 'This is arguably the hardest part of the exam.' },
      { term: 'not only', translation: 'não apenas', example: 'Not only did they arrive late, but they also left early.' },
      { term: 'came up with', translation: 'criou, concebeu', example: 'We came up with a workaround overnight.' },
      { term: 'needless to say', translation: 'dispensa dizer', example: 'Needless to say, the deal fell through.' }
    ]
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
  const exemplars = LEVEL_EXEMPLARS[input.level] ?? LEVEL_EXEMPLARS.A2
  const exampleSet = exemplars.examples

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
      input.vocabulary && input.vocabulary.length > 0 ? input.vocabulary.slice(0, 10) : exemplars.vocabulary
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

/**
 * M6 (B12): shuffle com seed — a mesma lição gera o mesmo bloco de exercícios.
 * Com `Math.random` puro, pré-geração e abertura do aluno produziam dois
 * baralhos diferentes para a mesma lição (e a regeneração não era reprodutível).
 */
function hashSeed(value: string): number {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function shuffle<T>(items: T[], seed: number): T[] {
  let state = seed
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1))
    const current = copy[index]
    const other = copy[swap]
    if (current === undefined || other === undefined) continue
    copy[index] = other
    copy[swap] = current
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
  const answer = words[index] ?? sentence
  const prompt = words.map((word, position) => (position === index ? '___' : word)).join(' ') + '.'
  return { prompt, answer }
}

/**
 * Cloze a partir do vocabulário da lição: a tradução da palavra que falta vira
 * dica entre parênteses, senão o aluno não tem como saber qual resposta a
 * atividade espera (qualquer palavra sintática preencheria o vão).
 */
function vocabCloze(
  vocabulary: LessonContentOutput['vocabulary'],
  locale: PromptLocale
): { prompt: string; answer: string } | null {
  for (const item of vocabulary) {
    const cloze = clozeFromExample(item.example, item.term, locale.target.tokenization)
    if (!cloze) continue
    return { prompt: `${cloze.blanked} (${item.translation})`, answer: cloze.matched }
  }
  return null
}

/** Reconstruir a frase certa é o drill determinístico do erro recorrente. */
function orderFromFocus(entry: ErrorFocusEntry, locale: PromptLocale): GeneratedExercise {
  const sentence = entry.corrected.replace(/^["“]|["”]$/g, '').trim()
  const tokens = tokenizeFor(sentence, locale.target.code)

  return {
    type: 'order',
    instruction: runtimeTextForLocale(locale, 'fb.orderFocus.instruction', { tag: entry.tag }),
    prompt: entry.note ?? runtimeTextForLocale(locale, 'fb.orderFocus.prompt', { target: locale.targetName }),
    options: [],
    tokens,
    answer: sentence,
    alternatives: [],
    explanation: runtimeTextForLocale(locale, 'fb.orderFocus.explanation', { sentence }),
    targetTags: [entry.tag]
  }
}

/** Reconhecer o erro entre duas frases vem antes de parar de cometê-lo. */
function spotError(entry: ErrorFocusEntry, locale: PromptLocale): GeneratedExercise {
  const other = bankEntries().filter((item) => item.tag !== entry.tag).slice(0, 2)
  const options = [...new Set([entry.corrected, entry.original, ...other.map((item) => item.right)])].slice(0, 4)

  return {
    type: 'multiple_choice',
    instruction: runtimeTextForLocale(locale, 'fb.spotError.instruction'),
    prompt: runtimeTextForLocale(locale, 'fb.spotError.prompt', { target: locale.targetName, tag: entry.tag }),
    options: shuffle(options, hashSeed(entry.original)),
    tokens: [],
    answer: entry.corrected,
    alternatives: [],
    explanation: entry.note ?? runtimeTextForLocale(locale, 'fb.spotError.explanation', { sentence: entry.corrected }),
    targetTags: [entry.tag]
  }
}

export function fallbackExercises(
  content: LessonContentOutput,
  errors: ErrorFocusEntry[] = [],
  locale: PromptLocale = DEFAULT_LOCALE
): ExerciseSetOutput {
  // M6 (B12): guardas — `vocab[1..3]` e `examples[0]` eram lidos sem checar
  // tamanho; conteúdo degenerado (vocabulário vazio) derrubava a geração.
  const vocab = content.vocabulary.slice(0, 4)
  const first = content.examples[0]
  if (!first || vocab.length === 0) return { exercises: [] }

  const focus = focusEntries(errors)
  const second = content.examples[1] ?? first
  const cloze = vocabCloze(content.vocabulary, locale) ?? missingWord(first.target)
  const orderTokens = tokenizeFor(second.target, locale.target.code)

  // M6 (B12): seed derivada da lição — a mesma lição sempre baralha do mesmo
  // jeito (pré-geração e abertura não produzem dois baralhos diferentes).
  // M6 (F4): `noUncheckedIndexedAccess` — o guarda acima garante não-vazio;
  // o acessador torna isso checável pelo compilador em cada índice.
  const pick = (index: number) => {
    const item = vocab[index % vocab.length]
    if (!item) throw new Error('fallbackExercises: vocabulário vazio')
    return item
  }
  const seed = hashSeed(`${content.title}|${content.objective}`)

  const optionsA = shuffle([...new Set(vocab.map((item) => item.translation))], seed)
  const optionsB = shuffle(
    [...new Set([pick(1).translation, pick(0).translation, pick(2).translation, pick(3).translation])],
    seed + 1
  )

  const exercises: GeneratedExercise[] = [
    {
      type: 'multiple_choice',
      instruction: runtimeTextForLocale(locale, 'fb.mcTranslation.instruction'),
      prompt: runtimeTextForLocale(locale, 'fb.mcTranslation.prompt', { term: pick(0).term }),
      options: optionsA,
      tokens: [],
      answer: pick(0).translation,
      alternatives: [],
      explanation: runtimeTextForLocale(locale, 'fb.mcTranslation.explanation', {
        term: pick(0).term,
        translation: pick(0).translation
      }),
      targetTags: []
    },
    {
      type: 'cloze',
      instruction: runtimeTextForLocale(locale, 'fb.cloze.instruction'),
      prompt: cloze.prompt,
      options: [],
      tokens: [],
      answer: cloze.answer,
      alternatives: [],
      explanation: runtimeTextForLocale(locale, 'fb.cloze.explanation'),
      targetTags: []
    },
    {
      type: 'order',
      instruction: runtimeTextForLocale(locale, 'fb.order.instruction'),
      prompt: runtimeTextForLocale(locale, 'fb.order.prompt'),
      options: [],
      tokens: orderTokens,
      answer: second.target,
      alternatives: [],
      explanation: runtimeTextForLocale(locale, 'fb.order.explanation'),
      targetTags: []
    },
    {
      type: 'translate',
      instruction: runtimeTextForLocale(locale, 'fb.translate.instruction', { target: locale.targetName }),
      prompt: second.native,
      options: [],
      tokens: [],
      answer: second.target,
      alternatives: [],
      explanation: runtimeTextForLocale(locale, 'fb.translate.explanation', { target: locale.targetName }),
      targetTags: focus[0] ? [focus[0].tag] : []
    },
    {
      type: 'free_production',
      instruction: runtimeTextForLocale(locale, 'fb.free.instruction'),
      prompt: runtimeTextForLocale(locale, 'fb.free.prompt', { topic: content.objective }),
      options: [],
      tokens: [],
      answer: `${first.target} ${second.target}`,
      alternatives: [],
      explanation: runtimeTextForLocale(locale, 'fb.free.explanation', { target: locale.targetName }),
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
      instruction: runtimeTextForLocale(locale, 'fb.mcTranslation.instruction'),
      prompt: runtimeTextForLocale(locale, 'fb.mcTranslation.prompt', { term: pick(1).term }),
      options: optionsB,
      tokens: [],
      answer: pick(1).translation,
      alternatives: [],
      explanation: runtimeTextForLocale(locale, 'fb.mcTranslation.explanation', {
        term: pick(1).term,
        translation: pick(1).translation
      }),
      targetTags: []
    })
  }

  return { exercises: exercises.slice(0, 8) }
}
