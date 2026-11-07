#!/usr/bin/env node
/**
 * Harness de avaliação por idioma (M5, PLAN §11) — manual, não é CI.
 *
 * Mede, contra um provedor real, o que importa para o produto:
 *
 *   • taxa de JSON inválido        — o contrato de saída quebra?
 *   • taxa de contrato atendido    — veio o que a tarefa pede (itens, campos)?
 *   • acurácia de correção         — pegou a tag certa e a forma certa?
 *   • escrita do idioma            — CJK segmentado, RTL no script certo?
 *   • latência p50/máx             — o "no seu ritmo" depende disso
 *
 * São ~20 tarefas golden por idioma, do jeito que o app pede (system prompt em
 * PT-BR, saída estruturada), sobre os contratos do plano: placement, curriculum,
 * lesson, exercises, grade, tutor, track, scenario.
 *
 * Uso:
 *   node scripts/eval.mjs --ollama [modelo] [--lang en|es|ja|ar] [--n <tarefas>]
 *   GEMINI_API_KEY=… node scripts/eval.mjs --gemini gemini-2.5-flash --lang es
 *
 *   node scripts/eval.mjs --offline        # linha de base determinística (sem IA):
 *                                          # roda os testes do domínio e resume
 *
 * Com modelo local pequeno é esperado ver contratos falharem — é exatamente o
 * caso em que o app degrada para o gerador determinístico (inglês) e o banco de
 * interferência do par continua corrigindo.
 */

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
const positional = argv.filter((arg) => !arg.startsWith('--'))

const provider = flags.has('--gemini') ? 'gemini' : 'ollama'
const offline = flags.has('--offline')
const ollamaUrl = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
const geminiKey = process.env.GEMINI_API_KEY ?? ''

/** `--lang es` (ou LT_EVAL_LANG); default inglês, o fixture de qualidade. */
const langCode = flagValue('--lang') ?? process.env.LT_EVAL_LANG ?? 'en'
const model = positional[0] ?? process.env.LT_EVAL_MODEL ?? (provider === 'gemini' ? 'gemini-2.5-flash' : 'qwen3.5:0.8b')
const repeatLimit = Number(flagValue('--n') ?? process.env.LT_EVAL_N ?? 0) || null

function flagValue(name) {
  const index = argv.indexOf(name)
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1]
  const inline = argv.find((arg) => arg.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : null
}

/**
 * M6 (F1): núcleo real do app (prompts/schemas/banco) via esbuild em memória.
 * Se falhar, o harness ainda roda com os contratos colados à mão (degradación
 * honesta), mas o gate é mais fiel quando o CORE existe.
 */
let CORE = null
let BANK_GOLDENS = null
try {
  const { loadEvalCore, goldensFromBank } = await import('./eval-core.mjs')
  CORE = await loadEvalCore()
  BANK_GOLDENS = goldensFromBank
} catch (error) {
  console.warn(`[eval] núcleo real indisponível, usando contratos locais: ${error.message}`)
}

