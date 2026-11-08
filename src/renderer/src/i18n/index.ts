/**
 * i18n da interface (M4).
 *
 * O formato é definido por `pt-BR.ts` (a interface original do app); cada novo
 * idioma é um objeto `Dictionary` completo — o typecheck do `en.ts` é o teste
 * de paridade. O `t` exportado é um proxy para o dicionário ativo: os
 * componentes mantêm `t.x.y` simples e a troca de idioma re-renderiza a árvore
 * a partir do App (única fonte de estado de settings/perfil).
 */
import { ptBR } from './pt-BR'
import { en } from './en'
import type { LanguageOption } from '../../../shared/types'
export type Dictionary = typeof ptBR

// V2 (D8): a lista vive em `shared/` para o main poder checá-la contra o próprio
// dicionário de runtime; o renderer reexporta para os imports existentes.
export { UI_LANGUAGES } from '../../../shared/i18n-languages'
export type { UiLanguage } from '../../../shared/i18n-languages'

const DICTIONARIES: Record<string, Dictionary> = {
  'pt-BR': ptBR,
  en
}

/** Visível para teste: os idiomas que a interface tem, de fato. */
export const DICTIONARIES_TEST = DICTIONARIES

const DEFAULT_UI_LANG = 'pt-BR'

let activeCode = DEFAULT_UI_LANG

export function dictionaryFor(code: string | null | undefined): Dictionary {
  return DICTIONARIES[(code ?? '').trim()] ?? (DICTIONARIES[DEFAULT_UI_LANG] as Dictionary)
}

/** Idioma atualmente em uso nos textos da interface. */
export function getUiLanguage(): string {
  return activeCode
}

/** Ativa o idioma (com fallback silencioso para PT-BR). Retorna o código ativo. */
export function setUiLanguage(code: string | null | undefined): string {
  const next = DICTIONARIES[(code ?? '').trim()] ? (code ?? '').trim() : DEFAULT_UI_LANG
  activeCode = next
  return next
}

/**
 * Proxy de dicionário: `t.nav.home` lê do dicionário ativo no momento do
 * render — sem contexto React em cada componente e sem `useT()` em todo lugar.
 */
export const t: Dictionary = new Proxy(
  {},
  {
    get: (_target, key) => dictionaryFor(activeCode)[key as keyof Dictionary],
    ownKeys: () => Reflect.ownKeys(dictionaryFor(activeCode)),
    getOwnPropertyDescriptor: (_target, key) =>
      Reflect.getOwnPropertyDescriptor(dictionaryFor(activeCode), key)
  }
) as unknown as Dictionary

/** Rótulo do idioma-alvo na língua da interface (nomes próprios têm precedência). */
export function languageLabel(
  code: string | null | undefined,
  registry: LanguageOption[] | null
): string {
  const wanted = (code ?? '').trim()
  const fromDict = (t.languages.names as Record<string, string | undefined>)[wanted]
  if (fromDict) return fromDict

  const base = wanted.toLowerCase().split('-')[0] ?? ''
  const fromDictBase = (t.languages.names as Record<string, string | undefined>)[base]
  if (fromDictBase) return fromDictBase

  const option = registry?.find((entry) => entry.code.toLowerCase() === wanted.toLowerCase())
  return option?.name ?? (wanted || '—')
}

/** Nome exibido no seletor: sempre o nome próprio do idioma ('日本語', 'English'). */
export function languagePickerLabel(option: LanguageOption): string {
  return option.nativeName || option.name || option.code
}

export { ptBR, en }
