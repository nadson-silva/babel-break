import type { CefrLevel, CorrectionStyle } from '../shared/types'
import type { LessonContentOutput } from './schemas'

export interface ErrorHint {
  tag: string
  original: string
  corrected: string
  note?: string | null
  occurrences?: number
  /** 'bank' = âncora do banco PT-BR; 'student' = caderno real do aluno. */
  source?: 'student' | 'bank'
}

const BASE_SYSTEM = [
  'Você é um professor de inglês experiente para falantes de português do Brasil.',
  'O aluno estuda no próprio ritmo, sem pressão.',
  'Todo conteúdo em inglês deve ser adequado ao nível CEFR informado.',
  'Explicações, instruções e feedback devem ser em português do Brasil, claros e curtos.',
  'Responda SEMPRE com um único objeto JSON válido, sem markdown, sem comentários e sem texto fora do JSON.'
].join(' ')

function focusSection(errors: ErrorHint[], limit = 5): string {
  const lines = errors
    .filter((error) => error.source !== 'bank')
    .slice(0, limit)
    .map((error) => {
      const count = error.occurrences && error.occurrences > 1 ? ` (${error.occurrences}x)` : ''
      const note = error.note ? ` — ${error.note}` : ''
      return `- ${error.tag}${count}: "${error.original}" → "${error.corrected}"${note}`
    })

  if (lines.length > 0) return lines.join('\n')

  const bank = errors.slice(0, limit).map((error) => `- ${error.tag}: "${error.original}" → "${error.corrected}"`)
  return bank.length > 0
    ? [...bank, '(o caderno do aluno ainda está vazio: use o banco de interferência PT-BR)'].join('\n')
    : '- nenhum erro registrado ainda'
}

export function placementPrompt(goal: string): { system: string; user: string } {
  return {
    system: BASE_SYSTEM,
    user: [
      'Crie um teste de nivelamento de inglês com EXATAMENTE 10 questões de múltipla escolha.',
      `Objetivo do aluno: ${goal || 'conversação geral'}.`,
      'Cubra A1, A2, B1 e B2, em ordem crescente de dificuldade (comece fácil, termine difícil).',
      'Cada questão deve ter 4 opções e exatamente uma correta.',
      'Use frases curtas e situações do dia a dia, trabalho e viagem.',
      'answerIndex é o índice (0-3) da opção correta. explanation explica a resposta em português.',
      'Não use a mesma estrutura gramatical em todas as questões. Não repita opções.'
    ].join('\n')
  }
}

export function curriculumPrompt(input: {
  goal: string
  level: CefrLevel
}): { system: string; user: string } {
  return {
    system: BASE_SYSTEM,
    user: [
      'Monte o começo de um currículo de inglês para um aluno brasileiro.',
      `Nível atual: ${input.level}. Objetivo: ${input.goal || 'conversação geral'}.`,
      'Gere EXATAMENTE 2 unidades, cada uma com EXATAMENTE 3 lições.',
      'A primeira unidade deve consolidar o nível atual; a segunda deve avançar um degrau, sem pular fundamentos.',
      'Cada lição precisa de um título curto e um objetivo de aprendizagem concreto (1 frase).',
      'A progressão gramatical manda na ordem; o objetivo do aluno influencia vocabulário e situações, não a dificuldade.',
      'description da unidade: 1 frase explicando o foco.'
    ].join('\n')
  }
}

