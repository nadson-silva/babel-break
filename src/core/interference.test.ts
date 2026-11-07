import { describe, expect, it } from 'vitest'
import {
  INTERFERENCE_BANK,
  PT_ES_INTERFERENCE_BANK,
  bankEntries,
  detectInterference,
  hasInterferenceBank,
  interferenceRulesFor,
  recast
} from './interference'

/**
 * O banco precisa pegos os exemplos do plano (§8, "banco de interferência PT-BR").
 * Se uma regra quebrar, a correção offline do tutor quebra junto.
 */
describe('banco de interferência PT-BR', () => {
  it('tem pelo menos 20 pares escritos à mão', () => {
    expect(bankEntries().length).toBeGreaterThanOrEqual(20)
    for (const entry of bankEntries()) {
      expect(entry.tag).toMatch(/^[a-z0-9-]+$/)
      expect(entry.wrong.length).toBeGreaterThan(3)
      expect(entry.right.length).toBeGreaterThan(3)
      expect(entry.note.length).toBeGreaterThan(8)
    }
  })

  it.each([
    ['I have 25 years.', 'have-vs-be'],
    ["I'm agree with you.", 'stative-verbs'],
    ['Explain me this error.', 'verb-preposition'],
    ['People is talking about it.', 'subject-verb-agreement'],
    ["I didn't went there.", 'past-simple'],
    ['I want to make a question.', 'collocation'],
    ["I'm boring today.", 'participle-adjective'],
    ['I am developer.', 'articles'],
    ['Where you are from?', 'question-word-order'],
    ['I live here since two years.', 'since-for'],
    ["I don't know nothing about it.", 'double-negative'],
    ['This is more better.', 'comparative'],
    ['We have less people here.', 'quantifier'],
    ['I work in Monday.', 'prepositions'],
    ['It depends of the client.', 'verb-preposition'],
    ['Thank you for the informations.', 'uncountable-noun'],
    ['My girlfriend is a dev, his name is Ana.', 'pronoun-gender']
  ])('detecta "%s" como %s', (sentence, tag) => {
    const hits = detectInterference(sentence)
    expect(hits.map((hit) => hit.tag)).toContain(tag)
  })

  it('reconstrói a frase inteira no recast determinístico', () => {
    const output = recast("I have 25 years and I am developer. I didn't went yesterday.")
    expect(output).toContain('I am 25 years old')
    expect(output).toContain('a developer')
    expect(output).toContain("didn't go")
    expect(output).not.toMatch(/\bhave 25 years\b/)
  })

  it('preserva a maiúscula de início de frase', () => {
    expect(recast('People is talking.')).toMatch(/^People are/)
  })

  it('não inventa erro em frase correta', () => {
    expect(detectInterference('I am a developer and I work with a great team.')).toHaveLength(0)
    expect(detectInterference('She is bored because the meeting was long.')).toHaveLength(0)
  })

  it('anota falsos cognatos sem reescrever automaticamente', () => {
    const hits = detectInterference('I presume so and I pretend to work abroad.')
    expect(hits.filter((hit) => hit.advisory).map((hit) => hit.tag)).toContain('false-cognate')
  })
})

/**
 * M4: o banco é uma implementação de correção *por par*. O PT-BR→espanhol é o
 * fixture que prova a abstração; pares sem banco delegado inteiro para a IA.
 */
