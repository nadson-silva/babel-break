/**
 * Banco de interferência PT-BR → inglês.
 *
 * Erros que falantes de português brasileiro cometem *por transferência* do
 * nativo, não por falta de vocabulário. O banco tem dois usos:
 *
 * 1. Correção determinística (funciona offline, sem IA): `detectInterference`
 *    encontra o padrão e `recast` devolve a frase corrigida.
 * 2. Âncora de qualidade: os pares erradо→certo viram fixtures para prompts
 *    (`exercise_gen`, `tutor_turn`) e para o harness de avaliação, para que as
 *    correções mirem erros reais e não genéricos.
 *
 * Regras com `to` reescrevem a frase; regras sem `to` são `advisory`:
 * apontam o problema e a forma correta, mas quem decide a reescrita é o modelo
 * (falsos cognatos dependem de contexto).
 */

export interface InterferenceRule {
  id: string
  tag: string
  /** Sempre com flag `g`; casa o padrão no texto do aluno. */
  find: RegExp
  /** Reescrita determinística. Ausente = regra advisory (só anota). */
  to?: string | ((match: RegExpMatchArray) => string)
  /** Exemplo canônico errado (fixture de prompt e do app). */
  wrong: string
  /** Exemplo canônico certo. */
  right: string
  /** Explicação em PT-BR, curta. */
  note: string
}

/** Passado simples irregular → forma base (usado depois de did/didn't). */
const PAST_TO_BASE: Record<string, string> = {
  went: 'go',
  saw: 'see',
  took: 'take',
  ate: 'eat',
  came: 'come',
  made: 'make',
  had: 'have',
  wrote: 'write',
  spoke: 'speak',
  broke: 'break',
  drove: 'drive',
  gave: 'give',
  knew: 'know',
  told: 'tell',
  did: 'do',
  was: 'were',
  chose: 'choose',
  wore: 'wear'
}

/** Passado simples → particípio (usado depois de have/has/had). */
const PAST_TO_PARTICIPLE: Record<string, string> = {
  went: 'been',
  saw: 'seen',
  took: 'taken',
  ate: 'eaten',
  came: 'come',
  made: 'made',
  had: 'had',
  wrote: 'written',
  spoke: 'spoken',
  broke: 'broken',
  drove: 'driven',
  gave: 'given',
  knew: 'known',
  told: 'told',
  did: 'done',
  chose: 'chosen',
  wore: 'worn'
}

/** Terceira pessoa com -s → forma base (depois de does/does he). */
const THIRD_PERSON_TO_BASE: Record<string, string> = {
  works: 'work',
  studies: 'study',
  likes: 'like',
  goes: 'go',
  lives: 'live',
  has: 'have',
  does: 'do',
  plays: 'play',
  needs: 'need',
  wants: 'want',
  speaks: 'speak',
  thinks: 'think'
}

const ADJECTIVE_TO_ED: Record<string, string> = {
  boring: 'bored',
  interesting: 'interested',
  tiring: 'tired',
  confusing: 'confused',
  embarrassing: 'embarrassed',
  annoying: 'annoyed',
  exciting: 'excited',
  surprising: 'surprised'
}

const INDEFINITE_TO_ANY: Record<string, string> = {
  nothing: 'anything',
  nobody: 'anybody',
  'no one': 'anyone'
}

const UNCOUNTABLE: Record<string, string> = {
  informations: 'information',
  advices: 'advice',
  feedbacks: 'feedback',
  equipments: 'equipment',
  softwares: 'software',
  researches: 'research'
}

const COUNTABLE_LESS: string[] = [
  'people',
  'students',
  'friends',
  'problems',
  'options',
  'things',
  'days',
  'hours',
  'times',
  'cars'
]

const IRREGULAR_PAST_ALT = Object.keys(PAST_TO_BASE).join('|')
const PARTICIPLE_ALT = Object.keys(PAST_TO_PARTICIPLE).join('|')
const THIRD_PERSON_ALT = Object.keys(THIRD_PERSON_TO_BASE).join('|')
const ED_ADJ_ALT = Object.keys(ADJECTIVE_TO_ED).join('|')
const UNCOUNTABLE_ALT = Object.keys(UNCOUNTABLE).join('|')
const LESS_ALT = COUNTABLE_LESS.join('|')

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'an' : 'a'
}