export function lessonContentPrompt(input: {
  title: string
  objective: string
  unitTitle: string
  level: CefrLevel
  goal: string
  errors: ErrorHint[]
  /** Contexto de trilha de foco: domínio de vocabulário, não nova gramática. */
  track?: { title: string; vocabulary: string[] } | null
}): { system: string; user: string } {
  return {
    system: BASE_SYSTEM,
    user: [
      `Prepare o conteúdo da lição "${input.title}" (${input.level}) da ${input.track ? `trilha "${input.track.title}"` : `unidade "${input.unitTitle}"`}.`,
      `Objetivo da lição: ${input.objective}. Objetivo do aluno: ${input.goal || 'conversação geral'}.`,
      'A explicação deve ter 2 a 4 parágrafos curtos em português, com exemplos em inglês no meio.',
      'examples: 3 a 5 pares inglês/português; inglês natural e no nível do aluno.',
      'grammarPoints: 1 a 3 pontos, cada um com explicação em português e 1 a 3 exemplos em inglês.',
      'vocabulary: 5 a 8 itens com termo em inglês, tradução em português e uma frase de exemplo em inglês.',
      'pitfalls: 1 a 3 armadilhas de quem fala português (tag, wrong em inglês errado, right correto, note em português).',
      'Se algum erro do aluno couber nesta lição, inclua-o em pitfalls e mencione-o na explicação.',
      'Erros do aluno (prioridade, mais recorrentes primeiro):',
      focusSection(input.errors),
      ...(input.track
        ? [
            `Domínio da trilha: ${input.track.title}.`,
            `Palavras-alvo que DEVEM aparecer no vocabulary e nos exemplos: ${input.track.vocabulary.slice(0, 8).join(', ')}.`,
            `Restrição de nível: ${input.level} — use gramática de ${input.level}, nenhuma estrutura além dela, mesmo que o domínio permita.`,
            'Todo o conteúdo (explicação, exemplos, vocabulário) se passa em situações reais desse domínio.'
          ]
        : []),
      'Mantenha o inglês simples: no máximo 2 orações por frase de exemplo.'
    ].join('\n')
  }
}

export function exercisePrompt(input: {
  content: LessonContentOutput
  level: CefrLevel
  goal: string
  errors: ErrorHint[]
  track?: { title: string; vocabulary: string[] } | null
}): { system: string; user: string } {
  const vocabulary = input.content.vocabulary
    .slice(0, 6)
    .map((item) => `${item.term} (${item.translation})`)
    .join(', ')

  const focusTags = input.errors
    .filter((error) => error.source !== 'bank')
    .slice(0, 4)
    .map((error) => error.tag)
    .join(', ')

  return {
    system: BASE_SYSTEM,
    user: [
      `Crie EXATAMENTE 6 exercícios para a lição "${input.content.title}" (${input.level}).`,
      `Objetivo: ${input.content.objective}. Objetivo do aluno: ${input.goal || 'conversação geral'}.`,
      `Vocabulário-alvo: ${vocabulary}.`,
      'Inclua, nesta ordem, um de cada tipo: multiple_choice, cloze, order, translate, free_production e mais um multiple_choice.',
      'Regras por tipo:',
      '- multiple_choice: 4 options; answer deve ser EXATAMENTE o texto da opção correta.',
      '- cloze: prompt é uma frase em inglês com "___" no lugar da palavra; answer é a palavra que falta.',
      '- order: tokens são as palavras da frase correta EMBARALHADAS; prompt pede para montar a frase; answer é a frase correta completa.',
      '- translate: prompt é uma frase em português para traduzir ao inglês; answer é a tradução correta.',
      '- free_production: prompt é uma situação curta; answer é uma resposta-modelo curta.',
      'Para tipos sem options ou tokens, use array vazio []. alternatives pode trazer variações aceitáveis (ou []).',
      'instructions em português. explanation em português, curta.',
      'targetTags: as tags de erro que o exercício treina (use [] se nenhum).',
      'Pelo menos 2 exercícios devem mirar os erros abaixo, com o targetTags correspondente.',
      `Tags disponíveis: ${focusTags || 'nenhuma ainda'}.`,
      'Erros do aluno (mais recorrentes primeiro):',
      focusSection(input.errors, 4),
      ...(input.track
        ? [
            `Todos os exercícios passam por dentro do domínio "${input.track.title}": situações, frases e vocabulário desse contexto.`,
            `Pelo menos 3 exercícios devem usar as palavras-alvo: ${input.track.vocabulary.slice(0, 8).join(', ')}.`,
            `A gramática cobrada fica em ${input.level} — nada acima disso.`
          ]
        : []),
      'Não repita a mesma frase em exercícios diferentes.'
    ].join('\n')
  }
}

