import type { Correction, CorrectionSource, CorrectionStyle } from '../shared/types'
import { detectInterference, recast as applyBankRecast } from './interference'

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
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Passada determinística com o banco de interferência PT-BR (funciona offline). */
export function bankCorrections(text: string): Correction[] {
  return detectInterference(text).map((hit) => ({
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

export function buildCorrectionReport(text: string, model: Correction[] = []): CorrectionReport {
  const corrections = mergeCorrections(bankCorrections(text), model)
  const deterministic = applyBankRecast(text)
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

/** Política de correção do usuário, aplicada no prompt (não na UI). */
export function correctionPolicyPrompt(style: CorrectionStyle): string {
  if (style === 'recast') {
    return [
      'Política de correção: RECAST SUAVE.',
      'Não faça lista de erros nem use tom de professor. Refaça naturalmente a frase do aluno',
      'dentro da sua resposta, destacando apenas a versão corrigida em itálico simples (*...*).',
      'Se não houver erro de língua, converse sem corrigir.'
    ].join(' ')
  }

  if (style === 'explicit') {
    return [
      'Política de correção: EXPLICAÇÃO EXPLÍCITA.',
      'Aponte o erro, dê a forma correta e explique em português do Brasil em 1 frase curta.',
      'No máximo 3 correções por resposta, priorizando o ponto que o aluno mais repete.'
    ].join(' ')
  }

  return [
    'Política de correção: AMBOS.',
    'Primeiro refaça a frase do aluno naturalmente (recast) e depois, em uma linha curta em',
    'português, explique o principal erro. No máximo 3 correções por resposta.'
  ].join(' ')
}
