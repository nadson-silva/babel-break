/**
 * V2 — score de pronúncia **determinístico**.
 *
 * O que o aluno gravou vira texto (ASR do provedor). Comparar o texto ouvido com a
 * frase-alvo é um problema de alinhamento, não de opinião: a mesma gravação
 * transcrita deve dar o mesmo score amanhã, sem gastar token, e funciona para
 * qualquer idioma (espaço, CJK via `Intl.Segmenter`, RTL).
 *
 * Isso é o que o plano pede em voz: *score de pronúncia* com base reprodutível.
 * A IA entra só como transcritora; se ela transcreve errado, o score está errado
 * junto — e é por isso que `confidence` cai com frases curtas e o app mostra o
 * que ouviu, para o aluno discordar com conhecimento de causa.
 */
import { normalizeText } from './grading'
import { tokenize } from './languages'
import { clampScore01 } from './score'

export type PronunciationWordStatus = 'ok' | 'near' | 'wrong' | 'missing' | 'extra'

export interface PronunciationWord {
  /** Palavra da frase-alvo (ou a que o aluno acrescentou). */
  text: string
  status: PronunciationWordStatus
  /** O que o ASR ouviu no lugar dela, quando houve troca. */
  heard?: string
}

export interface PronunciationScore {
  /** 0–1 — a escala única do app (ver `core/score.ts`). */
  score: number
  /** Fração da frase-alvo que apareceu na fala (1 = tudo dito). */
  accuracy: number
  /** Fração do que foi ouvido que estava na frase-alvo (1 = nada sobrando). */
  precision: number
  /** Quantas palavras o aluno falou a mais. */
  extraWords: number
  /** Palavras da frase-alvo (denominador honesto). */
  targetWords: number
  words: PronunciationWord[]
  /** O ASR não devolveu nada (microfone, ruído, fala inaudível). */
  transcriptEmpty: boolean
  /** 0–1: quão confiável é este score (frase de 2 palavras é ruído). */
  confidence: number
  /** Tags kebab-case para o caderno/painel (pronunciation, missing-words…). */
  tags: string[]
}

/** Peso de um match exato vs. um "quase" (deslize pequeno de pronúncia). */
const EXACT = 1
const NEAR = 0.6

function levenshtein(a: string, b: string, limit: number): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  if (Math.abs(a.length - b.length) > limit) return limit + 1

  let previous: number[] = Array.from({ length: b.length + 1 }, (_, index) => index)

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    let best = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost)
      current[j] = value
      if (value < best) best = value
    }
    if (best > limit) return limit + 1
    previous = current
  }

  return previous[b.length] ?? limit + 1
}

/** Perto o bastante para contar crédito parcial (e não como acerto). */
function isNear(a: string, b: string): boolean {
  if (!a || !b || a === b) return false
  // Palavra curta (1–3 chars) não tem "quase": um char de diferença é outra palavra.
  const foldedA = fold(a)
  const foldedB = fold(b)
  const longest = Math.max(foldedA.length, foldedB.length)
  // Segmentação do ASR junta/separa o que o alvo grafa junto ("back end" ↔
  // "backend"): contenção de pelo menos 3 caracteres é pronúncia certa, palavra
  // apenas cortada em outro lugar.
  if (longest >= 4 && (foldedA.includes(foldedB) || foldedB.includes(foldedA))) return true

  const limit = longest <= 3 ? 0 : longest <= 5 ? 1 : 2
  if (limit === 0) return false
  return levenshtein(foldedA, foldedB, limit) <= limit
}

/**
 * S dobrado e hífen não são pronúncia errada: o ASR escreve "lets" para o que o
 * material didático grafa "let's", e "back-end" para "backend".
 */