// --- Idiomas avaliados -------------------------------------------------------
//
// Quatro casos que cobrem as classes de escrita do registro do app (§5):
// espaço + latino, espaço + latino com conjugação agressiva, CJK sem espaço e
// RTL. Adicionar idioma = acrescentar uma entrada aqui (as tarefas são geradas).
const LANGS = {
  en: {
    target: 'inglês',
    script: 'latin',
    direction: 'ltr',
    spaced: true,
    sample: 'I am agree with the plan and I didn\'t went to work yesterday.',
    goal: 'entrevista para desenvolvedor backend',
    // Acurácia de correção: frase do aluno → tag esperada + trecho esperado na correção.
    golden: [
      { text: 'I have 25 years.', tag: 'be-have', expect: 'I am 25' },
      { text: 'I am agree with you.', tag: 'agreement', expect: 'I agree' },
      { text: 'Explain me the problem.', tag: 'word-order', expect: 'Explain the problem to me' },
      { text: 'People is waiting.', tag: 'subject-verb-agreement', expect: 'People are' },
      { text: 'I didn\'t went yesterday.', tag: 'past-simple', expect: 'didn\'t go' },
      { text: 'I am boring in this job.', tag: 'participle-adjective', expect: 'bored' },
      { text: 'She is doctor.', tag: 'articles', expect: 'a doctor' },
      { text: 'I make a question.', tag: 'collocation', expect: 'ask a question' },
      { text: 'Actually, I pretend to travel.', tag: 'false-cognate', expect: 'right now|currently|actually' }
    ]
  },
  es: {
    target: 'espanhol',
    script: 'latin',
    direction: 'ltr',
    spaced: true,
    sample: 'Yo tengo 25 años y yo am de acuerdo.',
    goal: 'reunião de trabalho em espanhol',
    golden: [
      { text: 'Yo tengo 25 años de experiencia.', tag: 'age', expect: '' },
      { text: 'Nosotros vamos para casa.', tag: 'preterit|motion-verb', expect: 'a casa' },
      { text: 'Ella es doctor.', tag: 'gender-agreement', expect: 'doctora' },
      { text: 'Yo tengo hambre de ir.', tag: 'expression', expect: 'ganas de ir' },
      { text: 'Me gusta los libros.', tag: 'agreement', expect: 'me gustan los libros' },
      { text: 'Ayer yo como empanada.', tag: 'past-tense', expect: 'comí' },
      { text: 'Muy bueno libro.', tag: 'word-order', expect: 'libro muy bueno' }
    ]
  },
  ja: {
    target: 'japonês',
    script: 'cjk',
    direction: 'ltr',
    spaced: false,
    sample: '私はエンジニアです。昨日会社に行きました。',
    goal: 'conversar com colegas no Japão',
    golden: [
      { text: '私は昨日学校に行きましたます。', tag: 'politeness|tense', expect: '' },
      { text: 'これは本です。', tag: 'correct', expect: '' },
      { text: '私は水を食べたいです。', tag: 'verb-object-collocation', expect: '飲む' },
      { text: '昨日私は行きます。', tag: 'tense', expect: '行きました' }
    ]
  },
  ar: {
    target: 'árabe',
    script: 'arabic',
    direction: 'rtl',
    spaced: true,
    sample: 'أنا مهندس البرمجيات.',
    goal: 'viagem e restaurante',
    golden: [
      { text: 'أنا طالب في الجامعة.', tag: 'correct', expect: '' },
      { text: 'ذهب أنا إلى السوق.', tag: 'word-order', expect: 'ذهبت إلى السوق' },
      { text: 'هذا كتاب جميلة.', tag: 'gender-agreement', expect: 'جميل' }
    ]
  }
}

const LANG = LANGS[langCode]

if (LANG) {
  LANG.code = langCode

  // M6 (F1/F2): para os pares com banco manual (PT→EN, PT→ES), os goldens
  // VÊM do banco: cada regra contribui um caso sujo (wrong→right) e a forma
  // canônica vira caso limpo, que deve voltar sem correção. É isto que fecha
  // a inversão antiga em que frase correta pontuava como falha.
  if (CORE && BANK_GOLDENS) {
    const bank = langCode === 'en'
      ? CORE.interference.INTERFERENCE_BANK
      : langCode === 'es'
        ? CORE.interference.PT_ES_INTERFERENCE_BANK
        : null
    if (bank) LANG.golden = BANK_GOLDENS(CORE, bank, 6)
  }
}

if (!LANG) {
  console.error(`Idioma desconhecido: --lang ${langCode}. Opções: ${Object.keys(LANGS).join(', ')}`)
  process.exit(2)
}

// --- Contratos (JSON Schema mínimo, iguais aos do app) ----------------------

