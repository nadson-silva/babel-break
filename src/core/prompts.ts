/**
 * Camada de prompts (M4: parametrizada por idioma).
 *
 * A *linguagem de instrução* dos prompts é PT-BR e fica versionada aqui — é a
 * âncora de qualidade, não texto de UI. O que muda por perfil são os **slots
 * de idioma**: `locale.target` (o idioma ensinado) e `locale.native` (o idioma
 * das explicações), vindos de `core/languages.ts`. Nada de hardcode
 * "inglês/português" fora do `DEFAULT_LOCALE`.
 *
 * Tags de erro continuam kebab-case em inglês por contrato interno
 * (normalização, banco de interferência e caderno compartilham o alfabeto).
 */
import type { CefrLevel, CorrectionStyle, SpeechRate } from '../shared/types'
import { languageMeta, type PromptLocale } from './languages'
import type { LessonContentOutput } from './schemas'

export type { PromptLocale }

/** pt-BR aprendendo inglês — o comportamento histórico do app. */
export function promptLocale(targetLang: string | null | undefined, nativeLang: string | null | undefined): PromptLocale {
  const target = languageMeta(targetLang ?? 'en')
  const native = languageMeta(nativeLang ?? 'pt-BR')
  return { target, native, targetName: target.promptName, nativeName: native.promptName }
}

export const DEFAULT_LOCALE = promptLocale('en', 'pt-BR')

/**
 * M6 (D5): delimitador de texto livre. Qualquer texto vindo do aluno ou do
 * modelo que entra num prompt de contrato JSON vai entre `"""…"""` — o modelo
 * para de confundir conteúdo com instrução (injection em output estruturado,
 * e o caso banal de objetivo com aspas/quebras de linha).
 */
export function quoted(value: string): string {
  return `"""${value.replaceAll('"""', '""" ')}"""`
}

/** Restrições de escrita/registro do idioma-alvo que vão no system prompt. */
function localeNotes(locale: PromptLocale): string {
  const notes: string[] = []
  if (locale.target.scriptDirection === 'rtl') {
    notes.push(`O ${locale.targetName} é escrito da direita para a esquerda; mantenha as frases curtas.`)
  }
  if (locale.target.tokenization === 'cjk') {
    notes.push(`O ${locale.targetName} não separa palavras por espaço; use vocabulário em unidades naturais curtas.`)
  }
  if (locale.target.promptNotes) notes.push(locale.target.promptNotes)
  return notes.length > 0 ? `Restrições do idioma-alvo: ${notes.join(' ')} ` : ''
}

export interface ErrorHint {
  tag: string
  original: string
  corrected: string
  note?: string | null
  occurrences?: number
  /** 'bank' = âncora do banco de interferência paritário; 'student' = caderno real do aluno. */
  source?: 'student' | 'bank'
}

function baseSystem(locale: PromptLocale): string {
  return [
    `Você é um professor de ${locale.targetName} experiente para falantes de ${locale.nativeName}.`,
    'O aluno estuda no próprio ritmo, sem pressão.',
    `Todo conteúdo em ${locale.targetName} deve ser adequado ao nível CEFR informado.`,
    `Explicações, instruções e feedback devem ser em ${locale.nativeName}, claros e curtos.`,
    localeNotes(locale),
    'Responda SEMPRE com um único objeto JSON válido, sem markdown, sem comentários e sem texto fora do JSON.'
  ]
    .filter(Boolean)
    .join(' ')
}

function focusSection(errors: ErrorHint[], limit = 5, bankLabel = 'banco de interferência'): string {
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
    ? [...bank, `(o caderno do aluno ainda está vazio: use o ${bankLabel})`].join('\n')
    : '- nenhum erro registrado ainda'
}

