import { describe, expect, it } from 'vitest'
import {
  LANGUAGES,
  deterministicContentSupported,
  isRtl,
  languageMeta,
  languageSeedRows,
  tokenize,
  tokenizationOf
} from './languages'

/**
 * O registro de idiomas (M4) é o que permite ao app ensinar qualquer idioma
 * sem tratar tudo como se fosse inglês: direção de escrita, segmentação e
 * notas de prompt vêm daqui.
 */
describe('registro de idiomas', () => {
  it('tem códigos únicos com metadados completos', () => {
    const codes = LANGUAGES.map((entry) => entry.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const entry of LANGUAGES) {
      expect(entry.code).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/)
      expect(entry.name.length).toBeGreaterThan(2)
      expect(entry.nativeName.length).toBeGreaterThan(1)
      expect(entry.promptName.length).toBeGreaterThan(2)
      expect(['ltr', 'rtl']).toContain(entry.scriptDirection)
      expect(['space', 'cjk']).toContain(entry.tokenization)
    }
  })

  it('resolve códigos com região e nunca quebra em código desconhecido', () => {
    expect(languageMeta('en-GB').promptName).toBe('inglês')
    expect(languageMeta('zh-TW').tokenization).toBe('cjk')
    expect(languageMeta('pt-br'.toUpperCase()).code).toBe('pt-BR')
    expect(languageMeta(null).code).toBe('und')
    expect(languageMeta('klingon').promptName).toBe('klingon') // devolve o que recebeu
  })

  it('marca RTL e CJK nos idiomas certos', () => {
    for (const code of ['ar', 'he', 'fa']) {
      expect(isRtl(code), code).toBe(true)
      expect(tokenizationOf(code), code).toBe('space')
    }
    for (const code of ['ja', 'ko', 'zh']) {
      expect(tokenizationOf(code), code).toBe('cjk')
      expect(isRtl(code), code).toBe(false)
    }
    expect(isRtl('en')).toBe(false)
  })

  it('carrega notas de prompt por idioma (tu/usted, keigo, MSA)', () => {
    expect(languageMeta('es').promptNotes).toMatch(/tú\/usted/)
    expect(languageMeta('ja').promptNotes).toMatch(/desu\/masu/)
    expect(languageMeta('ar').promptNotes).toMatch(/MSA/)
    expect(languageMeta('en').promptNotes ?? '').toBe('')
  })

  it('restringe o gerador determinístico ao idioma-fixture', () => {
    expect(deterministicContentSupported('en')).toBe(true)
    expect(deterministicContentSupported('en-GB')).toBe(true)
    expect(deterministicContentSupported('ja')).toBe(false)
    expect(deterministicContentSupported('es')).toBe(false)
  })

  it('semeia a tabela languages do banco', () => {
    const rows = languageSeedRows()
    expect(rows.length).toBe(LANGUAGES.length)
    expect(rows.find((row) => row.code === 'ar')?.scriptDirection).toBe('rtl')
    expect(rows.find((row) => row.code === 'ja')?.tokenization).toBe('cjk')
  })
})

describe('tokenização CJK (Intl.Segmenter)', () => {
  it('segmenta japonês em palavras, não em espaços', () => {
    const units = tokenize('私は毎日日本語を勉強します', 'ja')
    expect(units.length).toBeGreaterThanOrEqual(3)
    expect(units.join('')).toBe('私は毎日日本語を勉強します')
    expect(units).toContain('日本語')
  })

  it('segmenta chinês', () => {
    const units = tokenize('我每天学习中文', 'zh')
    expect(units.length).toBeGreaterThanOrEqual(2)
    expect(units.join('')).toBe('我每天学习中文')
  })

  it('mantiene a separação por espaço nos demais idiomas', () => {
    expect(tokenize('I study every day', 'en')).toEqual(['I', 'study', 'every', 'day'])
    expect(tokenize('Aprendo español cada día', 'es')).toHaveLength(4)
    expect(tokenize('  ', 'en')).toEqual([])
  })
})
