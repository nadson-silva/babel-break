import type { Correction, CorrectionSource, CorrectionStyle } from '../shared/types'
import {
  detectInterference,
  INTERFERENCE_BANK,
  recast as applyBankRecast,
  type InterferenceRule
} from './interference'
import { DEFAULT_LOCALE, type PromptLocale } from './prompts'

export type { Correction, CorrectionSource }

/** Resultado de uma passada de correção sobre um texto livre do aluno. */
export interface CorrectionReport {
  corrections: Correction[]
  /** Texto do aluno reescrito — o "recast" que o tutor devolve inline. */
  recast: string
  clean: boolean
}

function normalizeTag(tag: string): string {
  const cleaned = tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'general'
}

export function normalizeCorrectionTag(tag: string): string {
  return normalizeTag(tag)
}

function compact(value: string): string {
  // Unicode-aware (M4): com [^a-z0-9] todo texto CJK/árabe virava '' e as
  // checagens "mudou alguma coisa?" / "já coberto?" igualavam tudo.
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Passada determinística com o banco de interferência. `rules` são as regras do
 * par nativo→alvo (`interferenceRulesFor`); sem banco para o par, passe `[]` e
 * a correção fica inteira com a IA — essa é a abstração do M4 (banco manual vs.
 * IA). O default histórico é o banco PT-BR→inglês (fixture de qualidade).
 */
export function bankCorrections(text: string, rules: InterferenceRule[] = INTERFERENCE_BANK): Correction[] {
  return detectInterference(text, rules).map((hit) => ({
    original: hit.original,
    corrected: hit.corrected,
    tag: normalizeTag(hit.tag),
    note: hit.note,
    source: 'bank' as const
  }))
}

/**
 * Junta a passada do banco com a do modelo. O banco manda quando os dois
 * apontam o mesmo trecho; o modelo acrescenta o que o banco não conhece.
 */
export function mergeCorrections(bank: Correction[], model: Correction[]): Correction[] {
  const merged: Correction[] = []

  for (const correction of bank) {
    merged.push({ ...correction, tag: normalizeTag(correction.tag) })
  }

  for (const correction of model) {
    const original = correction.original?.trim()
    const corrected = correction.corrected?.trim()
    if (!original || !corrected) continue
    if (compact(original) === compact(corrected)) continue

    const covered = merged.some(
      (entry) => compact(entry.original).includes(compact(original)) || compact(original).includes(compact(entry.original))
    )
    if (covered) continue

    merged.push({
      original,
      corrected,
      tag: normalizeTag(correction.tag || 'general'),
      note: correction.note?.trim() || undefined,
      source: 'ai'
    })
  }

  return merged.slice(0, 6)
}

export function buildCorrectionReport(
  text: string,
  model: Correction[] = [],
  rules: InterferenceRule[] = INTERFERENCE_BANK
): CorrectionReport {
  const corrections = mergeCorrections(bankCorrections(text, rules), model)
  const deterministic = applyBankRecast(text, rules)
  const recastText = corrections.length > 0 ? deterministic : text.trim()

  return {
    corrections,
    recast: recastText,
    clean: corrections.length === 0
  }
}

export function tagsOf(corrections: Correction[]): string[] {
  const tags: string[] = []
  for (const correction of corrections) {
    const tag = normalizeTag(correction.tag)
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** Política de correção do usuário, aplicada no prompt (não da UI). M4: na língua nativa do perfil. */
export function correctionPolicyPrompt(style: CorrectionStyle, locale: PromptLocale = DEFAULT_LOCALE): string {
  if (style === 'recast') {
    return [
      'Política de correção: RECAST SUAVE.',
      'Não faça lista de erros nem use tom de professor. Refaça naturalmente a frase do aluno',
      `dentro da sua resposta, em ${locale.targetName}, destacando apenas a versão corrigida em itálico simples (*...*).`,
      'Se não houver erro de língua, converse sem corrigir.'
    ].join(' ')
  }

  if (style === 'explicit') {
    return [
      'Política de correção: EXPLICAÇÃO EXPLÍCITA.',
      `Aponte o erro, dê a forma correta e explique em ${locale.nativeName} em 1 frase curta.`,
      'No máximo 3 correções por resposta, priorizando o ponto que o aluno mais repete.'
    ].join(' ')
  }

  return [
    'Política de correção: AMBOS.',
    `Primeiro refaça a frase do aluno naturalmente em ${locale.targetName} (recast) e depois, em uma linha curta em`,
    `${locale.nativeName}, explique o principal erro. No máximo 3 correções por resposta.`
  ].join(' ')
}
