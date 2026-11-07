/**
 * Integração do M4 (sem IA e sem GUI): perfil em espanhol e em japonês
 * atravessando banco de interferência, caderno, tabela `languages` e as
 * portas de degradação do gerador offline.
 *
 * Roda com o stub de `electron` (vitest.config.mts) — sem modelo configurado,
 * nada aqui gasta token; é exatamente o caminho offline que precisa ser
 * honesto por idioma.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { bankCorrections } from '../core/correction'
import { deterministicContentSupported } from '../core/languages'
import { interferenceRulesFor } from '../core/interference'
import { getDb, initDatabase, schema } from './db'
import { completeOnboarding, readLessonContent } from './learning'
import { focusFor, notebookView, recordCorrections } from './notebook'
import { generateCurriculum } from './learning'

let profileId = 0

beforeAll(() => {
  initDatabase()
})

describe('tabela languages (metadados no banco)', () => {
  it('é semeada a partir do registro do core', () => {
    const rows = getDb().select().from(schema.languages).all()
    expect(rows.length).toBeGreaterThanOrEqual(15)

    const arabic = rows.find((row) => row.code === 'ar')
    expect(arabic?.scriptDirection).toBe('rtl')

    const japanese = rows.find((row) => row.code === 'ja')
    expect(japanese?.tokenization).toBe('cjk')
    expect(japanese?.promptNotes).toContain('desu/masu')
  })
})

describe('onboarding em espanhol (par com banco manual)', () => {
  beforeAll(() => {
    const state = completeOnboarding({
      goal: 'viajar pela américa do sul',
      cefr: 'A2',
      targetLang: 'es',
      nativeLang: 'pt-BR'
    })
    profileId = state.profile.id
  })

  it('persiste o par de idiomas no perfil', () => {
    const view = getDb()
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, profileId))
      .get()
    expect(view?.targetLang).toBe('es')
    expect(view?.nativeLang).toBe('pt-BR')
  })

  it('recusa trocar o idioma depois do onboarding concluído', () => {
    expect(() => completeOnboarding({ goal: 'mudar de idioma', cefr: 'B1', targetLang: 'ja' })).toThrow(
      /primeiro onboarding/
    )
  })

  it('corrige offline com o banco PT-BR → ES', () => {
    const rules = interferenceRulesFor('es', 'pt-BR')
    expect(rules.length).toBeGreaterThan(0)

    const corrections = bankCorrections('Estoy em casa porque eu trabajo mucho.', rules)
    expect(corrections.length).toBeGreaterThanOrEqual(2)

    const recorded = recordCorrections(profileId, corrections, {
      category: 'conversation',
      context: 'conversa livre'
    })
    expect(recorded).toBeGreaterThan(0)
  })

  it('caderno reporta o par do banco e ancora o foco nele', () => {
    const view = notebookView(profileId)
    expect(view.bankPair).toEqual({ native: 'pt-BR', target: 'es' })
    expect(view.bank.length).toBeGreaterThanOrEqual(8)
    expect(view.bankHits).toBeGreaterThan(0)

    const focus = focusFor(profileId, 6)
    expect(focus.some((entry) => entry.source === 'bank')).toBe(true)
    // tags do banco ES (e não as do banco EN) aparecem no foco
    const tags = focus.map((entry) => entry.tag)
    expect(tags.some((tag) => ['subject-pronoun', 'existential-hay', 'accents'].includes(tag))).toBe(true)
    expect(tags).not.toContain('have-vs-be')
  })

  it('offline sem fixture de espanhol: gera erro claro, não conteúdo de inglês', () => {
    expect(deterministicContentSupported('es')).toBe(false)
  })
})

describe('par sem banco manual (japonês)', () => {
  beforeAll(() => {
    // Simula um perfil ja 'de fábrica' direto no banco (a UI só permite isso no
    // primeiro onboarding — o teste exercita o estado, não a porta de entrada).
    getDb()
      .update(schema.profiles)
      .set({ targetLang: 'ja', nativeLang: 'pt-BR' })
      .where(eq(schema.profiles.id, profileId))
      .run()
  })

  it('banco vazio: correção determinística não inventa nada', () => {
    expect(interferenceRulesFor('ja', 'pt-BR')).toEqual([])
    expect(bankCorrections('Estoy em casa.', [])).toEqual([])
  })

  it('UI do caderno sabe que a correção é por IA', () => {
    const view = notebookView(profileId)
    expect(view.bankPair).toBeNull()
    expect(view.bank).toEqual([])
  })

  it('currículo offline se recusa a gerar japonês como se fosse inglês', async () => {
    await expect(generateCurriculum()).rejects.toThrow(/configure um provedor/i)
  })
})

describe('legado: conteúdo salvo antes do M4', () => {
  it('exemplos {en, pt} viram {target, native} sem quebrar a lição', () => {
    const legacy = JSON.stringify({
      title: 'Artigos',
      level: 'A1',
      objective: 'usar a/an/the',
      explanation: 'Profissão pede artigo.',
      examples: [{ en: 'I am a developer.', pt: 'Eu sou desenvolvedor.' }],
      grammarPoints: [{ title: 'a/an', explanation: '...', examples: ['I am a developer.'] }],
      vocabulary: [{ term: 'developer', translation: 'desenvolvedor', example: 'I am a developer.' }]
    })

    const content = readLessonContent(legacy)
    expect(content?.examples[0]).toEqual({ target: 'I am a developer.', native: 'Eu sou desenvolvedor.' })
    expect(readLessonContent('{"sem": "exemplos"}')?.examples).toEqual([])
    expect(readLessonContent(null)).toBeNull()
  })
})
