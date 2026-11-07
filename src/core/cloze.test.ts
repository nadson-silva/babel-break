import { describe, expect, it } from 'vitest'
import { clarifyCloze } from './cloze'

const vocabulary = [
  { term: 'tricky', translation: 'delicada', example: 'It is a tricky situation.' },
  { term: 'work', translation: 'trabalhar', example: 'She works from home.' }
]

describe('clarifyCloze', () => {
  it('injeta a tradução esperada logo após o vão', () => {
    const prompt = clarifyCloze('It is a ___ situation for this scenario.', 'tricky', vocabulary)
    expect(prompt).toBe('It is a ___ (delicada) situation for this scenario.')
  })

  it('casa flexões do termo ("works" responde por "work")', () => {
    const prompt = clarifyCloze('She ___ from home.', 'works', vocabulary)
    expect(prompt).toContain('___ (trabalhar)')
  })

  it('não duplica quando o enunciado já traz a dica', () => {
    const withHint = 'It is a ___ (delicada) situation.'
    expect(clarifyCloze(withHint, 'tricky', vocabulary)).toBe(withHint)
  })

  it('deixa o prompt intacto quando a palavra não está no vocabulário', () => {
    expect(clarifyCloze('He runs very ___.', 'fast', vocabulary)).toBe('He runs very ___.')
  })

  it('ignora prompts sem vão', () => {
    expect(clarifyCloze('No gap here.', 'tricky', vocabulary)).toBe('No gap here.')
  })
})