const SCHEMAS = {
  placement: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 6,
        maxItems: 14,
        items: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1'] },
            prompt: { type: 'string' },
            options: { type: 'array', minItems: 2, items: { type: 'string' } },
            answerIndex: { type: 'number' }
          },
          required: ['level', 'prompt', 'options', 'answerIndex']
        }
      }
    },
    required: ['questions']
  },
  curriculum: {
    type: 'object',
    properties: {
      units: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1'] },
            lessons: {
              type: 'array',
              minItems: 2,
              maxItems: 5,
              items: {
                type: 'object',
                properties: { title: { type: 'string' }, objective: { type: 'string' } },
                required: ['title', 'objective']
              }
            }
          },
          required: ['title', 'description', 'level', 'lessons']
        }
      }
    },
    required: ['units']
  },
  lesson: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1'] },
      objective: { type: 'string' },
      explanation: { type: 'string' },
      examples: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'object',
          properties: { target: { type: 'string' }, native: { type: 'string' } },
          required: ['target', 'native']
        }
      },
      grammarPoints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            explanation: { type: 'string' },
            examples: { type: 'array', items: { type: 'string' } }
          },
          required: ['title', 'explanation', 'examples']
        }
      },
      pitfalls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tag: { type: 'string' },
            wrong: { type: 'string' },
            right: { type: 'string' },
            note: { type: 'string' }
          },
          required: ['tag', 'wrong', 'right', 'note']
        }
      },
      vocabulary: {
        type: 'array',
        minItems: 3,
        items: {
          type: 'object',
          properties: { term: { type: 'string' }, translation: { type: 'string' }, example: { type: 'string' } },
          required: ['term', 'translation', 'example']
        }
      }
    },
    required: ['title', 'level', 'objective', 'explanation', 'examples', 'grammarPoints', 'vocabulary']
  },
  exercises: {
    type: 'object',
    properties: {
      exercises: {
        type: 'array',
        minItems: 4,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['multiple_choice', 'cloze', 'translate', 'order', 'free_production'] },
            instruction: { type: 'string' },
            prompt: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            tokens: { type: 'array', items: { type: 'string' } },
            answer: { type: 'string' },
            alternatives: { type: 'array', items: { type: 'string' } },
            explanation: { type: 'string' },
            targetTags: { type: 'array', items: { type: 'string' } }
          },
          required: ['type', 'instruction', 'prompt', 'answer']
        }
      }
    },
    required: ['exercises']
  },
  correction: {
    type: 'object',
    properties: {
      hasErrors: { type: 'boolean' },
      corrections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            original: { type: 'string' },
            corrected: { type: 'string' },
            tag: { type: 'string' },
            note: { type: 'string' }
          },
          required: ['original', 'corrected', 'tag']
        }
      },
      recast: { type: 'string' }
    },
    required: ['corrections']
  },
  track_plan: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      goalTag: { type: 'string' },
      objective: { type: 'string' },
      lessons: {
        type: 'array',
        minItems: 3,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            objective: { type: 'string' },
            focusVocabulary: { type: 'array', minItems: 1, items: { type: 'string' } }
          },
          required: ['title', 'objective', 'focusVocabulary']
        }
      }
    },
    required: ['title', 'goalTag', 'lessons']
  },
  scenario_gen: {
    type: 'object',
    properties: {
      persona: { type: 'string' },
      setting: { type: 'string' },
      successCriteria: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string' } },
      openingLine: { type: 'string' }
    },
    required: ['persona', 'setting', 'successCriteria', 'openingLine']
  },
  scenario_feedback: {
    type: 'object',
    properties: {
      contentScore: { type: 'number' },
      languageScore: { type: 'number' },
      feedback: { type: 'string' },
      criteriaMet: { type: 'array', items: { type: 'boolean' } },
      bestPhrases: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: { original: { type: 'string' }, improved: { type: 'string' }, reason: { type: 'string' } },
          required: ['original', 'improved']
        }
      },
      followUpDrill: { type: 'string' }
    },
    required: ['contentScore', 'languageScore', 'feedback']
  }
}

// --- Tarefas golden por idioma ----------------------------------------------

const SYSTEM = [
  `Você é um professor de ${LANG.target} para falantes de português do Brasil.`,
  `Explicações em português do Brasil; exemplos em ${LANG.target} no nível CEFR informado.`,
  LANG.direction === 'rtl'
    ? `Escreva o texto em ${LANG.target} na direção correta (RTL) e responda em português nas explicações.`
    : LANG.spaced
      ? `Use ${LANG.target} natural e no nível pedido.`
      : `${LANG.target} não separa palavras por espaço: devolva frases naturais sem juntar tokens artificialmente.`,
  'Responda SEMPRE com um único objeto JSON válido, sem markdown e sem texto fora do JSON.'
].join(' ')

