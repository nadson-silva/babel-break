/**
 * Idioma-alvo em runtime (M4) — o espelho renderer do `profile.targetLang`.
 *
 * O App é o único dono do estado: ao carregar/receber perfil e registro de
 * idiomas, ele chama `applyRuntimeLanguages`. Os componentes leem daqui para
 * marcar `lang`/`dir` no texto do idioma ensinado (RTL/CJK) e para interpolar
 * o nome do idioma nos textos da interface ("Escreva em {lang}…").
 */
import type { LanguageOption } from '../../shared/types'
import { languageLabel } from './i18n'

let targetCode = 'en'
let nativeCode = 'pt-BR'
let registry: LanguageOption[] | null = null

export function setLanguageOptions(options: LanguageOption[]): void {
  registry = options
}

export function languageOptions(): LanguageOption[] {
  return registry ?? []
}

export function setTargetLanguage(code: string | null | undefined): void {
  const wanted = (code ?? 'en').trim()
  targetCode = wanted || 'en'
}

export function setNativeLanguage(code: string | null | undefined): void {
  const wanted = (code ?? 'pt-BR').trim()
  nativeCode = wanted || 'pt-BR'
}

export function targetLanguage(): string {
  return targetCode
}

export function nativeLanguage(): string {
  return nativeCode
}

/** 'PT-BR→EN' — rótulo compacto do par, para badges e títulos de banco. */
export function pairCodeLabel(): string {
  return `${nativeCode.toUpperCase()}→${targetCode.toUpperCase()}`
}

export function targetOption(): LanguageOption | null {
  if (!registry) return null
  const lower = targetCode.toLowerCase()
  return (
    registry.find((entry) => entry.code.toLowerCase() === lower) ??
    registry.find((entry) => entry.code.toLowerCase().split('-')[0] === lower.split('-')[0]) ??
    null
  )
}

export function targetIsRtl(): boolean {
  return targetOption()?.scriptDirection === 'rtl'
}

/** CJK: a resposta de "ordene a frase" se monta sem espaços entre unidades. */
export function targetIsCjk(): boolean {
  return targetOption()?.tokenization === 'cjk'
}

/** Nome do idioma-alvo na língua da interface (ou de um código específico). */
export function targetLabel(code?: string | null): string {
  return languageLabel(code ?? targetCode, registry)
}

/** Nome do idioma nativo (explicações) na língua da interface. */
export function nativeLabel(code?: string | null): string {
  return languageLabel(code ?? nativeCode, registry)
}