function fold(word: string): string {
  return word.replace(/['’\-‐-―⸺⸻]/g, '')
}

function same(a: string, b: string): boolean {
  return a.length > 0 && (a === b || fold(a) === fold(b))
}

/**
 * Alinhamento (LCS ponderado) entre a frase-alvo e a transcrição.
 * Devolve o caminho de pares, com o crédito de cada um.
 */
function align(target: string[], heard: string[]): { words: PronunciationWord[]; extra: number; credit: number } {
  const rows = target.length
  const cols = heard.length
  const dp: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const targetWord = target[i] as string
      const heardWord = heard[j] as string
      let weight = 0
      if (same(targetWord, heardWord)) weight = EXACT
      else if (isNear(targetWord, heardWord)) weight = NEAR

      const skipTarget = dp[i + 1]?.[j] ?? 0
      const skipHeard = dp[i]?.[j + 1] ?? 0
      const take = weight > 0 ? (dp[i + 1]?.[j + 1] ?? 0) + weight : 0

      dp[i]![j] = Math.max(skipTarget, skipHeard, take)
    }
  }

  const words: PronunciationWord[] = []
  let extra = 0
  let credit = 0
  let i = 0
  let j = 0

  while (i < rows && j < cols) {
    const targetWord = target[i] as string
    const heardWord = heard[j] as string
    let weight = 0
    if (same(targetWord, heardWord)) weight = EXACT
    else if (isNear(targetWord, heardWord)) weight = NEAR

    const take = weight > 0 ? (dp[i + 1]?.[j + 1] ?? 0) + weight : -1
    const best = dp[i]?.[j] ?? 0

    if (take >= best && take >= (dp[i + 1]?.[j] ?? 0) && take >= (dp[i]?.[j + 1] ?? 0)) {
      credit += weight
      words.push({
        text: targetWord,
        status: weight === EXACT ? 'ok' : 'near',
        heard: weight === EXACT ? undefined : heardWord
      })
      i += 1
      j += 1
      continue
    }

    // Nenhuma das duas direções melhora: a palavra do alvo ficou de fora.
    if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      words.push({ text: targetWord, status: 'missing' })
      i += 1
    } else {
      extra += 1
      j += 1
    }
  }

  while (i < rows) {
    words.push({ text: target[i] as string, status: 'missing' })
    i += 1
  }

  while (j < cols) {
    extra += 1
    j += 1
  }

  return { words, extra, credit }
}

export interface PronunciationInput {
  /** Frase que o aluno deveria dizer (idioma-alvo). */
  target: string
  /** O que o ASR entendeu. `null`/vazio = nada ouvido. */
  transcript: string | null | undefined
  /** Idioma-alvo: normalização e segmentação por escrita. */
  lang: string
}

/**
 * Score de uma fala. Sem ASR (provedor de texto puro), o chamador nem chega
 * aqui: a tela diz "voz indisponível" em vez de dar nota zero.
 */
export function scorePronunciation(input: PronunciationInput): PronunciationScore {
  const targetTokens = tokenize(normalizeText(input.target, input.lang), input.lang)
  const heardTokens = tokenize(normalizeText(input.transcript ?? '', input.lang), input.lang)
  const transcriptEmpty = heardTokens.length === 0

  const { words, extra, credit } = align(targetTokens, heardTokens)

  const targetWords = targetTokens.length
  const accuracy = targetWords > 0 ? clampScore01(credit / targetWords) : 0
  const precision = heardTokens.length > 0 ? clampScore01(credit / heardTokens.length) : 0

  // Fala vazia não é "20% de pronúncia": é zero, e a UI diz o motivo.
  const score = transcriptEmpty || targetWords === 0 ? 0 : clampScore01(0.75 * accuracy + 0.25 * precision)

  const tags: string[] = []
  if (!transcriptEmpty && targetWords > 0) {
    if (words.some((word) => word.status === 'near' || word.status === 'wrong')) tags.push('pronunciation')
    if (words.some((word) => word.status === 'missing')) tags.push('missing-words')
    if (extra > 0) tags.push('extra-words')
  }
  if (transcriptEmpty) tags.push('no-audio')

  // Confiança: frase curta e transcrição vazia não sustentam conclusão nenhuma.
  const coverage = Math.min(1, targetWords / 5)
  const confidence = transcriptEmpty ? 0 : clampScore01(0.35 + 0.65 * coverage)

  return {
    score,
    accuracy,
    precision,
    extraWords: extra,
    targetWords,
    words,
    transcriptEmpty,
    confidence,
    tags
  }
}

/** Palavras que o aluno errou, para o prompt do recast e para o drill de follow-up. */
export function weakWords(score: PronunciationScore, limit = 4): PronunciationWord[] {
  return score.words
    .filter((word) => word.status === 'near' || word.status === 'wrong' || word.status === 'missing')
    .slice(0, limit)
}