/** ~20 tarefas por idioma: contratos do plano + acurácia de correção. */
function tasksFor(lang) {
  const tasks = [
    {
      name: 'placement',
      schema: SCHEMAS.placement,
      user: `Monte 8 questões de nivelamento de ${lang.target} para um aluno brasileiro, cobrindo A1 a B1, com 4 opções cada, answerIndex e explanation. O enunciado vai no idioma-alvo, a explicação em português.`
    },
    {
      name: 'curriculum_plan',
      schema: SCHEMAS.curriculum,
      user: `Monte 2 unidades de ${lang.target} para aluno A2 com objetivo "${lang.goal}", 3 lições cada, com título e objetivo.`
    },
    {
      name: 'curriculum_plan_incremental',
      schema: SCHEMAS.curriculum,
      user: `Outra proposta de 2 unidades de ${lang.target} (A2→B1), agora para conversação do dia a dia, 3 lições por unidade.`
    },
    {
      name: 'lesson_content',
      schema: SCHEMAS.lesson,
      user: [
        `Conteúdo da lição "Apresentar-se e falar do trabalho" (${lang.target}, A2).`,
        'Inclua pitfalls: 2 armadilhas típicas de quem fala português.',
        'Explicação em português, 3 exemplos {target, native}, 1 ponto de gramática, 5 itens de vocabulário.'
      ].join('\n')
    },
    {
      name: 'lesson_content_grammar',
      schema: SCHEMAS.lesson,
      user: [
        `Conteúdo da lição "Passado simples" (${lang.target}, A2), nível governado pela lição.`,
        'Restrição: use só vocabulário A2 além das 5 palavras-alvo.',
        'Explicação em português, 3 exemplos {target, native}, 2 pontos de gramática, 5 itens de vocabulário.'
      ].join('\n')
    },
    {
      name: 'lesson_content_constraints',
      schema: SCHEMAS.lesson,
      user: [
        `Lição "Fazer uma pergunta educada" (${lang.target}, A2) para aluno que erra registro e ordem de palavras.`,
        'Máximo 2 frases por exemplo. Explicação em português com no máximo 80 palavras.'
      ].join('\n')
    },
    {
      name: 'exercise_gen',
      schema: SCHEMAS.exercises,
      user: [
        `Crie 6 exercícios de ${lang.target} (A2) sobre passado simples, mirando os erros do aluno.`,
        'Cada exercício traz targetTags com as áreas que treina; pelo menos 2 devem mirar erros listados.',
        'Inclua um exercício "order" com tokens separados.'
      ].join('\n')
    },
    {
      name: 'exercise_gen_types',
      schema: SCHEMAS.exercises,
      user: [
        `Gere 5 exercícios de ${lang.target} (A2) cobrindo múltipla escolha, cloze, tradução, ordenar frase e produção livre.`,
        'Gabarito (answer) obrigatório e coerente com o enunciado.'
      ].join('\n')
    },
    {
      name: 'exercise_gen_focus',
      schema: SCHEMAS.exercises,
      user: [
        `Exercícios de ${lang.target} (A2) sobre o domínio "${lang.goal}".`,
        'Use só vocabulário A2 exceto as 5 palavras-alvo do domínio; cada item diz quais tags treina.'
      ].join('\n')
    },
    {
      name: 'track_plan',
      schema: SCHEMAS.track_plan,
      user: [
        `Esboço de trilha de foco em ${lang.target}: "${lang.goal}".`,
        '5 lições com título, objetivo e 5 palavras-alvo do domínio (no idioma-alvo).',
        'A gramática continua A2; o que muda é vocabulário e situação. Traga title, goalTag e lessons.'
      ].join('\n')
    },
    {
      name: 'track_plan_short',
      schema: SCHEMAS.track_plan,
      user: `Outro esboço de trilha em ${lang.target} (A2), agora "viagem: aeroporto e hospedagem", com 4 lições.`
    },
    {
      name: 'scenario_gen',
      schema: SCHEMAS.scenario_gen,
      user: [
        `Roleplay de fechamento da lição "Pergunte sobre a vaga" (${lang.target}, A2, objetivo "${lang.goal}").`,
        'persona e setting em português; successCriteria (3 a 4, em português); openingLine no idioma-alvo, nível A2.'
      ].join('\n')
    },
    {
      name: 'scenario_gen_topic',
      schema: SCHEMAS.scenario_gen,
      user: `Cenário avulso em ${lang.target} (A2): "pedir comida em um restaurante". Mesmos campos, openingLine no idioma-alvo.`
    },
    {
      name: 'scenario_feedback',
      schema: SCHEMAS.scenario_feedback,
      user: [
        `Roleplay em ${lang.target}: entrevistador x aluno A2. Critérios: apresentar trajetória; descrever um projeto com resultado; fazer uma pergunta sobre a vaga.`,
        'Transcrição: aluno: "I have background in backend. I maintain two services." tutor: "Nice." aluno: "My team ship a new api last month."',
        'Devolva contentScore (0–1, só a tarefa), languageScore (0–1, só a língua), criteriaMet (um booleano por critério), feedback em português e followUpDrill.'
      ].join('\n'),
      check: 'scenario_feedback'
    },
    {
      name: 'scenario_feedback_partial',
      schema: SCHEMAS.scenario_feedback,
      user: [
        `Roleplay em ${lang.target} (A2): aluno fluente mas não respondeu o que foi pedido.`,
        'Critérios: dizer o nome e o cargo; falar de um projeto; fazer uma pergunta. Aluno só disse "My name is Ana. I am developer.".',
        'contentScore deve ser menor que languageScore (a tarefa não foi cumprida).'
      ].join('\n'),
      check: 'scenario_feedback'
    }
  ]

  // Acurácia de correção: um par golden vira uma tarefa de grade_answer.
  // M6 (F1): com o núcleo real carregado, o prompt e o schema enviados são os
  // MESMOS que o app usa (correctionPrompt + correctionSetSchema), e os
  // goldens saem do banco de interferência — o contrato avaliado é o contrato
  // do produto, não uma colagem à mão.
  for (const [index, golden] of lang.golden.entries()) {
    let user = [
      `Corrija a frase de um aluno de ${lang.target}: "${golden.text}"`,
      'Devolva corrections (original, corrected, tag, note) e recast.',
      'Tags em kebab-case, em inglês.'
    ].join('\n')
    let schema = SCHEMAS.correction
    let system = undefined

    if (CORE) {
      const prompt = CORE.correction.correctionPrompt({
        text: golden.text,
        level: 'A2',
        style: 'both',
        errors: [],
        locale: CORE.prompts.promptLocale(lang.code, 'pt-BR')
      })
      user = prompt.user
      system = prompt.system
      schema = CORE.z.toJSONSchema(CORE.schemas.correctionSetSchema)
    }

    tasks.push({ name: `grade_answer_${index + 1}`, schema, user, system, check: 'correction', golden })
  }

  tasks.push({
    name: 'tutor_turn',
    schema: SCHEMAS.correction,
    user: [
      `Aluno escreveu em ${lang.target}: "${lang.sample}".`,
      'Corrija como o tutor faria: corrections + recast (a frase reescrita certa).'
    ].join('\n'),
    check: 'correction',
    golden: { text: lang.sample, tag: 'tense|past-simple|agreement', expect: '' }
  })

  return tasks
}

