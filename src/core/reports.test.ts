/**
 * Taxonomia e efeitos de "reportar conteúdo ruim" (M5) — o contrato entre o botão
 * do renderer e o efeito no processo main.
 */
import { describe, expect, it } from 'vitest'
import {
  REASONS_BY_KIND,
  REPORT_KINDS,
  REPORT_REASONS,
  effectFor,
  isReportKind,
  isReportReason,
  reasonFor
} from './reports'
import { snapshotText } from './reports'

describe('taxonomia', () => {
  it('todo tipo tem motivos, e todo motivo é válido', () => {
    for (const kind of REPORT_KINDS) {
      const reasons = REASONS_BY_KIND[kind]
      expect(reasons.length, kind).toBeGreaterThan(1)
      for (const reason of reasons) {
        expect(REPORT_REASONS, `${kind}.${reason}`).toContain(reason)
      }
    }
  })

  it('guardas rejeitam valores que não existem', () => {
    expect(isReportKind('exercise')).toBe(true)
    expect(isReportKind('vibe')).toBe(false)
    expect(isReportReason('broken_text')).toBe(true)
    expect(isReportReason('eu não gostei')).toBe(false)
  })

  it('motivo inválido para o tipo cai no primeiro motivo válido', () => {
    // "gabarito errado" num roleplay não tem efeito: o report vira o motivo
    // padrão daquele alvo em vez de travar a interface.
    expect(reasonFor('scenario', 'wrong_answer')).toBe(REASONS_BY_KIND.scenario[0])
    expect(reasonFor('exercise', 'wrong_answer')).toBe('wrong_answer')
    expect(reasonFor('correction', 'unfair_correction')).toBe('unfair_correction')
  })
})

describe('efeitos', () => {
  it('os três alvos com efeito imediato', () => {
    expect(effectFor('exercise')).toBe('exercise-removed')
    expect(effectFor('lesson_content')).toBe('content-regenerates')
    expect(effectFor('correction')).toBe('error-unfocused')
  })

  it('o resto é registrado, sem prometer mágica', () => {
    expect(effectFor('scenario')).toBe('logged')
    expect(effectFor('track_plan')).toBe('logged')
    expect(effectFor('chat_reply')).toBe('logged')
  })
})

describe('recorte do registro', () => {
  it('guarda texto não vazio e corta o gigante', () => {
    expect(snapshotText('   ')).toBeNull()
    expect(snapshotText(null)).toBeNull()
    expect(snapshotText('I am agree')).toBe('I am agree')
    expect(snapshotText('x'.repeat(300))?.length).toBe(241)
  })
})
