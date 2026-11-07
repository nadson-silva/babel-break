import { describe, expect, it } from 'vitest'
import { bankEntries, detectInterference, recast } from './interference'

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