// --- Provedores --------------------------------------------------------------

async function ask(user, schema, temperature = 0.3, system = SYSTEM) {
  const prompt = `${system}\n\nFormato obrigatório (JSON Schema):\n${JSON.stringify(schema)}\n\nTarefa:\n${user}`
  const startedAt = Date.now()

  if (provider === 'gemini') {
    if (!geminiKey) throw new Error('defina GEMINI_API_KEY')
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generate?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, responseMimeType: 'application/json' }
        })
      }
    )
    if (!response.ok) throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const payload = await response.json()
    return { text: payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '', latencyMs: Date.now() - startedAt }
  }

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false,
      format: 'json',
      options: { temperature }
    })
  })
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const payload = await response.json()
  return { text: payload.message?.content ?? '', latencyMs: Date.now() - startedAt }
}

function extractJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()

/** Checagem mínima de contrato — o app usa zod; aqui só interessa "serveu?". */
function looksUsable(task, parsed) {
  if (!parsed || typeof parsed !== 'object') return false
  const name = task.name

  if (name === 'placement') return Array.isArray(parsed.questions) && parsed.questions.length >= 6
  if (name.startsWith('curriculum_plan')) return Array.isArray(parsed.units) && parsed.units.length >= 2
  if (name.startsWith('lesson_content')) {
    if (typeof parsed.explanation !== 'string' || parsed.explanation.length < 40) return false
    if (!Array.isArray(parsed.vocabulary) || parsed.vocabulary.length < 3) return false
    // M4: exemplo é par {target, native} — {en, pt} não vale mais.
    return (
      Array.isArray(parsed.examples) &&
      parsed.examples.length >= 2 &&
      parsed.examples.every((example) => typeof example.target === 'string' && typeof example.native === 'string')
    )
  }
  if (name.startsWith('exercise_gen')) {
    if (!Array.isArray(parsed.exercises) || parsed.exercises.length < 4) return false
    const focused = parsed.exercises.filter((exercise) => Array.isArray(exercise.targetTags) && exercise.targetTags.length > 0)
    if (name === 'exercise_gen' && focused.length < 2) return false
    const order = parsed.exercises.find((exercise) => exercise.type === 'order')
    if (name === 'exercise_gen_types' && (!order || !Array.isArray(order.tokens) || order.tokens.length === 0)) return false
    return true
  }
  if (name.startsWith('track_plan')) {
    if (typeof parsed.title !== 'string' || !Array.isArray(parsed.lessons)) return false
    if (parsed.lessons.length < 3) return false
    return parsed.lessons.every((lesson) => Array.isArray(lesson.focusVocabulary) && lesson.focusVocabulary.length > 0)
  }
  if (name.startsWith('scenario_gen')) {
    return (
      typeof parsed.persona === 'string' &&
      Array.isArray(parsed.successCriteria) &&
      parsed.successCriteria.length >= 2 &&
      typeof parsed.openingLine === 'string' &&
      parsed.openingLine.trim().length > 0
    )
  }
  if (name.startsWith('scenario_feedback')) {
    const content = Number(parsed.contentScore)
    const language = Number(parsed.languageScore)
    if (!Number.isFinite(content) || !Number.isFinite(language)) return false
    if (content < 0 || content > 1 || language < 0 || language > 1) return false
    // O ponto do M3: tarefa e língua são medidas diferentes — nota copiada
    // significa que o modelo não separou as duas rubricas.
    if (content === language) return false
    if (name === 'scenario_feedback_partial' && !(content < language)) return false
    return true
  }
  // grade_answer_* / tutor_turn
  return Array.isArray(parsed.corrections)
}

