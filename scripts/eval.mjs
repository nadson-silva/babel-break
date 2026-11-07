#!/usr/bin/env node
/**
 * Harness de avaliação (PLAN §11) — manual, não é CI.
 *
 * Roda as tarefas estruturadas contra um provedor real e mede o que importa
 * para o produto: taxa de JSON inválido, latência e se a correção pegou as
 * tags esperadas. A passada determinística (banco PT-BR) é coberta por
 * `npm test`, que é a linha de base quando o modelo falha.
 *
 * Uso:
 *   node scripts/eval.mjs --ollama [modelo]
 *   GEMINI_API_KEY=… node scripts/eval.mjs --gemini gemini-2.5-flash
 */

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const provider = process.argv.includes('--gemini') ? 'gemini' : 'ollama'
const ollamaUrl = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
const fallbackModel = provider === 'gemini' ? 'gemini-2.5-flash' : 'qwen3.5:0.8b'
const model = args[0] ?? process.env.LT_EVAL_MODEL ?? fallbackModel
const geminiKey = process.env.GEMINI_API_KEY ?? ''

const SYSTEM = [
  'Você é um professor de inglês para falantes de português do Brasil.',
  'Explicações em português do Brasil, exemplos no nível CEFR informado.',
  'Responda SEMPRE com um único objeto JSON válido, sem markdown e sem texto fora do JSON.'
].join(' ')

