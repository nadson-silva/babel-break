/**
 * V2 (D8): a lista de idiomas da **interface** mora em `shared/` porque os dois
 * lados do app precisam dela: o renderer a usa para os chips de Configurações, e
 * o processo main a usa para garantir que a UI nunca oferece um idioma cujo
 * texto de runtime (card, recapitulação, erro de geração, rótulo de revisão) ele
 * não sabe escrever. Teste em `src/core/runtime-text.test.ts`.
 */
export interface UiLanguage {
  code: string
  label: string
}

export const UI_LANGUAGES: UiLanguage[] = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en', label: 'English' }
]
