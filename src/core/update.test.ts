/**
 * V2 — comparação de versão (o "auto-update honesto": informar, não instalar).
 */
import { describe, expect, it } from 'vitest'
import { compareSemver, isNewer, parseSemver, readRelease } from './update'

describe('parseSemver', () => {
  it('aceita com ou sem "v" e ignora resto', () => {
    expect(parseSemver('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: '' })
    expect(parseSemver(' 0.1.0-rc.1 ')).toMatchObject({ major: 0, patch: 0, pre: 'rc.1' })
    expect(parseSemver('1.2')).toBeNull()
    expect(parseSemver('latest')).toBeNull()
    expect(parseSemver(null)).toBeNull()
  })
})

describe('compareSemver', () => {
  it('ordena major > minor > patch', () => {
    const a = parseSemver('1.0.0')
    const b = parseSemver('1.0.1')
    const c = parseSemver('1.1.0')
    const d = parseSemver('2.0.0')
    expect(a && b && compareSemver(a, b)).toBe(-1)
    expect(b && c && compareSemver(b, c)).toBe(-1)
    expect(c && d && compareSemver(c, d)).toBe(-1)
    expect(a && compareSemver(a, { ...a })).toBe(0)
  })

  it('prerelease é anterior ao estável', () => {
    const pre = parseSemver('1.2.3-rc.1')
    const stable = parseSemver('1.2.3')
    expect(pre && stable && compareSemver(pre, stable)).toBe(-1)
    expect(pre && stable && compareSemver(stable, pre)).toBe(1)
  })
})

describe('isNewer', () => {
  it('só diz "nova" quando é maior de verdade', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.0.9', '0.1.0')).toBe(false)
    expect(isNewer('v1.0.0', '0.9.9')).toBe(true)
  })

  it('string podre não vira alerta falso', () => {
    expect(isNewer('garbage', '0.1.0')).toBe(false)
    expect(isNewer('0.2.0', undefined)).toBe(false)
    expect(isNewer(null, '0.1.0')).toBe(false)
  })
})

describe('readRelease', () => {
  it('lê o mínimo que a UI precisa', () => {
    const info = readRelease({
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/x/releases/tag/v0.2.0',
      body: 'notas',
      published_at: '2026-11-01T00:00:00Z'
    })
    expect(info).toMatchObject({
      tag: 'v0.2.0',
      version: '0.2.0',
      url: 'https://github.com/x/releases/tag/v0.2.0',
      notes: 'notas',
      publishedAt: '2026-11-01T00:00:00Z'
    })
  })

  it('resposta sem tag ou sem link não é release utilizável', () => {
    expect(readRelease({ tag_name: 'v1.0.0' })).toBeNull()
    expect(readRelease({ html_url: 'https://x' })).toBeNull()
    expect(readRelease(null)).toBeNull()
    expect(readRelease('não')).toBeNull()
  })

  it('trunca as notas (elas viram texto de tela, não despejo)', () => {
    const info = readRelease({ tag_name: 'v1.0.0', html_url: 'https://x', body: 'a'.repeat(20_000) })
    expect(info?.notes.length).toBeLessThanOrEqual(4_000)
  })
})