export function gradePrompt(input: {
  type: string
  prompt: string
  answer: string
  alternatives: string[]
  explanation: string
  response: string
  level: CefrLevel
}): { system: string; user: string } {
  const accepted = [input.answer, ...input.alternatives].filter(Boolean).join(' | ')

  return {
    system: BASE_SYSTEM,
    user: [
      'Avalie a resposta de um aluno brasileiro.',
      `Nível: ${input.level}. Tipo de exercício: ${input.type}.`,
      `Enunciado: ${input.prompt}`,
      `Resposta esperada: ${accepted || input.answer}`,
      `Explicação de referência: ${input.explanation}`,
      `Resposta do aluno: ${input.response}`,
      'Aceite variações naturais e pequenos deslizes que não mudem o sentido (ex.: contrações, artigo).',
      'Seja rigoroso com o ponto gramatical-alvo do exercício.',
      'correct: true/false. score entre 0 e 1. feedback em português, 1 a 2 frases, gentil e específico.',
      'corrected: a versão corrigida da resposta do aluno (ou a própria resposta se estiver correta).',
      'errorTags: 1 a 3 tags curtas em inglês (ex.: past-tense, articles, word-order, vocabulary). Use [] se estiver correto.'
    ].join('\n')
  }
}

// --- Tutor (M2) ------------------------------------------------------------

export interface TutorContext {
  level: CefrLevel
  goal: string
  style: CorrectionStyle
  errors: ErrorHint[]
  vocabulary: { term: string; translation: string }[]
  summary: string | null
  lesson: { title: string; objective: string; grammar: string[] } | null
  topic: string | null
  /** Modo cenário: o tutor entra em personagem e persegue os critérios da tarefa. */
  scenario?: ScenarioContext | null
}

export interface ScenarioContext {
  persona: string
  setting: string
  successCriteria: string[]
}

/**
 * System prompt do tutor de conversação. É aqui que o modelo do aluno entra:
 * nível, objetivo, resumo da conversa e os erros recorrentes do caderno.
 */
