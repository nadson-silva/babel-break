import { describe, expect, it } from 'vitest'
import { DICTIONARIES_TEST, ptBR, en, dictionaryFor, setUiLanguage, getUiLanguage, t, UI_LANGUAGES } from './index'

/**
 * "Interface traduzível" (M4) tem um contrato: os dicionários precisam ter as
 * MESMAS chaves, em qualquer nível. Uma string esquecida em `en.ts` aparece
 * aqui, não em produção.
 */
function keysOf(value: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, entry] of Object.entries(value)) {
    const path = `${prefix}${key}`
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      keys.push(...keysOf(entry as Record<string, unknown>, `${path}.`))
    } else {
      keys.push(path)
    }
  }
  return keys.sort()
}

describe('paridade de dicionários', () => {
  it('en tem exatamente as mesmas chaves de pt-BR', () => {
    const expected = keysOf(ptBR as unknown as Record<string, unknown>)
    const actual = keysOf(en as unknown as Record<string, unknown>)
    expect(actual).toEqual(expected)
  })

  it('traduções são distintas do original onde importa', () => {
    expect(en.app.tagline).not.toBe(ptBR.app.tagline)
    expect(en.settings.title).not.toBe(ptBR.settings.title)
    // listas mantêm o mesmo tamanho (suggestions de tutor/onboarding)
    expect(en.tutor.suggestions).toHaveLength(ptBR.tutor.suggestions.length)
    expect(en.onboarding.goalSuggestions).toHaveLength(ptBR.onboarding.goalSuggestions.length)
  })

  it('interpoladores obrigatórios sobrevivem à tradução', () => {
    expect(en.tutor.placeholder).toContain('{lang}')
    expect(en.player.answerPlaceholder).toContain('{lang}')
    expect(en.player.pitfalls).toContain('{native}')
    expect(en.notebook.bankTitle).toContain('{pair}')
    expect(en.onboarding.goalSuggestions.join(' ')).toContain('{lang}')
    expect(ptBR.onboarding.stepLevel).toContain('{lang}')
    expect(ptBR.player.typeTranslate).toContain('{lang}')
  })

  it('ambos os idiomas registram nomes para todos os códigos do app', () => {
    for (const code of ['en', 'es', 'ja', 'ar', 'zh', 'pt-BR']) {
      expect(ptBR.languages.names[code as keyof typeof ptBR.languages.names]).toBeTruthy()
      expect(en.languages.names[code as keyof typeof en.languages.names]).toBeTruthy()
    }
  })
})

describe('troca de idioma em runtime', () => {
  it('t lê do dicionário ativo e o default resiste a código desconhecido', () => {
    const initial = getUiLanguage()
    try {
      setUiLanguage('en')
      expect(t.nav.settings).toBe(en.nav.settings)
      expect(t.languages.targetTitle).toBe(en.languages.targetTitle)

      expect(setUiLanguage('klingon')).toBe('pt-BR')
      expect(t.nav.settings).toBe(ptBR.nav.settings)

      expect(setUiLanguage('pt-BR')).toBe('pt-BR')
      expect(t.app.tagline).toBe(ptBR.app.tagline)
    } finally {
      setUiLanguage(initial)
    }
  })

  it('dictionaryFor e UI_LANGUAGES batem', () => {
    for (const language of UI_LANGUAGES) {
      expect(Object.keys(DICTIONARIES_TEST)).toContain(language.code)
      expect(dictionaryFor(language.code)).toBeTruthy()
    }
  })
})