const SCHEMAS = {
  curriculum: {
    type: 'object',
    properties: {
      units: {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1'] },
            lessons: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
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
        items: {
          type: 'object',
          properties: { en: { type: 'string' }, pt: { type: 'string' } },
          required: ['en', 'pt']
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
      lessons: {
        type: 'array',
        minItems: 4,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            objective: { type: 'string' },
            focusVocabulary: { type: 'array', items: { type: 'string' } }
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
      successCriteria: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } },
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

const TASKS = [
  {
    name: 'curriculum_plan',
    schema: SCHEMAS.curriculum,
    user: 'Monte 2 unidades de inglês para um aluno brasileiro A2 com objetivo "entrevista para dev", 3 lições cada, com título e objetivo.'
  },
  {
    name: 'lesson_content',
    schema: SCHEMAS.lesson,
    user: [
      'Conteúdo da lição "Past simple: verbos regulares" (A2).',
      'Inclua pitfalls: 2 armadilhas de quem fala português (ex.: "I didn\'t went").',
      'Explicação em português, 3 exemplos inglês/português, 1 ponto de gramática, 5 itens de vocabulário.'
    ].join('\n')
  },
  {
    name: 'exercise_gen',
    schema: SCHEMAS.exercises,
    user: [
      'Crie 6 exercícios sobre past simple para aluno A2 que erra "didn\'t went" e "I am developer".',
      'Cada exercício traz targetTags com as áreas que treina; pelo menos 2 devem mirar esses erros.'
    ].join('\n')
  },
  {
    name: 'grade_answer',
    schema: SCHEMAS.correction,
    user: 'Corrija a frase de um aluno: "I have 25 years and I am agree with the plan." Devolva corrections e recast.'
  },
  {
    name: 'tutor_turn',
    schema: SCHEMAS.correction,
    user: 'Aluno escreveu: "Yesterday I go to work and I didn\'t took my laptop.". Corrija e devolva recast.'
  },
  {
    name: 'track_plan',
    schema: SCHEMAS.track_plan,
    user: [
      'Esboço de trilha de foco para aluno A2: "entrevista para desenvolvedor backend".',
      '5 lições, cada uma com título, objetivo e 5 palavras-alvo do domínio (em inglês).',
      'A gramática continua A2; o que muda é o vocabulário e a situação. Traga title, goalTag e lessons.'
    ].join('\n')
  },
  {
    name: 'scenario_gen',
    schema: SCHEMAS.scenario_gen,
    user: [
      'Crie o roleplay de fechamento da lição "Pergunte sobre a vaga" (A2, entrevista para dev).',
      'Traga persona (em português), setting (em português), successCriteria (3 a 4, em português) e',
      'openingLine (a primeira fala do personagem, em inglês, nível A2).'
    ].join('\n')
  },
  {
    name: 'scenario_feedback',
    schema: SCHEMAS.scenario_feedback,
    user: [
      'Roleplay: entrevistador x aluno A2. Critérios: apresentar trajetória; descrever um projeto com resultado;',
      'fazer uma pergunta sobre a vaga.',
      'Transcrição: aluno: "I have background in backend. I maintain two services." tutor: "Nice."',
      'aluno: "My team ship a new api last month." tutor: "How was the launch?" aluno: "Very good."',
      'Dê contentScore (0 a 1, só a tarefa), languageScore (0 a 1, só a língua, os erros são articles e',
      'past-simple), criteriaMet (um booleano por critério), feedback em português e followUpDrill.'
    ].join('\n')
  }
]

async function ask(user, schema, temperature = 0.3) {
  const prompt = `${SYSTEM}\n\nFormato obrigatório (JSON Schema):\n${JSON.stringify(schema)}\n\nTarefa:\n${user}`
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

/** Checagem mínima de contrato — o app usa zod; aqui só interessa "serveu?". */
function looksUsable(name, parsed) {
  if (!parsed || typeof parsed !== 'object') return false
  if (name === 'curriculum_plan') return Array.isArray(parsed.units) && parsed.units.length >= 2
  if (name === 'lesson_content')
    return typeof parsed.explanation === 'string' && Array.isArray(parsed.vocabulary) && parsed.vocabulary.length >= 4
  if (name === 'exercise_gen') return Array.isArray(parsed.exercises) && parsed.exercises.length >= 4
  if (name === 'track_plan') {
    if (typeof parsed.title !== 'string' || !Array.isArray(parsed.lessons)) return false
    if (parsed.lessons.length < 4) return false
    return parsed.lessons.every((lesson) => Array.isArray(lesson.focusVocabulary) && lesson.focusVocabulary.length > 0)
  }
  if (name === 'scenario_gen') {
    return (
      typeof parsed.persona === 'string' &&
      Array.isArray(parsed.successCriteria) &&
      parsed.successCriteria.length >= 2 &&
      typeof parsed.openingLine === 'string'
    )
  }
  if (name === 'scenario_feedback') {
    const content = Number(parsed.contentScore)
    const language = Number(parsed.languageScore)
    if (!Number.isFinite(content) || !Number.isFinite(language)) return false
    if (content < 0 || content > 1 || language < 0 || language > 1) return false
    // o ponto do M3: tarefa e língua são medidas diferentes — um score copiado do
    // outro significa que o modelo não separou as duas rubricas
    return content !== language
  }
  return Array.isArray(parsed.corrections)
}

console.log(`\n=== avaliação de IA · ${provider} · ${model} ===`)
console.log('(a linha de base determinística — banco PT-BR — é verificada por `npm test`)')

const rows = []
for (const task of TASKS) {
  try {
    const { text, latencyMs } = await ask(task.user, task.schema)
    const parsed = extractJson(text)
    const valid = parsed !== null
    const usable = looksUsable(task.name, parsed)
    rows.push({ task: task.name, valid, usable, latencyMs })
    console.log(
      `${valid && usable ? 'ok  ' : usable ? 'warn' : 'FAIL'} ${task.name.padEnd(16)} ${String(latencyMs).padStart(6)} ms  ${
        valid ? '' : '(json inválido)'
      }`
    )
  } catch (error) {
    rows.push({ task: task.name, valid: false, usable: false, latencyMs: 0 })
    console.log(`ERR  ${task.name.padEnd(16)} ${String(error.message).slice(0, 90)}`)
  }
}

const total = rows.length
const validCount = rows.filter((row) => row.valid).length
const usableCount = rows.filter((row) => row.usable).length
const latencies = rows.map((row) => row.latencyMs).filter((value) => value > 0)

console.log('\n=== resumo ===')
console.log(`JSON parseável : ${validCount}/${total} (${Math.round((validCount / total) * 100)}%)`)
console.log(`contrato ok    : ${usableCount}/${total} (${Math.round((usableCount / total) * 100)}%)`)
if (latencies.length > 0) {
  const sorted = [...latencies].sort((a, b) => a - b)
  console.log(`latência       : p50 ${sorted[Math.floor(sorted.length / 2)]} ms · máx ${sorted[sorted.length - 1]} ms`)
}
console.log(
  usableCount < total
    ? '\nAbaixo de 100% no contrato: confira o modelo (Modelos pequenos precisam de schema + retentativa) ou ative o fallback determinístico.\n'
    : '\nContratos íntegros: o app não precisará de fallback nesta rodada.\n'
)
