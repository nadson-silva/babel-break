import type { CefrLevel } from '../shared/types'
import type { LessonContentOutput } from './schemas'

export interface ErrorHint {
  tag: string
  original: string
  corrected: string
}

const BASE_SYSTEM = [
  'Você é um professor de inglês experiente para falantes de português do Brasil.',
  'O aluno estuda no próprio ritmo, sem pressão.',
  'Todo conteúdo em inglês deve ser adequado ao nível CEFR informado.',
  'Explicações, instruções e feedback devem ser em português do Brasil, claros e curtos.',
  'Responda SEMPRE com um único objeto JSON válido, sem markdown, sem comentários e sem texto fora do JSON.'
].join(' ')

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
}): { system: string; user: string } {
  const errorHints =
    input.errors.length > 0
      ? input.errors
          .slice(0, 5)
          .map((error) => `- ${error.tag}: "${error.original}" → "${error.corrected}"`)
          .join('\n')
      : '- nenhum erro registrado ainda'

  return {
    system: BASE_SYSTEM,
    user: [
      `Prepare o conteúdo da lição "${input.title}" (${input.level}) da unidade "${input.unitTitle}".`,
      `Objetivo da lição: ${input.objective}. Objetivo do aluno: ${input.goal || 'conversação geral'}.`,
      'A explicação deve ter 2 a 4 parágrafos curtos em português, com exemplos em inglês no meio.',
      'examples: 3 a 5 pares inglês/português; inglês natural e no nível do aluno.',
      'grammarPoints: 1 a 3 pontos, cada um com explicação em português e 1 a 3 exemplos em inglês.',
      'vocabulary: 5 a 8 itens com termo em inglês, tradução em português e uma frase de exemplo em inglês.',
      'Priorize erros recorrentes do aluno quando fizer sentido:',
      errorHints,
      'Mantenha o inglês simples: no máximo 2 orações por frase de exemplo.'
    ].join('\n')
  }
}

export function exercisePrompt(input: {
  content: LessonContentOutput
  level: CefrLevel
  goal: string
  errors: ErrorHint[]
}): { system: string; user: string } {
  const errorHints =
    input.errors.length > 0
      ? input.errors
          .slice(0, 4)
          .map((error) => `- ${error.tag}: "${error.original}" → "${error.corrected}"`)
          .join('\n')
      : '- nenhum erro registrado ainda'

  const vocabulary = input.content.vocabulary
    .slice(0, 6)
    .map((item) => `${item.term} (${item.translation})`)
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
      'Erros recorrentes a mirar quando possível:',
      errorHints,
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