describe('bancos por par (M4)', () => {
  const esRules = interferenceRulesFor('es', 'pt-BR')

  it('resolve o banco por par, com e sem região', () => {
    expect(interferenceRulesFor('en', 'pt-BR').length).toBeGreaterThanOrEqual(20)
    expect(interferenceRulesFor('en-US', 'pt-BR')).toBe(interferenceRulesFor('en', 'pt-BR'))
    expect(interferenceRulesFor('es', 'pt')).toBe(esRules)
    expect(esRules.length).toBeGreaterThanOrEqual(8)
    expect(hasInterferenceBank('es', 'pt-BR')).toBe(true)
  })

  it('sem banco para o par: nada é detectado, a IA assume', () => {
    expect(interferenceRulesFor('ja', 'pt-BR')).toEqual([])
    expect(hasInterferenceBank('ja', 'pt-BR')).toBe(false)
    expect(detectInterference('I have 25 years.', [])).toEqual([])
    expect(bankEntries([])).toEqual([])
    expect(recast('I have 25 years.', [])).toBe('I have 25 years.')
  })

  it.each([
    ['Estoy em casa.', 'prepositions'],
    ['Eu trabajo con equipos remotos.', 'subject-pronoun'],
    ['Tengo muito trabajo.', 'vocabulary'],
    ['Não entiendo la pregunta.', 'vocabulary'],
    ['Yo também quiero practicar.', 'accents'],
    ['El ano pasado viajé.', 'false-cognate'],
    ['Tem muchos problemas.', 'existential-hay'],
    ['Espero por tu respuesta.', 'verb-preposition']
  ])('detecta "%s" como %s em espanhol', (sentence, tag) => {
    const hits = detectInterference(sentence, esRules)
    expect(hits.map((hit) => hit.tag)).toContain(tag)
  })

  it('reescreve a frase inteira no recast do banco espanhol', () => {
    const output = recast('Estoy em casa porque eu trabajo muito.', esRules)
    expect(output).toContain('en casa')
    expect(output).toContain('yo trabajo mucho')
    expect(output).not.toMatch(/\bem\b/)
    expect(output).not.toContain('muito')
  })

  it('embarazada é advisory: anota, não reescreve no lugar do modelo', () => {
    const hits = detectInterference('Estoy embarazada de hablar en público.', esRules)
    expect(hits.some((hit) => hit.advisory && hit.tag === 'false-cognate')).toBe(true)
  })

  it('não confunde as regras dos dois bancos', () => {
    // frase correta em espanhol não acende regra do banco de inglês
    expect(detectInterference('No entiendo la pregunta, espero a tu respuesta.')).toHaveLength(0)
    // e vice-versa
    expect(detectInterference('I am a developer and I work from home.', esRules)).toHaveLength(0)
  })

  it('todas as regras do banco espanhol têm fixture e tag kebab-case', () => {
    for (const entry of bankEntries(PT_ES_INTERFERENCE_BANK)) {
      expect(entry.tag).toMatch(/^[a-z0-9-]+$/)
      expect(entry.wrong.length).toBeGreaterThan(3)
      expect(entry.right.length).toBeGreaterThan(3)
      expect(entry.note.length).toBeGreaterThan(8)
    }
  })
})

/**
 * M6 (B4): testes de falso positivo por regra — o `right` canônico de cada
 * regra é inglês/espanhol CORRETO e não pode acender a própria regra (nem
 * outra). E a inversão de pergunta só vale em pergunta DIRETA: embutida, a
 * ordem declarativa é gramatical.
 */
describe('banco sem falso positivo (M6/B4)', () => {
  it('nenhuma re-grava sua própria forma canônica (banco EN)', () => {
    for (const rule of INTERFERENCE_BANK) {
      const hits = detectInterference(rule.right)
      expect(hits.map((hit) => hit.ruleId), `${rule.id} em "${rule.right}"`).not.toContain(rule.id)
    }
  })

  it('nenhuma re-grava sua própria forma canônica (banco ES)', () => {
    for (const rule of PT_ES_INTERFERENCE_BANK) {
      const hits = detectInterference(rule.right, PT_ES_INTERFERENCE_BANK)
      expect(hits.map((hit) => hit.ruleId), `${rule.id} em "${rule.right}"`).not.toContain(rule.id)
    }
  })

  it('pergunta embutida correta não é reescrita', () => {
    expect(detectInterference('I know where he is.')).toHaveLength(0)
    expect(detectInterference('Tell me what you can do.')).toHaveLength(0)
    expect(recast('I know where he is.')).toBe('I know where he is.')
    expect(recast('I wonder what she wants.')).toBe('I wonder what she wants.')
  })

  it('pergunta diretainvertida continua sendo consertada', () => {
    const hits = detectInterference('Where you are from?')
    expect(hits.some((hit) => hit.ruleId === 'question-word-order')).toBe(true)
    expect(recast('Where you are from?')).toBe('Where are you from?')
    // Depois de pontuação também é borda de frase.
    expect(recast('Hi. Where you are going?')).toBe('Hi. Where are you going?')
  })
})