/**
 * Acurácia de correção: pegou a tag esperada e a forma esperada?
 *
 * M6 (F1/F2): golden com `tag: 'correct'` e `expect: ''` é uma frase CORRETA —
 * sucesso aqui é não corrigir nada (hasErrors false / corrections vazias). O
 * harness antigo tratava "zero correções" como falha e, portanto, pontuava
 * alucinação como sucesso.
 */
function correctionAccuracy(parsed, golden) {
  const corrections = Array.isArray(parsed?.corrections) ? parsed.corrections : []
  const cleanExpected = !String(golden.expect || '').trim() && normalize(String(golden.tag)) === 'correct'

  if (cleanExpected) {
    return { tagHit: true, formHit: true, pass: corrections.length === 0, found: corrections.length, clean: true }
  }

  const tags = corrections.map((correction) => normalize(correction.tag))
  const joined = corrections.map((correction) => normalize(correction.corrected)).join(' | ')

  const tagAlternatives = String(golden.tag)
    .split('|')
    .map((tag) => normalize(tag))
    .filter((tag) => tag && tag !== 'correct')
  const tagHit = tagAlternatives.length === 0
    ? corrections.length > 0
    : tagAlternatives.some((tag) => tags.some((entry) => entry.includes(tag)))

  const forms = String(golden.expect || '')
    .split('|')
    .map((entry) => normalize(entry))
    .filter(Boolean)
  // Sem `expect`, o teste é só de tag: precisa achar alguma correção.
  const formHit = forms.length === 0 ? corrections.length > 0 : forms.some((form) => joined.includes(form))

  return { tagHit, formHit, pass: tagHit && formHit, found: corrections.length }
}

/** Escrita do idioma: RTL precisa vir em árabe, CJK precisa vir segmentável. */
function scriptCheck(task, parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  const sample =
    [
      ...(Array.isArray(parsed.examples) ? parsed.examples.map((example) => example.target) : []),
      ...(Array.isArray(parsed.vocabulary) ? parsed.vocabulary.map((item) => item.example) : []),
      ...(Array.isArray(parsed.questions) ? parsed.questions.map((question) => question.prompt) : []),
      typeof parsed.openingLine === 'string' ? parsed.openingLine : '',
      ...(Array.isArray(parsed.exercises) ? parsed.exercises.map((exercise) => exercise.prompt) : [])
    ]
      .filter(Boolean)
      .join(' ') || ''

  if (!sample) return null

  if (LANG.direction === 'rtl') {
    const arabic = (sample.match(/[\u0600-\u06FF]/g) || []).length
    return { ok: arabic >= 3, detail: `${arabic} chars árabes` }
  }
  if (!LANG.spaced) {
    const kana = (sample.match(/[\u3040-\u30FF]/g) || []).length
    const han = (sample.match(/[\u4E00-\u9FFF]/g) || []).length
    const ok = kana + han >= 3
    return { ok, detail: `${kana} kana / ${han} han` }
  }
  return { ok: true, detail: null }
}

// --- Execução ----------------------------------------------------------------

