import type { LessonContentOutput } from './schemas'

type VocabItem = LessonContentOutput['vocabulary'][number]

/**
 * Cloze gerado por IA sem dica de tradução deixa a resposta indecifrável —
 * "It is a ___ situation" aceita qualquer adjetivo. Quando a palavra esperada
 * pertence ao vocabulário da lição, injetamos a tradução dela entre parênteses
 * logo após o vão: o aluno passa a saber exatamente o que a atividade espera.
 */
export function clarifyCloze(prompt: string, answer: string, vocabulary: VocabItem[]): string {
  const gapIndex = prompt.indexOf('___')
  if (gapIndex < 0) return prompt

  // Enunciado já traz a dica entre parênteses (IA obediente ou gerador local).
  const afterGap = prompt.slice(gapIndex + 3).trimStart()
  if (afterGap.startsWith('(') || afterGap.startsWith('（')) return prompt

  const item = vocabulary.find((entry) => sameWord(entry.term, answer))
  if (!item || !item.translation) return prompt

  const insertAt = gapIndex + 3
  return `${prompt.slice(0, insertAt)} (${item.translation})${prompt.slice(insertAt)}`
}

/** "works"/"worked" vs "work": mesma palavra com flexão conta como match. */
function sameWord(term: string, answer: string): boolean {
  const a = term.trim().toLowerCase()
  const b = answer.trim().toLowerCase()
  if (!a || !b) return false
  if (a === b) return true
  return b.startsWith(a) || a.startsWith(b)
}
