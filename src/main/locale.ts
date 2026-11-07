/**
 * Ponte perfil → M4 (M4). Todo módulo do processo main que gera conteúdo ou
 * corrige texto precisa do par de idiomas do aluno; nada aqui conhece IA ou UI.
 */
import { interferenceRulesFor, hasInterferenceBank, type InterferenceRule } from '../core/interference'
import { languageMeta, tokenize as tokenizeText, type LanguageMeta, type PromptLocale } from '../core/languages'
import { promptLocale } from '../core/prompts'
import { getDefaultProfile } from './db'

export function profileLocale(): PromptLocale {
  const profile = getDefaultProfile()
  return promptLocale(profile.targetLang, profile.nativeLang)
}

/**
 * Idioma das explicações do perfil (M5): o idioma em que o main escreve texto
 * de runtime — rótulos de intervalo do FSRS, recapitulação de fechamento,
 * cards e mensagens de erro.
 */
export function profileNativeLang(): string {
  return getDefaultProfile().nativeLang
}

export function profileTargetMeta(): LanguageMeta {
  return languageMeta(getDefaultProfile().targetLang)
}

/** Regras do banco manual para o par do perfil; [] = correção fica toda com a IA. */
export function profileInterferenceRules(): InterferenceRule[] {
  const profile = getDefaultProfile()
  return interferenceRulesFor(profile.targetLang, profile.nativeLang)
}

export function profileHasBank(): boolean {
  const profile = getDefaultProfile()
  return hasInterferenceBank(profile.targetLang, profile.nativeLang)
}

/** Segmenta texto no idioma-alvo (espaço ou CJK via Intl.Segmenter). */
export function tokenizeTarget(text: string): string[] {
  return tokenizeText(text, getDefaultProfile().targetLang)
}