async function runOffline() {
  const { spawnSync } = await import('node:child_process')

  console.log(`\n=== linha de base determinística · sem IA (${langCode}) ===`)
  console.log('A passada offline (bancos de interferência, FSRS, correção, i18n) roda em `npm test`.\n')

  // `npm run eval -- --offline` já embute o CORE (mesmos contratos do app) —
  // se a compilação falhar, o gate de teste ainda roda, e o exit code conta.
  if (!CORE) {
    try {
      const { loadEvalCore, goldensFromBank } = await import('./eval-core.mjs')
      CORE = await loadEvalCore()
      BANK_GOLDENS = goldensFromBank
      console.log('Núcleo real carregado (prompts/schemas/banco do app).\n')
    } catch (error) {
      console.warn(`[eval] núcleo real indisponível no modo offline: ${error.message}`)
    }
  }

  // Sanidade dos derivado-do-banco: os goldens limpos do CORE precisam passar
  // no avaliador do harness (frase correta ⇒ sem correções).
  if (CORE && BANK_GOLDENS) {
    const goldens = BANK_GOLDENS(CORE, CORE.interference.INTERFERENCE_BANK, 6)
    const cleanGoldens = goldens.filter((g) => g.tag === 'correct')
    // O teste de verdade: o banco determinístico do app não pode achar erro em
    // nenhuma forma canônica correta (falso positivo = alucinação garantida).
    const bankClean = cleanGoldens.every(
      (g) => CORE.correction.bankCorrections(g.text, CORE.interference.INTERFERENCE_BANK).length === 0
    )
    const allCleanPass = cleanGoldens.every((g) => correctionAccuracy({ corrections: [] }, g).pass)
    const hallucinationFails = cleanGoldens.every((g) => !correctionAccuracy({ corrections: [{ original: g.text, corrected: g.text + '!' , tag: 'x' }] }, g).pass)
    console.log(`goldens do banco: ${goldens.length} (${cleanGoldens.length} limpos) · avaliador: limpo-passa=${allCleanPass} alucinação-falha=${hallucinationFails} banco-sem-falso-positivo=${bankClean}`)
    if (!(allCleanPass && hallucinationFails && bankClean)) {
      console.error('\nGate offline: o avaliador está invertido (frase correta deve passar sem correções).\n')
      process.exit(1)
    }
  }

  const result = spawnSync('npx', ['vitest', 'run', '--reporter=dot'], {
    encoding: 'utf8',
    cwd: process.cwd()
  })

  // O sumário do vitest é a resposta: "quantos contratos determinísticos passam".
  const summary = (result.stdout || '')
    .split('\n')
    .filter((line) => /Test Files|Tests\s|Duration/.test(line))
    .join('\n')

  console.log(summary || result.stdout || result.stderr)

  if (result.status === 0) {
    console.log(
      '\nBaseline offline íntegro: banco de interferência, FSRS, correção objetiva,\nsegmentação CJK, i18n e integração do loop passam sem provedor.\n'
    )
  } else {
    console.log('\nA linha de base offline quebrou — nada de medir IA antes de consertá-la.\n')
  }

  process.exit(result.status ?? 0)
}