export const INTERFERENCE_BANK: InterferenceRule[] = [
  {
    id: 'have-age',
    tag: 'have-vs-be',
    find: /\bi\s+(?:have|'ve)\s+(\w+)\s+years?(?:\s+old)?\b/gi,
    to: (match) => `I am ${match[1]} years old`,
    wrong: 'I have 25 years.',
    right: 'I am 25 years old.',
    note: 'Idade usa o verbo to be, não o have (erro clássico de "ter idade").'
  },
  {
    id: 'agree-be',
    tag: 'stative-verbs',
    find: /\b(i'?m|i\s+am|we'?re|we\s+are|they'?re|they\s+are)\s+agree\b/gi,
    to: (match) => {
      const subject = /^i/i.test(match[1]) ? 'I' : /^we/i.test(match[1]) ? 'We' : 'They'
      return `${subject} agree`
    },
    wrong: "I'm agree with you.",
    right: 'I agree with you.',
    note: '"Agree" já é verbo em inglês: "I agree", nunca "I am agree".'
  },
  {
    id: 'explain-me',
    tag: 'verb-preposition',
    find: /\bexplain(e?s|ed|ing)?\s+me\b/gi,
    to: (match) => `explain${match[1] ?? ''} to me`,
    wrong: 'Explain me this error.',
    right: 'Explain this to me.',
    note: 'Explicar algo "para" alguém: explain to me (o português omite a preposição).'
  },
  {
    id: 'listen-to',
    tag: 'verb-preposition',
    find: /\blisten(s|ed|ing)?\s+(music|radio|him|her|them|you)\b/gi,
    to: (match) => `listen${match[1] ?? ''} to ${match[2]}`,
    wrong: 'I listen music every day.',
    right: 'I listen to music every day.',
    note: 'Listen sempre pede to antes do objeto.'
  },
  {
    id: 'depend-of',
    tag: 'verb-preposition',
    find: /\bdepend(s|ed|ing)?\s+of\b/gi,
    to: (match) => `depend${match[1] ?? ''} on`,
    wrong: 'It depends of the client.',
    right: 'It depends on the client.',
    note: '"Depender de" em inglês é depend on.'
  },
  {
    id: 'good-in',
    tag: 'adjective-preposition',
    find: /\b(good|bad|excellent|terrible)\s+in\s+(?=a|an|the|my|his|her|their|programming|english|math|work|meetings)/gi,
    to: (match) => `${match[1]} at`,
    wrong: 'I am good in programming.',
    right: 'I am good at programming.',
    note: 'Ser bom/ruim "em" algo é be good at something.'
  },
  {
    id: 'married-with',
    tag: 'adjective-preposition',
    find: /\bmarried with\b/gi,
    to: () => 'married to',
    wrong: 'She is married with a doctor.',
    right: 'She is married to a doctor.',
    note: 'Casado "com" alguém é married to.'
  },
  {
    id: 'people-is',
    tag: 'subject-verb-agreement',
    find: /\bpeople\s+(is|was|has)\b/gi,
    to: (match) => `people ${match[1] === 'has' ? 'have' : match[1] === 'was' ? 'were' : 'are'}`,
    wrong: 'People is talking about it.',
    right: 'People are talking about it.',
    note: 'People é plural em inglês (como "as pessoas").'
  },
  {
    id: 'peoples',
    tag: 'plural',
    find: /\bpeoples\b/gi,
    to: () => 'people',
    wrong: 'Many peoples live here.',
    right: 'Many people live here.',
    note: 'O plural de people já é people; "peoples" só existe para povos/nações.'
  },
  {
    id: 'uncountable-s',
    tag: 'uncountable-noun',
    find: new RegExp(`\\b(${UNCOUNTABLE_ALT})\\b`, 'gi'),
    to: (match) => UNCOUNTABLE[match[1].toLowerCase()] ?? match[1],
    wrong: 'Thank you for the informations.',
    right: 'Thank you for the information.',
    note: 'Substantivos incontáveis não ganham -s em inglês.'
  },
  {
    id: 'did-irregular-past',
    tag: 'past-simple',
    find: new RegExp(`\\bdidn'?t\\s+(${IRREGULAR_PAST_ALT})\\b`, 'gi'),
    to: (match) => `didn't ${PAST_TO_BASE[match[1].toLowerCase()] ?? match[1]}`,
    wrong: "I didn't went there.",
    right: "I didn't go there.",
    note: 'Depois de did/didn’t o verbo volta à forma base: o passado já está no did.'
  },
  {
    id: 'did-question-past',
    tag: 'past-simple',
    find: new RegExp(`\\bdid\\s+(?:(you|he|she|it|they|we)\\s+)?(${IRREGULAR_PAST_ALT})\\b`, 'gi'),
    to: (match) => `did ${match[1] ? `${match[1]} ` : ''}${PAST_TO_BASE[match[2].toLowerCase()] ?? match[2]}`,
    wrong: 'Did you went to the meeting?',
    right: 'Did you go to the meeting?',
    note: 'Em perguntas com did, o verbo principal fica na forma base.'
  },
  {
    id: 'have-past-not-participle',
    tag: 'present-perfect',
    find: new RegExp(`\\b(have|has|had)\\s+(${PARTICIPLE_ALT})\\b`, 'gi'),
    to: (match) => `${match[1]} ${PAST_TO_PARTICIPLE[match[2].toLowerCase()] ?? match[2]}`,
    wrong: 'I have went there twice.',
    right: 'I have been there twice.',
    note: 'Present perfect pede particípio, não passado simples.'
  },
  {
    id: 'does-third-person',
    tag: 'present-simple',
    find: new RegExp(`\\bdoes\\s+(he|she|it|\\w+)\\s+(${THIRD_PERSON_ALT})\\b`, 'gi'),
    to: (match) => `does ${match[1]} ${THIRD_PERSON_TO_BASE[match[2].toLowerCase()] ?? match[2]}`,
    wrong: 'Does she works here?',
    right: 'Does she work here?',
    note: 'O -s da terceira pessoa já está no does: não repita no verbo principal.'
  },
  {
    id: 'ing-ed-adjective',
    tag: 'participle-adjective',
    find: new RegExp(`\\b(i(?:'m| am))\\s+(${ED_ADJ_ALT})\\b`, 'gi'),
    to: (match) => `${match[1]} ${ADJECTIVE_TO_ED[match[2].toLowerCase()] ?? match[2]}`,
    wrong: "I'm boring.",
    right: "I'm bored.",
    note: '-ing descreve a coisa; -ed descreve como você se sente ("I am bored" = estou entediado).'
  },
  {
    id: 'missing-article-profession',
    tag: 'articles',
    find:
      /\b(i(?:'m| am)|he(?:'s| is)|she(?:'s| is)|we(?:'re| are)|they(?:'re| are))\s+(developer|programmer|engineer|teacher|student|doctor|nurse|designer|analyst|manager|lawyer|accountant|architect|tester)\b/gi,
    to: (match) => `${match[1]} ${article(match[2])} ${match[2]}`,
    wrong: 'I am developer.',
    right: 'I am a developer.',
    note: 'Profissões em inglês levam artigo indefinido (o português omite).'
  },
  {
    id: 'more-double-comparative',
    tag: 'comparative',
    find:
      /\bmore\s+(better|bigger|faster|easier|worse|older|younger|cheaper|harder|stronger)\b/gi,
    to: (match) => match[1],
    wrong: 'This is more better.',
    right: 'This is better.',
    note: 'Comparativo duplo não existe: ou -er, ou more.'
  },
  {
    id: 'less-countable',
    tag: 'quantifier',
    find: new RegExp(`\\bless\\s+(${LESS_ALT})\\b`, 'gi'),
    to: (match) => `fewer ${match[1]}`,
    wrong: 'We have less people here.',
    right: 'We have fewer people here.',
    note: 'Contáveis usam fewer; less fica para incontáveis (less time).'
  },
  {
    id: 'double-negative',
    tag: 'double-negative',
    find: /\b(don'?t|doesn'?t|didn'?t)\s+(?:(\w+)\s+)?(nothing|nobody|no one)\b/gi,
    to: (match) =>
      `${match[1]} ${match[2] ? `${match[2]} ` : ''}${INDEFINITE_TO_ANY[match[3].toLowerCase()] ?? match[3]}`,
    wrong: "I don't know nothing about it.",
    right: "I don't know anything about it.",
    note: 'Dupla negação não existe em inglês: uma só marca de negação.'
  },
  {
    id: 'adverb-placement',
    tag: 'adverb-placement',
    find:
      /\b(i|we|they|you)\s+(go|work|study|practice|eat|speak|travel|arrive)\s+(always|often|never|sometimes|usually)\b/gi,
    to: (match) => `${match[1]} ${match[3]} ${match[2]}`,
    wrong: 'I go often to work.',
    right: 'I often go to work.',
    note: 'Advérbio de frequência fica antes do verbo principal.'
  },
  {
    id: 'question-word-order',
    tag: 'question-word-order',
    find:
      /\b(what|where|when|why|how|who)\s+(you|he|she|it|they|we|this|that)\s+(are|is|do|does|did|can|could|will|would)\b/gi,
    to: (match) => `${match[1]} ${match[3]} ${match[2]}`,
    wrong: 'Where you are from?',
    right: 'Where are you from?',
    note: 'Pergunta em inglês inverte auxiliar e sujeito (o português só muda a entonação).'
  },
  {
    id: 'preposition-weekday',
    tag: 'prepositions',
    find: /\bin (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    to: (match) => `on ${match[1]}`,
    wrong: 'I work in Monday.',
    right: 'I work on Mondays.',
    note: 'Dias da semana usam on; "in" é para meses e anos.'
  },
  {
    id: 'preposition-morning',
    tag: 'prepositions',
    find: /\bat (?:the )?(morning|afternoon|evening)\b/gi,
    to: (match) => `in the ${match[1]}`,
    wrong: 'I study at the morning.',
    right: 'I study in the morning.',
    note: 'Partes do dia usam in the; at night é a exceção.'
  },
  {
    id: 'since-for',
    tag: 'since-for',
    find: /\bsince\s+(\d+|one|two|three|four|five|six|ten|fifteen|twenty|many|several)\s+(years?|months?|weeks?|days?|hours?)\b/gi,
    to: (match) => `for ${match[1]} ${match[2]}`,
    wrong: 'I live here since two years.',
    right: 'I have lived here for two years.',
    note: 'Duração é for + período; since marca o ponto de início.'
  },
  {
    id: 'make-question',
    tag: 'collocation',
    find: /\b(make|making|made|makes|do|does|doing)\s+(a|an)\s+(question|doubt)\b/gi,
    to: () => 'ask a question',
    wrong: 'I want to make a question.',
    right: 'I want to ask a question.',
    note: 'Collocations fixas: ask a question (não make/do a question).'
  },
  {
    id: 'have-doubt',
    tag: 'collocation',
    find: /\bhave\s+(a|an)\s+doubts?\b/gi,
    to: () => 'have a question',
    wrong: 'I have a doubt about this.',
    right: 'I have a question about this.',
    note: '“Dúvida” nesse sentido vira question; doubt é desconfiança.'
  },
  {
    id: 'make-photo',
    tag: 'collocation',
    find: /\bmake\s+(a|two|one)?\s*(photo|picture|trip|walk|dream)\b/gi,
    to: (match) => `take ${match[1] ? `${match[1]} ` : 'a '}${match[2]}`,
    wrong: 'Let’s make a photo.',
    right: 'Let’s take a photo.',
    note: 'Foto, passeio e viagem usam take, não make.'
  },
  {
    id: 'pronoun-gender',
    tag: 'pronoun-gender',
    find: /\bmy (girlfriend|wife|mother|sister|aunt|daughter|female colleague)\b[^.!?]{0,40}\bhis\b/gi,
    to: (match) => match[0].replace(/his$/i, 'her'),
    wrong: 'My girlfriend is a dev, his name is Ana.',
    right: 'My girlfriend is a dev, her name is Ana.',
    note: 'Gênero do pronome depende da pessoa, não do que soa natural em português.'
  },
  {
    id: 'presume-assume',
    tag: 'false-cognate',
    find: /\bi\s+presume\b/gi,
    wrong: 'I presume so.',
    right: 'I assume so.',
    note: 'Presumir (no sentido de supor) é normally assume; presume soa acusação.'
  },
  {
    id: 'pretend-intend',
    tag: 'false-cognate',
    find: /\b(?:i|we|they)\s+pretend\s+to\b/gi,
    wrong: 'I pretend to work abroad.',
    right: 'I intend to work abroad.',
    note: 'Pretender é intend; pretend é fingir.'
  },
  {
    id: 'actually-nowadays',
    tag: 'false-cognate',
    // Advisory: "actually" = na verdade. Quem usa no sentido de "atualmente"
    // geralmente quer currently / these days — a reescrita depende da intenção.
    find: /\bactually,?\s+(i|we|they|he|she)\s+(have|am|is|are|work|live)\b/gi,
    wrong: 'Actually, I work at a startup.',
    right: 'Currently, I work at a startup.',
    note: 'Falso cognato: actually = na verdade; atualmente = currently.'
  },
  {
    id: 'let-me-to',
    tag: 'verb-pattern',
    find: /\blet\s+me\s+to\b/gi,
    to: () => 'let me',
    wrong: 'Let me to explain.',
    right: 'Let me explain.',
    note: 'Depois de let + objeto, o verbo vem sem to.'
  },
  {
    id: 'want-that',
    tag: 'verb-pattern',
    find: /\bi want that\b/gi,
    to: () => 'I want',
    wrong: 'I want that you help me.',
    right: 'I want you to help me.',
    note: 'Want não usa "that": want + pessoa + to + verbo.'
  }
]

export interface InterferenceHit {
  ruleId: string
  tag: string
  /** Trecho exatamente como o aluno escreveu. */
  original: string
  /** Reescrita sugerida (forma canônica do banco quando a regra é advisory). */
  corrected: string
  note: string
  /** true quando a regra só anota: quem reescreve é o modelo. */
  advisory: boolean
}

export interface InterferenceEntry {
  tag: string
  wrong: string
  right: string
  note: string
}

/** Entradas do banco em forma serializável (para UI, prompts e eval). */
export function bankEntries(): InterferenceEntry[] {
  return INTERFERENCE_BANK.map((rule) => ({
    tag: rule.tag,
    wrong: rule.wrong,
    right: rule.right,
    note: rule.note
  }))
}

function globalize(rule: InterferenceRule): RegExp {
  const flags = rule.find.flags.includes('g') ? rule.find.flags : `${rule.find.flags}g`
  return new RegExp(rule.find.source, flags)
}

function replaceWith(rule: InterferenceRule, match: RegExpMatchArray): string {
  if (!rule.to) return rule.right
  const output =
    typeof rule.to === 'string' ? match[0].replace(globalize(rule), rule.to) : rule.to(match)
  return preserveCase(match[0], output)
}

/** Recast não pode transformer "People are" em "people are" no início da frase. */
function preserveCase(original: string, replacement: string): string {
  const first = original.charAt(0)
  if (!replacement || first === first.toLowerCase()) return replacement
  return replacement.charAt(0).toUpperCase() + replacement.slice(1)
}

function normalizeWords(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9']/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Encontra ocorrências de interferência PT-BR num texto em inglês.
 * Uma ocorrência por regra é suficiente para anotar o erro; `recast` conserta todas.
 */
export function detectInterference(text: string): InterferenceHit[] {
  const hits: InterferenceHit[] = []

  for (const rule of INTERFERENCE_BANK) {
    const match = globalize(rule).exec(text)
    if (!match || !match[0].trim()) continue

    const original = match[0].trim()
    const corrected = replaceWith(rule, match).trim() || original
    if (rule.to && normalizeWords(corrected) === normalizeWords(original)) continue

    hits.push({
      ruleId: rule.id,
      tag: rule.tag,
      original,
      corrected,
      note: rule.note,
      advisory: !rule.to
    })
  }

  return hits
}

/** Reescreve o texto aplicando todas as regras determinísticas do banco. */
export function recast(text: string): string {
  let output = text

  for (const rule of INTERFERENCE_BANK) {
    if (!rule.to) continue
    output = output.replace(globalize(rule), (...args: unknown[]) => {
      const match = args as unknown as RegExpMatchArray
      const next = replaceWith(rule, match)
      return next || (args[0] as string)
    })
  }

  return output.replace(/\s+/g, ' ').trim()
}

/** Pares erradо→certo do banco para um conjunto de tags (fixtures de prompt). */
export function bankExamplesFor(tags: string[], limit = 3): InterferenceEntry[] {
  const wanted = new Set(tags.map((tag) => tag.toLowerCase()))
  const picked: InterferenceEntry[] = []

  for (const rule of INTERFERENCE_BANK) {
    if (wanted.size > 0 && !wanted.has(rule.tag.toLowerCase())) continue
    picked.push({ tag: rule.tag, wrong: rule.wrong, right: rule.right, note: rule.note })
    if (picked.length >= limit) break
  }

  if (picked.length < limit && wanted.size > 0) {
    for (const rule of INTERFERENCE_BANK) {
      if (picked.some((entry) => entry.tag === rule.tag)) continue
      picked.push({ tag: rule.tag, wrong: rule.wrong, right: rule.right, note: rule.note })
      if (picked.length >= limit) break
    }
  }

  return picked
}

/** Tags mais comuns do banco, usadas para ancorar conteúdo quando o caderno está vazio. */
export function bankTags(limit = 4): string[] {
  const tags: string[] = []
  for (const rule of INTERFERENCE_BANK) {
    if (!tags.includes(rule.tag)) tags.push(rule.tag)
    if (tags.length >= limit) break
  }
  return tags
}
