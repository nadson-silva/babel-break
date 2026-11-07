import type { CefrLevel, ExerciseType, GradeFeedback } from '../shared/types'

export interface ExerciseAnswerKey {
  answer: string
  alternatives?: string[]
  explanation?: string
}

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matches(answerKey: ExerciseAnswerKey, response: string): boolean {
  const target = normalizeText(response)
  if (!target) return false

  return [answerKey.answer, ...(answerKey.alternatives ?? [])]
    .filter(Boolean)
    .some((candidate) => normalizeText(candidate) === target)
}

/**
 * Corrige localmente os tipos objetivos. Retorna null quando a resposta
 * precisa de avaliação por IA (tradução livre ou produção livre).
 */
export function gradeDeterministic(
  type: ExerciseType,
  answerKey: ExerciseAnswerKey,
  response: string
): GradeFeedback | null {
  const explanation = answerKey.explanation?.trim()

  if (type === 'multiple_choice' || type === 'cloze' || type === 'order') {
    const correct = matches(answerKey, response)
    return {
      correct,
      score: correct ? 1 : 0,
      feedback: correct
        ? 'Correto!'
        : explanation
          ? `Ainda não. ${explanation}`
          : 'Ainda não. Compare com a resposta esperada e tente de novo.',
      corrected: correct ? response : answerKey.answer,
      errorTags: correct ? [] : [type === 'cloze' ? 'grammar' : type === 'order' ? 'word-order' : 'accuracy']
    }
  }

  if (type === 'translate' && matches(answerKey, response)) {
    return {
      correct: true,
      score: 1,
      feedback: 'Correto! Tradução natural.',
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