async function main() {
  if (offline) return runOffline()

  const tasks = tasksFor(LANG)
  const subset = repeatLimit ? tasks.slice(0, repeatLimit) : tasks

  console.log(`\n=== avaliação de IA · ${provider} · ${model} · idioma ${langCode} (${LANG.target}) ===`)
  console.log(`${subset.length} tarefas golden (a linha de base determinística é o --offline)\n`)

  const rows = []

  for (const task of subset) {
    try {
      const { text, latencyMs } = await ask(task.user, task.schema, 0.3, task.system ?? SYSTEM)
      const parsed = extractJson(text)
      const valid = parsed !== null
      const usable = valid && looksUsable(task, parsed)
      const accuracy = task.check === 'correction' && valid ? correctionAccuracy(parsed, task.golden) : null
      const script = valid ? scriptCheck(task, parsed) : null

      rows.push({ task: task.name, valid, usable, latencyMs, accuracy, script })

      const status = !valid ? 'FAIL' : !usable ? 'warn' : accuracy && !accuracy.pass ? 'miss' : script && !script.ok ? 'warn' : 'ok  '
      const extras = [
        valid ? '' : '(json inválido)',
        valid && !usable ? '(contrato)' : '',
        accuracy ? `(tag ${accuracy.tagHit ? '✓' : '✗'} forma ${accuracy.formHit ? '✓' : '✗'})` : '',
        script && !script.ok ? `(escrita: ${script.detail})` : ''
      ]
        .filter(Boolean)
        .join(' ')

      console.log(`${status} ${task.name.padEnd(26)} ${String(latencyMs).padStart(6)} ms  ${extras}`)
    } catch (error) {
      rows.push({ task: task.name, valid: false, usable: false, latencyMs: 0, accuracy: null, script: null })
      console.log(`ERR  ${task.name.padEnd(26)} ${String(error.message).slice(0, 90)}`)
    }
  }

  const total = rows.length
  const validCount = rows.filter((row) => row.valid).length
  const usableCount = rows.filter((row) => row.usable).length
  const correctionRows = rows.filter((row) => row.accuracy)
  const tagHits = correctionRows.filter((row) => row.accuracy.tagHit).length
  const formHits = correctionRows.filter((row) => row.accuracy.formHit).length
  const scriptRows = rows.filter((row) => row.script)
  const scriptOk = scriptRows.filter((row) => row.script.ok).length
  const latencies = rows.map((row) => row.latencyMs).filter((value) => value > 0)

  console.log('\n=== resumo ===')
  console.log(`idioma         : ${langCode} (${LANG.target}) — ${LANG.direction}, ${LANG.script}`)
  console.log(`JSON parseável : ${validCount}/${total} (${Math.round((validCount / total) * 100)}%)`)
  console.log(`contrato ok    : ${usableCount}/${total} (${Math.round((usableCount / total) * 100)}%)`)
  if (correctionRows.length > 0) {
    console.log(
      `acurácia       : tag ${tagHits}/${correctionRows.length} · forma ${formHits}/${correctionRows.length} (${Math.round(
        (correctionRows.filter((row) => row.accuracy.pass).length / correctionRows.length) * 100
      )}% dos itens golden)`
    )
  }
  if (scriptRows.length > 0) {
    console.log(`escrita        : ${scriptOk}/${scriptRows.length} tarefas no script do idioma`)
  }
  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b)
    console.log(`latência       : p50 ${sorted[Math.floor(sorted.length / 2)]} ms · máx ${sorted[sorted.length - 1]} ms`)
  }

  // M6 (F2): histórico em JSON — um run sozinho é anedota; a série é o gate.
  const cleanRows = rows.filter((row) => row.accuracy?.clean)
  const cleanPass = cleanRows.filter((row) => row.accuracy.pass).length
  const dirtyRows = rows.filter((row) => row.accuracy && !row.accuracy.clean)
  const dirtyPass = dirtyRows.filter((row) => row.accuracy.pass).length

  const summary = {
    at: new Date().toISOString(),
    provider,
    model,
    lang: langCode,
    total,
    valid: validCount,
    usable: usableCount,
    cleanGoldens: { total: cleanRows.length, pass: cleanPass },
    correctionGoldens: { total: dirtyRows.length, pass: dirtyPass },
    rows
  }

  const fs = await import('node:fs')
  const path = await import('node:path')
  const dir = path.resolve(process.cwd(), 'eval-results')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = summary.at.replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(dir, `${langCode}-${provider}-${stamp}.json`), JSON.stringify(summary, null, 2))

  const historyFile = path.join(dir, 'history.json')
  const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : []
  history.push({ at: summary.at, provider, model, lang: langCode, total, usable: usableCount, accuracy: `${dirtyPass}/${dirtyRows.length}`, clean: `${cleanPass}/${cleanRows.length}` })
  fs.writeFileSync(historyFile, JSON.stringify(history.slice(-200), null, 2))

  // Gate (exit code): contrato 100%, e as duas metades da acurácia —
  //   • frase correta SEM correção (anti-alucinação) — tolera 1 scopo em 10;
  //   • erro conhecido CORRIJÍVEL — mínimo `--min-accuracy` (padrão 0.5).
  const minAccuracy = Number(flagValue('--min-accuracy') ?? '0.5')
  const accuracyRate = dirtyRows.length > 0 ? dirtyPass / dirtyRows.length : 1
  const cleanRate = cleanRows.length > 0 ? cleanPass / cleanRows.length : 1
  const allowedCleanMiss = cleanRows.length >= 4 ? 1 : 0

  const contractOk = usableCount === total
  const accuracyOk = accuracyRate >= minAccuracy
  const antiHallucinationOk = cleanRows.length === 0 || cleanPass >= cleanRows.length - allowedCleanMiss

  console.log(
    usableCount < total
      ? '\nAbaixo de 100% no contrato: confira o modelo (pequeno precisa de schema + retentativa) ou use o fallback determinístico — que só existe para inglês.\n'
      : '\nContratos íntegros: o app não precisará de fallback nesta rodada.\n'
  )
  console.log(`gate: contrato=${contractOk} acurácia=${accuracyOk} (${Math.round(accuracyRate * 100)}% ≥ ${Math.round(minAccuracy * 100)}%) sem-alucinação=${antiHallucinationOk} (${cleanPass}/${cleanRows.length} = ${Math.round(cleanRate * 100)}%)`)
  console.log(`histórico: eval-results/history.json\n`)

  if (!(contractOk && accuracyOk && antiHallucinationOk)) process.exit(1)
}

main().catch((error) => {
  console.error(`\nERRO: ${error.message}\n`)
  process.exit(1)
})
