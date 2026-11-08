/**
 * V2 — lembrete: as regras que fazem dele um convite e não uma cobrança.
 */
import { describe, expect, it } from 'vitest'
import type { ReminderSettings } from './reminders'
import {
  DEFAULT_REMINDER,
  describeSchedule,
  formatMinuteOfDay,
  isReminderDue,
  nextReminderAt,
  parseDays,
  parseMinuteOfDay,
  todaysSlot
} from './reminders'

const days = (settings: Partial<ReminderSettings> = {}) => ({
  ...DEFAULT_REMINDER,
  enabled: true,
  days: [1, 2, 3, 4, 5],
  ...settings
})

/** Uma quarta-feira 10:00 local. */
function wednesdayMorning(): Date {
  const date = new Date(2026, 10, 4, 10, 0, 0) // 4/11/2026 = quarta
  expect(date.getDay()).toBe(3)
  return date
}

describe('parse', () => {
  it('aceita dias válidos, descarta o resto e ordena sem duplicar', () => {
    expect(parseDays([5, 1, '1', 9, -2, null, 3])).toEqual([1, 3, 5])
    expect(parseDays('segunda')).toEqual([])
  })

  it('entende HH:MM e número de minutos, com recorte', () => {
    expect(parseMinuteOfDay('08:30', 0)).toBe(510)
    expect(parseMinuteOfDay('24:00', 510)).toBe(510)
    expect(parseMinuteOfDay('7:5', 0)).toBe(425)
    expect(parseMinuteOfDay(1_999, 0)).toBe(24 * 60 - 1)
    expect(parseMinuteOfDay(undefined, 100)).toBe(100)
  })

  it('formata de volta para o input de hora', () => {
    expect(formatMinuteOfDay(510)).toBe('08:30')
    expect(formatMinuteOfDay(0)).toBe('00:00')
  })
})

describe('janela e disparo', () => {
  it('sem dias, nunca há janela', () => {
    const off = { ...days(), days: [] }
    expect(todaysSlot(off, wednesdayMorning())).toBeNull()
    expect(nextReminderAt(off, wednesdayMorning())).toBeNull()
    expect(isReminderDue(off, wednesdayMorning(), null, 10)).toBe(false)
  })

  it('desligado = nada, nem com fila enorme', () => {
    expect(isReminderDue({ ...days(), enabled: false }, wednesdayMorning(), null, 50)).toBe(false)
  })

  it('só notifica quando existe algo para fazer', () => {
    const at = todaysSlot(days({ minuteOfDay: 9 * 60 }), wednesdayMorning()) as number
    expect(at).toBeLessThan(wednesdayMorning().getTime())
    expect(isReminderDue(days({ minuteOfDay: 9 * 60 }), wednesdayMorning(), null, 0)).toBe(false)
    expect(isReminderDue(days({ minuteOfDay: 9 * 60 }), wednesdayMorning(), null, 4)).toBe(true)
  })

  it('uma janela dispara uma vez, não importa quantas batidas', () => {
    const settings = days({ minuteOfDay: 9 * 60 })
    const now = wednesdayMorning()
    const slot = todaysSlot(settings, now) as number
    expect(isReminderDue(settings, now, slot - 1, 3)).toBe(true)
    expect(isReminderDue(settings, now, slot, 3)).toBe(false)
    expect(isReminderDue(settings, now, slot + 1_000, 3)).toBe(false)
  })

  it('acordar o app na quinta não dispara o lembrete atrasado de segunda', () => {
    const thursday = new Date(2026, 10, 5, 10, 0, 0)
    // Última vez que disparou foi na segunda às 09:00, e hoje quinta ainda não é 09:00?
    // É 10:00 → a janela de hoje *é* devida (dias incluem quinta): o que não pode
    // acontecer é disparar a de segunda de novo.
    const settings = days({ minuteOfDay: 9 * 60 })
    const mondayFire = new Date(2026, 10, 2, 9, 0, 0).getTime()
    expect(isReminderDue(settings, thursday, mondayFire, 2)).toBe(true)

    const thursdaySlot = todaysSlot(settings, thursday) as number
    expect(isReminderDue(settings, thursday, thursdaySlot, 2)).toBe(false)
  })

  it('fora dos dias marcados, nada', () => {
    const saturday = new Date(2026, 10, 7, 10, 0, 0)
    expect(saturday.getDay()).toBe(6)
    expect(isReminderDue(days({ minuteOfDay: 9 * 60 }), saturday, null, 5)).toBe(false)
  })

  it('antes da hora marcada, ainda não', () => {
    const early = new Date(2026, 10, 4, 8, 0, 0)
    expect(isReminderDue(days({ minuteOfDay: 19 * 60 }), early, null, 5)).toBe(false)
  })

  it('próxima janela pula para o próximo dia escolhido', () => {
    const settings = days({ days: [6], minuteOfDay: 20 * 60 })
    const next = nextReminderAt(settings, wednesdayMorning())
    expect(next).not.toBeNull()
    expect(new Date(next as number).getDay()).toBe(6)
  })
})

describe('rótulo', () => {
  it('descreve o agendamento para a UI', () => {
    const labels = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
    expect(describeSchedule(days({ days: [1, 3], minuteOfDay: 8 * 60 }), labels)).toBe('seg · qua 08:00')
    expect(describeSchedule({ ...DEFAULT_REMINDER, enabled: false }, labels)).toBe('off')
  })
})
