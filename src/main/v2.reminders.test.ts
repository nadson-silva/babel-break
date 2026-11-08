/**
 * V2 — lembrete e verificação de versão no main, sem notificação e sem rede.
 *
 * O que precisa ficar provado:
 *
 * - o lembrete **não** dispara sozinho: desligado por padrão, e ligado só notifica
 *   com fila vencida de verdade (nada de cobrança vazia);
 * - a janela dispara **uma vez** (o estado sobrevive no `settings`, não na memória);
 * - os dias/hora vêm do payload validado (dia 9 e hora esdrúxula não entram);
 * - a checagem de versão trata erro de rede como estado, não exceção, e cacheia.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, isNotNull } from 'drizzle-orm'
import { initDatabase, getDb, schema } from './db'
import { updateSettings } from './settings'
import { completeOnboarding } from './learning'
import { createCard } from './review'
import { vocabCard } from '../core/srs'
import {
  checkReminder,
  reminderSettings,
  reminderView,
  resetReminderWatchForTest,
  updateReminderSettings
} from './reminders'
import { checkForUpdates, resetUpdateCacheForTest, updateState } from './updater'

beforeEach(() => {
  initDatabase()
  updateSettings({ provider: 'ollama', ollamaModel: '', pregenerate: false, reminderEnabled: false })
  resetReminderWatchForTest()
})

function seedDueCard(profileId: number): void {
  getDb().delete(schema.cards).run()
  const created = createCard(profileId, vocabCard({ term: 'ship', translation: 'entregar', example: 'We ship on Friday.' }), 'lesson')
  expect(created).toBe(true)
  // Card novo nasce com due no passado? não: garante vencido para o teste.
  getDb()
    .update(schema.cards)
    .set({ due: Date.now() - 60_000 })
    .where(isNotNull(schema.cards.id))
    .run()
}

describe('lembrete (convite, não cobrança)', () => {
  it('vem desligado e sem janela futura', () => {
    const view = reminderView()
    expect(view.enabled).toBe(false)
    expect(view.nextAt).toBeNull()
  })

  it('ligar sem alterar dias mantém uma agenda válida', () => {
    const view = updateReminderSettings({ enabled: true })
    expect(view.enabled).toBe(true)
    expect(view.days.length).toBeGreaterThan(0)
    expect(view.time).toMatch(/^\d{2}:\d{2}$/)
    expect(reminderSettings().minuteOfDay).toBe(view.minuteOfDay)
  })

  it('payload podre não entra no calendário', () => {
    const view = updateReminderSettings({ enabled: true, days: [0, 1, 2, 3, 4, 5, 6, 9, -1] })
    expect(view.days).toEqual([0, 1, 2, 3, 4, 5, 6])

    const badTime = updateReminderSettings({ time: '99:99' })
    expect(badTime.minuteOfDay).toBe(19 * 60)

    const goodTime = updateReminderSettings({ time: '07:15' })
    expect(goodTime.minuteOfDay).toBe(7 * 60 + 15)
    expect(goodTime.time).toBe('07:15')
  })

  it('nada pendente = nenhuma notificação, mesmo na hora marcada', () => {
    const state = completeOnboarding({ goal: 'dev', cefr: 'A2' })
    getDb().delete(schema.cards).run()

    // Hoje é um dia do set, e a janela é "agora menos uma hora".
    const now = new Date()
    updateReminderSettings({ enabled: true, days: [now.getDay()], time: Math.max(0, (now.getHours() - 1) * 60) })

    expect(checkReminder(now, state.profile.id)).toBe(false)
  })

  it('com fila vencida dispara, e a segunda batida da mesma janela não', () => {
    const state = completeOnboarding({ goal: 'dev', cefr: 'A2' })
    seedDueCard(state.profile.id)

    const now = new Date()
    now.setHours(23, 30, 0, 0)
    updateReminderSettings({ enabled: true, days: [now.getDay()], time: 23 * 60 })

    expect(dueCountOf(state.profile.id)).toBeGreaterThan(0)
    expect(checkReminder(now, state.profile.id)).toBe(true)
    expect(reminderView(state.profile.id).lastFiredAt).not.toBeNull()

    // Mesma janela, outra batida do timer: nada.
    expect(checkReminder(new Date(now.getTime() + 60_000), state.profile.id)).toBe(false)

    // Notificar manualmente ignora a regra de "uma vez por janela" (é teste do usuário).
    resetReminderWatchForTest()
  })
})

function dueCountOf(profileId: number): number {
  return Number(
    getDb()
      .select({ due: schema.cards.due })
      .from(schema.cards)
      .where(eq(schema.cards.profileId, profileId))
      .all()
      .filter((row) => row.due <= Date.now()).length
  )
}

describe('verificação de versão', () => {
  beforeEach(() => {
    resetUpdateCacheForTest()
  })

  it('antes da primeira checagem o estado é unknown, nunca "atualizado"', () => {
    const state = updateState()
    expect(state.state).toBe('unknown')
    expect(state.latest).toBeNull()
  })

  it('falha de rede vira estado "error" com motivo, sem lançar', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'))
    const result = await checkForUpdates({ force: true })
    expect(result.state).toBe('error')
    expect(result.error).toContain('ENOTFOUND')
    expect(result.current).toBeTruthy()
    spy.mockRestore()
  })

  it('resposta do GitHub é interpretada e cacheada', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ tag_name: 'v99.0.0', html_url: 'https://github.com/x/releases/tag/v99.0.0', body: 'notas' }),
        { status: 200 }
      )
    )

    const result = await checkForUpdates({ force: true })
    expect(result.state).toBe('available')
    expect(result.latest).toBe('99.0.0')
    expect(result.url).toContain('releases/tag/v99.0.0')

    // Cache: segunda chamada não bate na rede de novo.
    const cached = updateState()
    expect(cached.checkedAt).toBe(result.checkedAt)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('HTTP de erro não vira "você está atualizado"', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 403 }))
    const result = await checkForUpdates({ force: true })
    expect(result.state).toBe('error')
    expect(result.error).toContain('403')
    spy.mockRestore()
  })
})
