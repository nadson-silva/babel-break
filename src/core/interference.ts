/**
 * Bancos de interferência — o "por quê" de cada par nativo→alvo.
 *
 * Erros que o falante comete *por transferência* do nativo, não por falta de
 * vocabulário. Cada banco tem dois usos:
 *
 * 1. Correção determinística (funciona offline, sem IA): `detectInterference`
 *    encontra o padrão e `recast` devolve a frase corrigida.
 * 2. Âncora de qualidade: os pares errado→certo viram fixtures para prompts
 *    (`exercise_gen`, `tutor_turn`) e para o harness de avaliação, para que as
 *    correções mirem erros reais e não genéricos.
 *
 * Desde o M4 o banco é uma *implementação* escolhida por par
 * (`interferenceRulesFor`); a default das funções é PT-BR→inglês (§8 do plano),
 * e pares sem banco são corrigidos 100% pela IA.
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
  /**
   * M6 (B4): filtro de falso positivo. Recebe o texto ANTES da ocorrência e
   * decide se ela conta. Padrões que só são erro em pergunta direta (inversão
   * de ordem) precisam desta âncora — embutida, a mesma ordem é gramatical.
   */
  guard?: (before: string) => boolean
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

const SENTENCE_EDGE = /(^|[.!?;:])\s*["'“”]?\s*$/

/** M6 (B4): pergunta direta = wh-clause no começo do texto/frase. Em posição
 * embaralhadamente embutida ("I know where he is"), a ordem declarativa é
 * CORRETA em inglês, e a regra não pode reescrevê-la. */
function directQuestionOnly(before: string): boolean {
  return SENTENCE_EDGE.test(before)
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
    // M6 (B4): só anota/reescreve em pergunta DIRETA. "I know where he is" é
    // pergunta embutida e gramatical — a regra antiga inseria erro nela.
    guard: directQuestionOnly,
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

/**
 * Banco de interferência PT-BR → espanhol.
 *
 * Propositalmente menor que o de inglês: é o fixture que prova a abstração do
 * M4 — a mesma máquina (detect/recast/âncora de prompt) funcionando para outro
 * par, escrita à mão com erros reais de quem fala português. Para pares sem
 * banco próprio a correção é 100% por IA (ver `core/correction.ts`).
 */
export const PT_ES_INTERFERENCE_BANK: InterferenceRule[] = [
  {
    id: 'em-para-en',
    tag: 'prepositions',
    find: /\bem\b/gi,
    to: () => 'en',
    wrong: 'Estoy em casa con mi familia.',
    right: 'Estoy en casa con mi familia.',
    note: 'O "em" do português não existe em espanhol: é "en".'
  },
  {
    id: 'eu-para-yo',
    tag: 'subject-pronoun',
    find: /\beu\s+(soy|hablo|trabajo|vivo|estudio|quiero|tengo)\b/gi,
    to: (match) => `yo ${match[1]}`,
    wrong: 'Eu trabajo con equipos remotos.',
    right: 'Yo trabajo con equipos remotos.',
    note: 'Em espanhol o pronome de 1ª pessoa é "yo", não o "eu" português.'
  },
  {
    id: 'muito-para-mucho',
    tag: 'vocabulary',
    find: /\bmuit([oa]s?)\b/gi,
    to: (match) => `much${match[1]}`,
    wrong: 'Tengo muito trabajo esta semana.',
    right: 'Tengo mucho trabajo esta semana.',
    note: '"Muito" é português; em espanhol é mucho/mucha/muchos/muchas.'
  },
  {
    id: 'nao-para-no',
    tag: 'vocabulary',
    find: /\bnão\b/gi,
    to: () => 'no',
    wrong: 'Não entiendo la pregunta.',
    right: 'No entiendo la pregunta.',
    note: 'Negativa em espanhol: "no" (sem o "ã" português).'
  },
  {
    id: 'tambem-para-tambien',
    tag: 'accents',
    find: /\btambém\b/gi,
    to: () => 'también',
    wrong: 'Yo também quiero practicar.',
    right: 'Yo también quiero practicar.',
    note: 'Acento agudo, não circunflexo: "también".'
  },
  {
    id: 'ano-para-anio',
    tag: 'false-cognate',
    find: /\b(?:el|este)\s+ano\b/gi,
    to: (match) => `${match[1]} año`,
    wrong: 'El ano pasado viajé mucho.',
    right: 'El año pasado viajé mucho.',
    note: '"Ano" em espanhol é outra coisa; "ano/anos" (tempo) é año/años, com ñ.'
  },
  {
    id: 'ter-que-para-tener-que',
    tag: 'verb-pattern',
    find: /\bter\s+que\b/gi,
    to: () => 'tener que',
    wrong: 'Yo ter que terminar el informe.',
    right: 'Tengo que terminar el informe.',
    note: 'Expressar obrigação em espanhol: "tener que" + infinitivo.'
  },
  {
    id: 'tem-para-hay',
    tag: 'existential-hay',
    find: /\btem\s+(un|una|unos|unas|mucho|muchos|mucha|muchas)\b/gi,
    to: (match) => `hay ${match[1]}`,
    wrong: 'Tem muchos problemas de rendimiento.',
    right: 'Hay muchos problemas de rendimiento.',
    note: 'O "tem" existencial do português ("há") traduz-se por "hay".'
  },
  {
    id: 'sonho-em-sonar-con',
    tag: 'verb-preposition',
    find: /\b(?:suenho|sonho|sueño)\s+em\b/gi,
    to: () => 'sueño con',
    wrong: 'Yo sonho em trabajar abroad.',
    right: 'Sueño con trabajar en el extranjero.',
    note: 'Soñar exige "con" em espanhol (do português "sonhar em").'
  },
  {
    id: 'esperar-por',
    tag: 'verb-preposition',
    find: /\besper(o|amos|an)\s+por\b/gi,
    to: (match) => `esper${match[1]} a`,
    wrong: 'Espero por tu respuesta.',
    right: 'Espero a tu respuesta.',
    note: 'Esperar (aguardar) rege "a" em espanhol, não "por".'
  },
  {
    id: 'embarazada',
    tag: 'false-cognate',
    // Advisory: a reescrita depende da intenção (avergonzada vs. emocionada).
    find: /\bestoy?\s+embarazada\b/gi,
    wrong: 'Estoy embarazada de hablar en público.',
    right: 'Estoy avergonzada de hablar en público.',
    note: 'Falso cognato clássico: embarazada = grávida; "embaraçada" é avergonzada.'
  }
]

/**
 * M4: o banco é uma **implementação de correção** por par de idiomas, não um
 * singleton. Pares sem banco registrado caem na correção por IA — a interface
 * `CorrectionEngine` em `core/correction.ts` decide o que usar.
 */
export interface InterferenceBankDef {
  id: string
  nativeLang: string
  targetLang: string
  rules: InterferenceRule[]
}

export const INTERFERENCE_BANKS: InterferenceBankDef[] = [
  { id: 'pt-BR:en', nativeLang: 'pt-BR', targetLang: 'en', rules: INTERFERENCE_BANK },
  { id: 'pt-BR:es', nativeLang: 'pt-BR', targetLang: 'es', rules: PT_ES_INTERFERENCE_BANK }
]

function baseLang(code: string): string {
  return code.toLowerCase().split('-')[0]
}

/** Regras do banco manual para o par nativo→alvo; [] = sem banco (só IA). */
export function interferenceRulesFor(
  targetLang: string | null | undefined,
  nativeLang: string | null | undefined
): InterferenceRule[] {
  const target = baseLang(targetLang ?? '')
  const native = baseLang(nativeLang ?? '')
  if (!target || !native) return []

  const exact = INTERFERENCE_BANKS.find(
    (bank) => bank.targetLang.toLowerCase() === targetLang?.toLowerCase() && bank.nativeLang.toLowerCase() === native
  )
  if (exact) return exact.rules

  const loose = INTERFERENCE_BANKS.find(
    (bank) => baseLang(bank.targetLang) === target && baseLang(bank.nativeLang) === native
  )
  return loose?.rules ?? []
}

/** O par tem banco manual? (UI mostra a origem da correção por par.) */
export function hasInterferenceBank(
  targetLang: string | null | undefined,
  nativeLang: string | null | undefined
): boolean {
  return interferenceRulesFor(targetLang, nativeLang).length > 0
}

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
export function bankEntries(rules: InterferenceRule[] = INTERFERENCE_BANK): InterferenceEntry[] {
  return rules.map((rule) => ({
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
  // Unicode-safe (M4): a comparação "a correção mudou alguma coisa?" precisa
  // enxergar ñ/á/한/日 como caracteres — senão "ano" == "año" e a regra some.
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Encontra ocorrências de interferência no texto do aluno (padrão: banco
 * PT-BR→inglês; passe as regras do par via `interferenceRulesFor`).
 * Uma ocorrência por regra é suficiente para anotar o erro; `recast` conserta todas.
 */
export function detectInterference(text: string, rules: InterferenceRule[] = INTERFERENCE_BANK): InterferenceHit[] {
  const hits: InterferenceHit[] = []

  for (const rule of rules) {
    const re = globalize(rule)
    let match: RegExpExecArray | null = null
    while ((match = re.exec(text)) !== null) {
      // M6 (B4): ocorrências em contexto protegido pela guarda não contam;
      // segue para a próxima até achar uma que passa (ou esgota a regex).
      if (rule.guard && !rule.guard(text.slice(0, match.index))) continue
      break
    }
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
export function recast(text: string, rules: InterferenceRule[] = INTERFERENCE_BANK): string {
  let output = text

  for (const rule of rules) {
    if (!rule.to) continue
    output = output.replace(globalize(rule), (...args: unknown[]) => {
      const match = args as unknown as RegExpMatchArray
      // M6 (B4): a mesma guarda da detecção — recast não pode inserir erro em
      // pergunta embutida correta.
      if (rule.guard) {
        const subject = String(args[args.length - 1] ?? '')
        const offset = Number(args[args.length - 2] ?? 0)
        if (!rule.guard(subject.slice(0, offset))) return String(args[0] ?? '')
      }
      const next = replaceWith(rule, match)
      return next || (args[0] as string)
    })
  }

  return output.replace(/\s+/g, ' ').trim()
}

/** Pares erradо→certo do banco para um conjunto de tags (fixtures de prompt). */
export function bankExamplesFor(
  tags: string[],
  limit = 3,
  rules: InterferenceRule[] = INTERFERENCE_BANK
): InterferenceEntry[] {
  const wanted = new Set(tags.map((tag) => tag.toLowerCase()))
  const picked: InterferenceEntry[] = []

  for (const rule of rules) {
    if (wanted.size > 0 && !wanted.has(rule.tag.toLowerCase())) continue
    picked.push({ tag: rule.tag, wrong: rule.wrong, right: rule.right, note: rule.note })
    if (picked.length >= limit) break
  }

  if (picked.length < limit && wanted.size > 0) {
    for (const rule of rules) {
      if (picked.some((entry) => entry.tag === rule.tag)) continue
      picked.push({ tag: rule.tag, wrong: rule.wrong, right: rule.right, note: rule.note })
      if (picked.length >= limit) break
    }
  }

  return picked
}

/** Tags mais comuns do banco, usadas para ancorar conteúdo quando o caderno está vazio. */
export function bankTags(limit = 4, rules: InterferenceRule[] = INTERFERENCE_BANK): string[] {
  const tags: string[] = []
  for (const rule of rules) {
    if (!tags.includes(rule.tag)) tags.push(rule.tag)
    if (tags.length >= limit) break
  }
  return tags
}