export function placementPrompt(goal: string, locale: PromptLocale): { system: string; user: string } {
  return {
    system: baseSystem(locale),
    user: [
      `Crie um teste de nivelamento de ${locale.targetName} com EXATAMENTE 10 questões de múltipla escolha.`,
      `Objetivo do aluno: ${goal.trim() ? quoted(goal) : 'conversação geral'}.`,
      'Cubra A1, A2, B1 e B2, em ordem crescente de dificuldade (comece fácil, termine difícil).',
      'Cada questão deve ter 4 opções e exatamente uma correta.',
      'Use frases curtas e situações do dia a dia, trabalho e viagem, no idioma-alvo.',
      `Enunciado e opções em ${locale.targetName}; answerIndex é o índice (0-3) da opção correta; explanation explica a resposta em ${locale.nativeName}.`,
      'Não use a mesma estrutura gramatical em todas as questões. Não repita opções.'
    ].join('\n')
  }
}

export function curriculumPrompt(input: {
  goal: string
  level: CefrLevel
  locale: PromptLocale
}): { system: string; user: string } {
  const { locale } = input
  return {
    system: baseSystem(locale),
    user: [
      `Monte o começo de um currículo de ${locale.targetName} para um aluno falante de ${locale.nativeName}.`,
      `Nível atual: ${input.level}. Objetivo: ${input.goal || 'conversação geral'}.`,
      'Gere EXATAMENTE 2 unidades, cada uma com EXATAMENTE 3 lições.',
      'A primeira unidade deve consolidar o nível atual; a segunda deve avançar um degrau, sem pular fundamentos.',
      `Cada lição precisa de um título curto e um objetivo de aprendizagem concreto (1 frase), ambos em ${locale.nativeName}.`,
      'A progressão gramatical do idioma-alvo manda na ordem; o objetivo do aluno influencia vocabulário e situações, não a dificuldade.',
      `description da unidade: 1 frase em ${locale.nativeName} explicando o foco.`
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
  locale: PromptLocale
  /** Contexto de trilha de foco: domínio de vocabulário, não nova gramática. */
  track?: { title: string; vocabulary: string[] } | null
}): { system: string; user: string } {
  const { locale } = input
  return {
    system: baseSystem(locale),
    user: [
      `Prepare o conteúdo da lição "${input.title}" (${input.level}) da ${input.track ? `trilha "${input.track.title}"` : `unidade "${input.unitTitle}"`}.`,
      `Objetivo da lição: ${quoted(input.objective)}. Objetivo do aluno: ${input.goal.trim() ? quoted(input.goal) : 'conversação geral'}.`,
      `Dificuldade TRAVADA no nível ${input.level}: vocabulário, frases e temas condizentes com esse nível — A1/A2 = frases curtas e concretas do dia a dia; B1/B2 = opinião, hipóteses, narrativa; C1 = temas abstratos, nuance de registro e estruturas complexas. Nunca recicle frases básicas de nível inicial numa lição avançada.`,
      `No JSON de resposta, o campo "level" deve ser exatamente "${input.level}" — a lição não rebaixa nem promove o aluno.`,
      `A explicação deve ter 2 a 4 parágrafos curtos em ${locale.nativeName}, com exemplos em ${locale.targetName} no meio.`,
      `examples: 3 a 5 pares com "target" em ${locale.targetName} e "native" em ${locale.nativeName}; ${locale.targetName} natural e no nível do aluno.`,
      `grammarPoints: 1 a 3 pontos, cada um com explicação em ${locale.nativeName} e 1 a 3 exemplos em ${locale.targetName}.`,
      `vocabulary: 5 a 8 itens com termo em ${locale.targetName}, tradução em ${locale.nativeName} e uma frase de exemplo em ${locale.targetName} que use o termo e deixe seu sentido claro pelo contexto (o aluno vai refazer essa frase como exercício de completar).`,
      `pitfalls: 1 a 3 armadilhas de quem fala ${locale.nativeName} (tag, wrong em ${locale.targetName} errado, right correto, note em ${locale.nativeName}).`,
      'Se algum erro do aluno couber nesta lição, inclua-o em pitfalls e mencione-o na explicação.',
      'Erros do aluno (prioridade, mais recorrentes primeiro):',
      focusSection(input.errors, 5, `banco de interferência ${locale.nativeName}→${locale.targetName}`),
      ...(input.track
        ? [
            `Domínio da trilha: ${input.track.title}.`,
            `Palavras-alvo que DEVEM aparecer no vocabulary e nos exemplos: ${input.track.vocabulary.slice(0, 8).join(', ')}.`,
            `Restrição de nível: ${input.level} — use gramática de ${input.level}, nenhuma estrutura além dela, mesmo que o domínio permita.`,
            `Todo o conteúdo (explicação, exemplos, vocabulário) se passa em situações reais desse domínio, em ${locale.targetName}.`
          ]
        : []),
      `Mantenha o ${locale.targetName} simples: no máximo 2 orações por frase de exemplo.`
    ].join('\n')
  }
}

export function exercisePrompt(input: {
  content: LessonContentOutput
  level: CefrLevel
  goal: string
  errors: ErrorHint[]
  locale: PromptLocale
  track?: { title: string; vocabulary: string[] } | null
  /** V2: provedor do aluno tem voz? Adds os dois tipos de exercício de fala. */
  voice?: { tts: boolean; asr: boolean } | null
}): { system: string; user: string } {
  const { locale } = input
  const vocabulary = input.content.vocabulary
    .slice(0, 6)
    .map((item) => `${item.term} (${item.translation})`)
    .join(', ')

  const focusTags = input.errors
    .filter((error) => error.source !== 'bank')
    .slice(0, 4)
    .map((error) => error.tag)
    .join(', ')

  const orderRule =
    locale.target.tokenization === 'cjk'
      ? `- order: tokens são as UNIDADES NATURAIS (palavras, sem separar caractere por caractere) da frase correta EMBARALHADAS — o ${locale.targetName} não usa espaços, então segmente você mesmo; prompt pede para montar a frase; answer é a frase correta completa.`
      : `- order: tokens são as palavras da frase correta EMBARALHADAS; prompt pede para montar a frase; answer é a frase correta completa.`

  return {
    system: baseSystem(locale),
    user: [
      `Crie EXATAMENTE 6 exercícios para a lição "${input.content.title}" (${input.level}).`,
      `Objetivo: ${quoted(input.content.objective)}. Objetivo do aluno: ${input.goal.trim() ? quoted(input.goal) : 'conversação geral'}.`,
      `Dificuldade TRAVADA no nível ${input.level}: frases, vocabulário e temas desse nível — nada de rotina básica de A1/A2 em lição ${input.level}. Os enunciados devem girar em torno do ASSUNTO da lição, não de exemplos genéricos.`,
      `Vocabulário-alvo: ${vocabulary}.`,
      voiceMix(input.voice),
      'Regras por tipo:',
      `- multiple_choice: 4 options em ${locale.targetName}; answer deve ser EXATAMENTE o texto da opção correta.`,
      `- cloze: a resposta precisa ser deduzível do enunciado. prompt é uma frase em ${locale.targetName} com "___" no lugar da palavra, seguida da tradução da palavra que falta entre parênteses — ex.: "It is a ___ (delicada) situation for this scenario."; answer é a palavra que falta em ${locale.targetName}.`,
      orderRule,
      `- translate: prompt é uma frase em ${locale.nativeName} para traduzir ao ${locale.targetName}; answer é a tradução correta em ${locale.targetName}.`,
      `- free_production: o prompt mostra a fala em ${locale.targetName} à qual o aluno responde, entre aspas, seguida do que ele deve dizer em ${locale.nativeName} — ex.: 'Alguém pergunta: "<frase em ${locale.targetName}>". Responda que sim e diga quando foi.'; answer é uma resposta-modelo curta em ${locale.targetName}.`,
      voiceRules(locale, input.voice),
      // Sem isso o feedback cita texto que o aluno nunca viu: "perguntas com
      // 'Have you ever...?'" num enunciado escrito só no idioma nativo.
      `O aluno vê apenas instruction e prompt: nada do que ele precisa para responder pode estar fora do prompt.`,
      'Para tipos sem options ou tokens, use array vazio []. alternatives pode trazer variações aceitáveis (ou []).',
      `instructions em ${locale.nativeName}. explanation em ${locale.nativeName}, curta.`,
      'targetTags: as tags de erro que o exercício treina, sempre kebab-case em inglês (use [] se nenhum).',
      'Pelo menos 2 exercícios devem mirar os erros abaixo, com o targetTags correspondente.',
      `Tags disponíveis: ${focusTags || 'nenhuma ainda'}.`,
      'Erros do aluno (mais recorrentes primeiro):',
      focusSection(input.errors, 4, `banco de interferência ${locale.nativeName}→${locale.targetName}`),
      ...(input.track
        ? [
            `Todos os exercícios passam por dentro do domínio "${input.track.title}": situações, frases e vocabulário desse contexto.`,
            `Pelo menos 3 exercícios devem usar as palavras-alvo: ${input.track.vocabulary.slice(0, 8).join(', ')}.`,
            `A gramática cobrada fica em ${input.level} — nada acima disso.`
          ]
        : []),
      'Não repita a mesma frase em exercícios diferentes.'
    ]
      .filter(Boolean)
      .join('\n')
  }
}

/** Ordem dos tipos pedida à IA — com voz, o bloco ganha ouvir e falar. */
function voiceMix(voice: { tts: boolean; asr: boolean } | null | undefined): string {
  if (!voice || !voice.tts) {
    return 'Inclua, nesta ordem, um de cada tipo: multiple_choice, cloze, order, translate, free_production e mais um multiple_choice.'
  }
  return [
    'Inclua, nesta ordem, um de cada tipo: multiple_choice, cloze, order, translate, free_production, listen_repeat e speak_sentence.',
    voice.asr
      ? 'listen_repeat e speak_sentence são de PRÁTICA DE VOZ: o aluno ouve (ou fala) — nunca um exercício escrito disfarçado.'
      : 'listen_repeat (ouvir e escolher); não gere speak_sentence porque o app não consegue transcrever fala aqui.'
  ].join(' ')
}

/** Regras por tipo de voz, no par de idiomas do perfil. */
function voiceRules(locale: PromptLocale, voice: { tts: boolean; asr: boolean } | null | undefined): string | null {
  if (!voice || !voice.tts) return null
  const asr = voice.asr
    ? `- speak_sentence: answer é a frase em ${locale.targetName} que o aluno deve LER EM VOZ ALTA (curta, no nível); prompt diz em ${locale.nativeName} o que a frase significa ou em que situação usá-la; options e tokens = [].`
    : `- speak_sentence: não gere (sem transcrição de fala neste provedor).`
  return `- listen_repeat: o app sintetiza o áudio de "answer"; answer é a frase falada em ${locale.targetName} e options são 4 frases em ${locale.targetName} plausíveis no nível (a correta é exatamente uma delas, igual a answer); prompt é uma instrução em ${locale.nativeName} para ouvir e escolher, SEM escrever a frase; explanation em ${locale.nativeName}.
${asr}`
}

export function gradePrompt(input: {
  type: string
  prompt: string
  answer: string
  alternatives: string[]
  explanation: string
  response: string
  level: CefrLevel
  locale: PromptLocale
}): { system: string; user: string } {
  const { locale } = input
  const accepted = [input.answer, ...input.alternatives].filter(Boolean).join(' | ')

  return {
    system: baseSystem(locale),
    user: [
      `Avalie a resposta de um aluno falante de ${locale.nativeName} que estuda ${locale.targetName}.`,
      `Nível: ${input.level}. Tipo de exercício: ${input.type}.`,
      `Enunciado: ${input.prompt}`,
      `Resposta esperada: ${accepted || input.answer}`,
      `Explicação de referência: ${input.explanation}`,
      `Resposta do aluno: ${input.response}`,
      'Aceite variações naturais e pequenos deslizes que não mudem o sentido (ex.: contrações, artigo, ortografia alternativa).',
      'Seja rigoroso com o ponto gramatical-alvo do exercício.',
      'Cite apenas o que está no Enunciado: se ele não traz a pergunta no idioma-alvo, avalie pelo sentido e pelo ponto gramatical sem supor o texto dessa pergunta.',
      `correct: true/false. score entre 0 e 1. feedback em ${locale.nativeName}, 1 a 2 frases, gentil e específico.`,
      `corrected: a versão corrigida da resposta do aluno (ou a própria resposta se estiver correta).`,
      'errorTags: 1 a 3 tags curtas em inglês, kebab-case (ex.: past-tense, articles, word-order, vocabulary). Use [] se estiver correto.'
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
  /** Par de idiomas do perfil (M4). */
  locale: PromptLocale
}

export interface ScenarioContext {
  persona: string
  setting: string
  successCriteria: string[]
}

/**
 * System prompt do tutor de conversação. É aqui que o modelo do aluno entra:
 * nível, objetivo, resumo da conversa e os erros recorrentes do caderno —
 * sempre no par de idiomas do perfil.
 */
export function tutorSystem(context: TutorContext): string {
  const { locale } = context
  const errorLines = focusSection(context.errors, 6, `banco de interferência ${locale.nativeName}→${locale.targetName}`)
  const vocabulary =
    context.vocabulary.length > 0
      ? context.vocabulary
          .slice(0, 8)
          .map((item) => `${item.term} (${item.translation})`)
          .join(', ')
      : 'nenhum ainda'

  return [
    `Você é um tutor de ${locale.targetName} conversando com um adulto falante de ${locale.nativeName}.`,
    `Nível atual do aluno: ${context.level}. Objetivo: ${context.goal || 'conversação geral'}.`,
    `Escreva em ${locale.targetName} simples e adequado ao nível, 2 a 4 frases por resposta, sempre terminando com uma pergunta ou convite para continuar.`,
    `Explique em ${locale.nativeName} apenas quando for necessário para corrigir.`,
    'Nunca use markdown, listas com marcadores ou títulos.',
    '',
    `Política de correção: ${correctionStyleLabel(context.style, locale)}`,
    `Correções de língua são calculadas separadamente: no texto, você só faz o recast (refazer a frase do aluno corretamente em ${locale.targetName}) e, se a política pedir, uma explicação curta em ${locale.nativeName}.`,
    'Não repita a lista de erros nem corrija mais de 2 pontos por resposta.',
    '',
    'Erros recorrentes do aluno (priorize o recast destes):',
    errorLines,
    `Vocabulário recente que ele está aprendendo (use quando couber, sem forçar): ${quoted(vocabulary)}.`,
    context.lesson
      ? `A conversa vem da lição ${quoted(context.lesson.title)} (${quoted(context.lesson.objective)}). Estruturas da lição para reaparecerem: ${context.lesson.grammar.join(', ') || '—'}.`
      : '',
    context.topic ? `Tema pedido pelo aluno: ${quoted(context.topic)}.` : '',
    scenarioSection(context.scenario ?? null, locale),
    context.summary ? `Resumo da conversa até agora: ${quoted(context.summary)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Bloco de personagem do modo cenário. A rubrica de conteúdo é separada da de
 * língua: aqui o tutor só cuida da TAREFA, e a correção continua sendo calculada
 * em outra passada.
 */
function scenarioSection(scenario: ScenarioContext | null, locale: PromptLocale): string {
  if (!scenario) return ''

  return [
    'MODO CENÁRIO (roleplay): você está em personagem e não sai dele.',
    `Personagem: ${scenario.persona}.`,
    `Contexto: ${scenario.setting}.`,
    `Fale sempre em ${locale.targetName}, dentro do personagem, e conduza a conversa até a tarefa ser cumprida.`,
    'No máximo uma pergunta por vez; se o aluno travar, dê uma opção de resposta dentro do personagem.',
    'Critérios da tarefa (objetivo oculto — não liste nem cheque em voz alta):',
    scenario.successCriteria.map((criterion) => `- ${criterion}`).join('\n')
  ].join('\n')
}

export function correctionStyleLabel(style: CorrectionStyle, locale: PromptLocale = DEFAULT_LOCALE): string {
  if (style === 'recast') return 'recast suave (reformula a frase, sem explicação)'
  if (style === 'explicit') {
    return `correção explícita (aponte o erro, a forma certa e 1 frase de explicação em ${locale.nativeName})`
  }
  return `ambos (recast + 1 linha de explicação em ${locale.nativeName})`
}

/** Primeira chamada da conversa: o tutor abre o papo. */
export function tutorOpenerMessage(context: TutorContext): string {
  if (context.scenario) {
    return `Você é o personagem do cenário. Abra o roleplay com a primeira fala, em ${context.locale.targetName}, uma frase.`
  }
  if (context.topic) return `Comece a conversa sobre: ${context.topic}.`
  if (context.lesson) return `Comece uma conversa curta ligada à lição "${context.lesson.title}".`
  return 'Comece a conversa puxando um assunto ligado ao objetivo do aluno.'
}

// --- V3: conversa em tempo real (voz ao vivo) --------------------------------

/**
 * Versão da instrução de voz ao vivo. Separada do `PROMPT_VERSION` do conteúdo
 * persistido: a fala não entra em cache de lição — muda com o motor, não com o
 * banco. Carimbada em `live_sessions` (Lote 3) para debug de regressão.
 */
export const LIVE_PROMPT_VERSION = 1

export interface LiveVoiceInput {
  context: TutorContext
  rate: SpeechRate
  turnMode: 'vad' | 'manual'
}

/**
 * System prompt da CHAMADA: as mesmas informações do chat (nível, objetivo,
 * erros recorrentes, cenário), mas escrito para a BOCA — resposta falada de uma
 * a duas frases, nada que só existe na escrita. As correções de língua continuam
 * sendo calculadas em separado (pós-turno, no app): no áudio o tutor só faz o
 * recast, senão a conversa vira aula e o aluno para de falar.
 */
export function liveVoiceSystem(input: LiveVoiceInput): string {
  const { context, rate, turnMode } = input
  const { locale } = context
  const errorLines = focusSection(context.errors, 5, `banco de interferência ${locale.nativeName}→${locale.targetName}`)
  const vocabulary =
    context.vocabulary.length > 0
      ? context.vocabulary.slice(0, 6).map((item) => `${item.term} (${item.translation})`).join(', ')
      : 'nenhum ainda'

  const pace =
    rate === 'slow'
      ? 'Fale devagar, com pausas claras entre as frases.'
      : rate === 'fast'
        ? 'Fale num ritmo de conversa natural, um pouco rápido.'
        : 'Fale num ritmo de conversa natural e clara.'

  const taking =
    turnMode === 'manual'
      ? 'O aluno abre e fecha o microfone a cada fala: ao terminar a sua frase, pare e aguarde o turno dele.'
      : 'O aluno fala livremente e pode te interromper a qualquer momento: ao ser interrompido, pare na hora e escute.'

  return [
    `Você é um tutor de ${locale.targetName} conversando POR VOZ com um adulto falante de ${locale.nativeName}.`,
    `Nível atual do aluno: ${context.level}. Objetivo: ${context.goal || 'conversação geral'}.`,
    `Fale ${locale.targetName} adequado ao nível, uma ou duas frases por vez, sempre terminando com uma pergunta curta ou convite para continuar.`,
    'Sua fala vira áudio: nunca cite markdown, listas, títulos, emojis, ortografia de dicionário ou símbolos — nada que não se diz com a boca.',
    `Se precisar explicar algo, diga meia frase em ${locale.nativeName} e volte para o ${locale.targetName}.`,
    pace,
    taking,
    '',
    'Política de correção: recast falado. Reformule naturalmente a frase do aluno na sua resposta, sem apontar o erro e sem ler a versão corrigida como lista. As correções escritas aparecem na tela por outra via — não narr elas.',
    'Não repita a lista de erros nem corrija mais de um ponto por fala.',
    '',
    'Erros recorrentes do aluno (priorize o recast destes):',
    errorLines,
    `Vocabulário recente que ele está aprendendo (use quando couber, sem forçar): ${quoted(vocabulary)}.`,
    context.lesson
      ? `A conversa vem da lição ${quoted(context.lesson.title)} (${quoted(context.lesson.objective)}). Estruturas da lição para reaparecerem na fala: ${context.lesson.grammar.join(', ') || '—'}.`
      : '',
    context.topic ? `Tema pedido pelo aluno: ${quoted(context.topic)}.` : '',
    scenarioSection(context.scenario ?? null, locale),
    context.summary ? `Resumo da conversa até agora: ${quoted(context.summary)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Abertura falada da chamada (enviada como turno do sistema quando a sessão está pronta). */
export function liveOpenerMessage(context: TutorContext): string {
  if (context.scenario) {
    return `Abra o roleplay com a primeira fala do personagem, em ${context.locale.targetName}, uma frase curta.`
  }
  if (context.topic) return `Cumprimente o aluno e abra a conversa sobre: ${context.topic}. Uma frase, no idioma-alvo.`
  return `Cumprimente o aluno e puxe um assunto ligado ao objetivo dele. Uma frase em ${context.locale.targetName}.`
}

/** Passada de correção do texto livre do aluno (antes da resposta do tutor). */
export function correctionPrompt(input: {
  text: string
  level: CefrLevel
  style: CorrectionStyle
  errors: ErrorHint[]
  locale: PromptLocale
}): { system: string; user: string } {
  const { locale } = input
  return {
    system: baseSystem(locale),
    user: [
      `Corrija a mensagem escrita em ${locale.targetName} por um aluno falante de ${locale.nativeName}, como se fosse parte de uma conversa.`,
      `Nível: ${input.level}.`,
      `Erros recorrentes dele (use as mesmas tags quando se aplicar):`,
      focusSection(input.errors, 6, `banco de interferência ${locale.nativeName}→${locale.targetName}`),
      `Mensagem do aluno: ${quoted(input.text)}`,
      'corrections: apenas erros de LÍNGUA (gramática, palavra, preposição, concordância, ordem). Ignore estilo e preferências.',
      `original: o trecho exatamente como o aluno escreveu. corrected: o mesmo trecho corrigido em ${locale.targetName}, substituível no texto.`,
      'tag: 1 tag curta em inglês, kebab-case, consistente (ex.: past-simple, articles, verb-preposition, question-word-order).',
      `note: explicação de 1 frase em ${locale.nativeName} (ou string vazia).`,
      `recast: a mensagem inteira reescrita em ${locale.targetName} natural, mantendo o sentido e o nível do aluno.`,
      'hasErrors: false quando a mensagem está correta; nesse caso corrections = [] e recast = mensagem original.'
    ].join('\n')
  }
}

/** Compacta o histórico antigo em um resumo rolante. */
export function summaryPrompt(input: {
  current: string | null
  transcript: string
  locale: PromptLocale
}): { system: string; user: string } {
  const { locale } = input
  return {
    system: baseSystem(locale),
    user: [
      `Resuma a parte antiga de uma conversa entre tutor e aluno de ${locale.targetName}.`,
      input.current ? `Resumo anterior: ${quoted(input.current)}` : 'Não há resumo anterior.',
      `Trecho a incorporar:\n${quoted(input.transcript)}`,
      `summary: 3 a 5 frases em ${locale.nativeName} dizendo o que foi conversado, quais erros apareceram e o que o aluno já conseguia dizer.`
    ].join('\n')
  }
}

// --- Trilhas de foco e cenário (M3) --------------------------------------------

/** Esboço da trilha de foco: mini-currículo nivelado, orientado a cenários. */
export function trackPlanPrompt(input: {
  objective: string
  level: CefrLevel
  goal: string
  locale: PromptLocale
}): { system: string; user: string } {
  const { locale } = input
  return {
    system: baseSystem(locale),
    user: [
      `Monte o esboço de uma trilha de foco para um aluno de ${locale.targetName} no nível ${input.level}.`,
      `Tópico desta trilha (OBRIGATÓRIO — o esboço inteiro nasce daqui, e só daqui): ${quoted(input.objective)}.`,
      `Objetivo geral do aluno (apenas contexto do perfil; se for de OUTRO domínio, ignore-o nesta trilha): ${input.goal.trim() ? quoted(input.goal) : 'conversação geral'}.`,
      'A trilha é um mini-currículo: 5 a 8 lições em ordem de dificuldade, todas dentro do domínio pedido.',
      `A progressão gramatical NÃO muda por causa da trilha: mantenha a complexidade no nível ${input.level}. O que muda é o domínio do vocabulário e as situações.`,
      'Campos:',
      `- title: nome curto (2 a 4 palavras, em ${locale.nativeName}) derivado do TÓPICO pedido — nunca o domínio do objetivo geral quando ele for outro.`,
      `- goalTag: etiqueta curta em inglês, kebab-case, derivada do tópico (ex.: "travel-basic", "daily-standup").`,
      `- lessons: 5 a 8 lições, cada uma com title (curto, em ${locale.nativeName}), objective (1 frase, em ${locale.nativeName}) e`,
      `  focusVocabulary (5 a 10 termos em ${locale.targetName} do domínio, sem tradução).`,
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
  locale: PromptLocale
}): { system: string; user: string } {
  const { locale } = input
  return {
    system: baseSystem(locale),
    user: [
      `Crie um cenário de roleplay para o aluno praticar a lição "${input.lessonTitle}" (${input.level}).`,
      `Objetivo da lição: ${quoted(input.objective)}. Objetivo geral do aluno: ${input.goal.trim() ? quoted(input.goal) : 'conversação geral'}.`,
      'Campos:',
      `- persona: quem o tutor vai interpretar, em ${locale.nativeName} (ex.: "entrevistador técnico de uma startup, objetivo e simpático").`,
      `- setting: onde e quando a conversa acontece, em ${locale.nativeName}, 1 frase.`,
      `- successCriteria: 3 a 5 coisas concretas que o aluno precisa conseguir dizer/fazer para cumprir a tarefa, em ${locale.nativeName}, frases curtas.`,
      `- openingLine: a primeira fala do personagem, em ${locale.targetName}, no nível ${input.level}, 1 a 2 frases.`,
      `O personagem fala em ${locale.targetName} durante todo o roleplay. Os critérios avaliam a TAREFA (conteúdo), não a gramática.`
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
  locale: PromptLocale
}): { system: string; user: string } {
  const { locale } = input
  return {
    system: baseSystem(locale),
    user: [
      `Avalie o desempenho de um aluno falante de ${locale.nativeName} em um roleplay de ${locale.targetName}.`,
      `Nível do aluno: ${input.level}.`,
      `Personagem: ${quoted(input.persona)}. Contexto: ${quoted(input.setting)}.`,
      'Critérios de sucesso da tarefa (avalie um a um):',
      input.criteria.map((criterion, index) => `${index + 1}. ${quoted(criterion)}`).join('\n'),
      'Transcrição da conversa:',
      quoted(input.transcript),
      'Campos:',
      '- contentScore: fração dos critérios de TAREFA cumpridos (0 a 1). Ignore gramática aqui.',
      '- criteriaMet: um booleano por critério, na mesma ordem da lista acima (true = o aluno cumpriu).',
      '- languageScore: quão correta e adequada ao nível foi a língua (0 a 1).',
      `- feedback: 2 a 4 frases em ${locale.nativeName}. Diga o que cumpriu, o que faltou e o ponto a melhorar.`,
      `- bestPhrases: até 3 falas do aluno → versão em ${locale.targetName} mais natural/precisa, com reason em ${locale.nativeName}.`,
      `- followUpDrill: 1 instrução curta em ${locale.nativeName} para um exercício de follow-up sobre o ponto mais fraco.`,
      'Se a transcrição tiver poucos turnos do aluno, seja conservador nos scores.',
      'Erros recorrentes do aluno (considere no languageScore):',
      focusSection(input.errors, 5, `banco de interferência ${locale.nativeName}→${locale.targetName}`)
    ].join('\n')
  }
}