export function tutorSystem(context: TutorContext): string {
  const errorLines = focusSection(context.errors, 6)
  const vocabulary =
    context.vocabulary.length > 0
      ? context.vocabulary
          .slice(0, 8)
          .map((item) => `${item.term} (${item.translation})`)
          .join(', ')
      : 'nenhum ainda'

  return [
    'Você é um tutor de inglês conversando com um brasileiro adulto.',
    `Nível atual do aluno: ${context.level}. Objetivo: ${context.goal || 'conversação geral'}.`,
    'Escreva em inglês simples e adequado ao nível, 2 a 4 frases por resposta, sempre terminando com uma pergunta ou convite para continuar.',
    'Explique em português do Brasil apenas quando for necessário para corrigir.',
    'Nunca use markdown, listas com marcadores ou títulos.',
    '',
    `Política de correção: ${correctionStyleLabel(context.style)}`,
    'Correções de língua são calculadas separadamente: no texto, você só faz o recast (refazer a frase do aluno corretamente dentro da resposta) e, se a política pedir, uma explicação curta em português.',
    'Não repita a lista de erros nem corrija mais de 2 pontos por resposta.',
    '',
    'Erros recorrentes do aluno (priorize o recast destes):',
    errorLines,
    `Vocabulário recente que ele está aprendendo (use quando couber, sem forçar): ${vocabulary}.`,
    context.lesson
      ? `A conversa vem da lição "${context.lesson.title}" (${context.lesson.objective}). Structures da lição para reaparecerem: ${context.lesson.grammar.join(', ') || '—'}.`
      : '',
    context.topic ? `Tema pedido pelo aluno: ${context.topic}.` : '',
    scenarioSection(context.scenario ?? null),
    context.summary ? `Resumo da conversa até agora: ${context.summary}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Bloco de personagem do modo cenário. A rubrica de conteúdo é separada da de
 * língua: aqui o tutor só cuida da TAREFA, e a correção continua sendo calculada
 * em outra passada.
 */
function scenarioSection(scenario: ScenarioContext | null): string {
  if (!scenario) return ''

  return [
    'MODO CENÁRIO (roleplay): você está em personagem e não sai dele.',
    `Personagem: ${scenario.persona}.`,
    `Contexto: ${scenario.setting}.`,
    'Fale sempre em inglês, dentro do personagem, e conduza a conversa até a tarefa ser cumprida.',
    'No máximo uma pergunta por vez; se o aluno travar, dê uma opção de resposta dentro do personagem.',
    'Critérios da tarefa (objetivo oculto — não liste nem cheque em voz alta):',
    scenario.successCriteria.map((criterion) => `- ${criterion}`).join('\n')
  ].join('\n')
}

export function correctionStyleLabel(style: CorrectionStyle): string {
  if (style === 'recast') return 'recast suave (reformula a frase, sem explicação)'
  if (style === 'explicit') return 'correção explícita (aponte o erro, a forma certa e 1 frase de explicação em português)'
  return 'ambos (recast + 1 linha de explicação em português)'
}

/** Primeira chamada da conversa: o tutor abre o papo. */
export function tutorOpenerMessage(context: TutorContext): string {
  if (context.scenario) {
    return 'Você é o personagem do cenário. Abra o roleplay com a primeira fala, em inglês, uma frase.'
  }
  if (context.topic) return `Comece a conversa sobre: ${context.topic}.`
  if (context.lesson) return `Comece uma conversa curta ligada à lição "${context.lesson.title}".`
  return 'Comece a conversa puxando um assunto ligado ao objetivo do aluno.'
}

/** Passada de correção do texto livre do aluno (antes da resposta do tutor). */
export function correctionPrompt(input: {
  text: string
  level: CefrLevel
  style: CorrectionStyle
  errors: ErrorHint[]
}): { system: string; user: string } {
  return {
    system: BASE_SYSTEM,
    user: [
      'Corrija a mensagem de inglês escrita por um aluno brasileiro, como se fosse parte de uma conversa.',
      `Nível: ${input.level}.`,
      `Erros recorrentes dele (use as mesmas tags quando se aplicar):`,
      focusSection(input.errors, 6),
      `Mensagem do aluno: ${input.text}`,
      'corrections: apenas erros de LÍNGUA (gramática, palavra, preposição, concordância, ordem). Ignore estilo e preferências.',
      'original: o trecho exatamente como o aluno escreveu. corrected: o mesmo trecho corrigido, substituível no texto.',
      'tag: 1 tag curta em inglês, consistente (ex.: past-simple, articles, verb-preposition, question-word-order).',
      'note: explicação de 1 frase em português do Brasil (ou string vazia).',
      'recast: a mensagem inteira reescrita em inglês natural, mantendo o sentido e o nível do aluno.',
      'hasErrors: false quando a mensagem está correta; nesse caso corrections = [] e recast = mensagem original.'
    ].join('\n')
  }
}

/** Compacta o histórico antigo em um resumo rolante. */
export function summaryPrompt(input: { current: string | null; transcript: string }): {
  system: string
  user: string
} {
  return {
    system: BASE_SYSTEM,
    user: [
      'Resuma a parte antiga de uma conversa entre tutor e aluno de inglês.',
      input.current ? `Resumo anterior: ${input.current}` : 'Não há resumo anterior.',
      `Trecho a incorporar:\n${input.transcript}`,
      'summary: 3 a 5 frases em português dizendo o que foi conversado, quais erros apareceram e o que o aluno já conseguia dizer.'
    ].join('\n')
  }
}

// --- Trilhas de foco e cenário (M3) --------------------------------------------

/** Esboço da trilha de foco: mini-currículo nivelado, orientado a cenários. */
export function trackPlanPrompt(input: {
  objective: string
  level: CefrLevel
  goal: string
}): { system: string; user: string } {
  return {
    system: BASE_SYSTEM,
    user: [
      `Monte o esboço de uma trilha de foco para um aluno de inglês no nível ${input.level}.`,
      `Tópico pedido pelo aluno: ${input.objective}.`,
      `Objetivo geral do aluno: ${input.goal || 'conversação geral'}.`,
      'A trilha é um mini-currículo: 5 a 8 lições em ordem de dificuldade, todas dentro do domínio pedido.',
      `A progressão gramatical NÃO muda por causa da trilha: mantenha a complexidade no nível ${input.level}. O que muda é o domínio do vocabulário e as situações.`,
      'Campos:',
      '- title: nome curto da trilha (em português, ex.: "Entrevista para dev").',
      '- goalTag: etiqueta curta em inglês, kebab-case (ex.: "dev-interview", "travel-basic").',
      '- lessons: 5 a 8 lições, cada uma com title (curto, em português), objective (1 frase, em português) e',
      '  focusVocabulary (5 a 10 termos em inglês do domínio, sem tradução).',
      'A última lição da trilha deve ser um cenário de prática (roleplay) do objetivo final dela.',
      'Não repita termos entre as lições; a primeira deve ser a mais acessível do domínio.'
    ].join('\n')
  }
}

/** Persona, ambientação e critérios de sucesso de um roleplay. */
export function scenarioGenPrompt(input: {
  lessonTitle: string
  objective: string
  level: CefrLevel
  goal: string
}): { system: string; user: string } {
  return {
    system: BASE_SYSTEM,
    user: [
      `Crie um cenário de roleplay para o aluno praticar a lição "${input.lessonTitle}" (${input.level}).`,
      `Objetivo da lição: ${input.objective}. Objetivo geral do aluno: ${input.goal || 'conversação geral'}.`,
      'Campos:',
      '- persona: quem o tutor vai interpretar, em português (ex.: "entrevistador técnico de uma startup, objetivo e simpático").',
      '- setting: onde e quando a conversa acontece, em português, 1 frase.',
      '- successCriteria: 3 a 5 coisas concretas que o aluno precisa conseguir dizer/fazer para cumprir a tarefa, em português, frases curtas.',
      `- openingLine: a primeira fala do personagem, em inglês, no nível ${input.level}, 1 a 2 frases.`,
      'O personagem fala em inglês durante todo o roleplay. Os critérios avaliam a TAREFA (conteúdo), não a gramática.'
    ].join('\n')
  }
}

/** Feedback estruturado pós-roleplay: rubrica de conteúdo separada da de língua. */
export function scenarioFeedbackPrompt(input: {
  persona: string
  setting: string
  criteria: string[]
  transcript: string
  level: CefrLevel
  errors: ErrorHint[]
}): { system: string; user: string } {
  return {
    system: BASE_SYSTEM,
    user: [
      'Avalie o desempenho de um aluno brasileiro em um roleplay de inglês.',
      `Nível do aluno: ${input.level}.`,
      `Personagem: ${input.persona}. Contexto: ${input.setting}.`,
      'Critérios de sucesso da tarefa (avalie um a um):',
      input.criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n'),
      'Transcrição da conversa:',
      input.transcript,
      'Campos:',
      '- contentScore: fração dos critérios de TAREFA cumpridos (0 a 1). Ignore gramática aqui.',
      '- criteriaMet: um booleano por critério, na mesma ordem da lista acima (true = o aluno cumpriu).',
      '- languageScore: quão correta e adequada ao nível foi a língua (0 a 1).',
      '- feedback: 2 a 4 frases em português. Diga o que cumpriu, o que faltou e o ponto a melhorar.',
      '- bestPhrases: até 3 falas do aluno → versão em inglês mais natural/precisa, com reason em português.',
      '- followUpDrill: 1 instrução curta em português para um exercício de follow-up sobre o ponto mais fraco.',
      'Se a transcrição tiver poucos turnos do aluno, seja conservador nos scores.',
      'Erros recorrentes do aluno (considere no languageScore):',
      focusSection(input.errors, 5)
    ].join('\n')
  }
}

