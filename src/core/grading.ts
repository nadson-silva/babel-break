import type { CefrLevel, ExerciseType, GradeFeedback } from '../shared/types'
import { runtimeText } from './runtime-text'

export interface ExerciseAnswerKey {
  answer: string
  alternatives?: string[]
  explanation?: string
}

/**
 * M6 (B7): em idiomas cujo diacrítico **define a palavra** (vietnamita: "ma" ≠
 * "má" ≠ "mà"), apagar `\u0300-\u036F` transforma um erro de tom em resposta
 * certa. A política mora no registro de idiomas; o padrão histórico (apagar
 * acentos latinos/harakat) vale para fr/de/en e todos os demais.
 */
const SIGNIFICANT_DIACRITICS = new Set(['vi', 'vi-VN'])

export function diacriticsAreSignificant(lang: string | null | undefined): boolean {
  return lang != null && SIGNIFICANT_DIACRITICS.has(lang)
}

/**
 * Normalização para comparação determinística de respostas.
 *
 * M4: antes qualquer coisa fora de [a-z0-9] virava espaço — o que apagava
 * por completo chinês, japonês, coreano e árabe (e igualava respostas que não
 * deveriam se igualar). Agora preserva `\p{L}`/`\p{N}` de qualquer escrita,
 * mantém a tolerância a acentos latinos (NFD + stripping), remove diacríticos
 * combinantes (harakat árabe etc.), marcas bidi/zero-width e pontuação.
 * M6 (B7): o stripping de acentos é ligado/desligado por idioma.
 */
export function normalizeText(text: string, lang?: string | null): string {
  const decomposed = text.normalize('NFD')
  const stripped = diacriticsAreSignificant(lang)
    ? decomposed
    : decomposed.replace(/[\u0300-\u036f\u0591-\u05AF\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF]/g, '')

  return stripped
    .normalize('NFC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u061C\u070F]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matches(answerKey: ExerciseAnswerKey, response: string, lang?: string | null): boolean {
  const target = normalizeText(response, lang)
  if (!target) return false

  return [answerKey.answer, ...(answerKey.alternatives ?? [])]
    .filter(Boolean)
    .some((candidate) => normalizeText(candidate, lang) === target)
}

/**
 * Corrige localmente os tipos objetivos. Retorna null quando a resposta
 * precisa de avaliação por IA (tradução livre ou produção livre).
 *
 * M6 (B8): o veredicto sai no idioma do aluno (`nativeLang`) — sem isto um
 * falante de inglês estudando espanhol recebia 'Correto!' em português.
 */
export function gradeDeterministic(
  type: ExerciseType,
  answerKey: ExerciseAnswerKey,
  response: string,
  nativeLang: string | null = 'pt-BR',
  lang?: string | null
): GradeFeedback | null {
  const explanation = answerKey.explanation?.trim()

  if (type === 'multiple_choice' || type === 'cloze' || type === 'order') {
    const correct = matches(answerKey, response, lang)
    return {
      correct,
      score: correct ? 1 : 0,
      feedback: correct
        ? runtimeText(nativeLang, 'grade.correct')
        : explanation
          ? runtimeText(nativeLang, 'grade.explanation', { explanation })
          : runtimeText(nativeLang, 'grade.compare'),
      corrected: correct ? response : answerKey.answer,
      errorTags: correct ? [] : [type === 'cloze' ? 'grammar' : type === 'order' ? 'word-order' : 'accuracy']
    }
  }

  if (type === 'translate' && matches(answerKey, response, lang)) {
    return {
      correct: true,
      score: 1,
      feedback: runtimeText(nativeLang, 'grade.translateCorrect'),
      corrected: response,
      errorTags: []
    }
  }

  return null
}

export function needsAiGrading(type: ExerciseType): boolean {
  return type === 'translate' || type === 'free_production'
}

export function buildModelAnswerHint(
  type: ExerciseType,
  answer: string,
  level: CefrLevel
): string {
  if (type === 'free_production') {
    return `Resposta-modelo (${level}): ${answer}`
  }
  return answer
}

export function shuffleTokens(tokens: string[], seed = Date.now()): string[] {
  const shuffled = [...tokens]
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646

  const random = (): number => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]]
  }

  return shuffled
}
