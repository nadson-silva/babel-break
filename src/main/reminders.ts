/**
 * V2 — lembrete opt-in no processo main.
 *
 * A aritmética de calendário mora em `core/reminders.ts` (testável); aqui só o
 * que toca o sistema: a `Notification` do desktop, o `settings` que guarda a
 * última janela disparada e o timer ocioso que pergunta "venceu alguma janela
 * agora?" a cada minuto.
 *
 * Regras herdadas do plano (§11/§14): desligado por padrão, um disparo por
 * janela e **só quando existe algo para fazer** (cards vencidos no SRS do
 * perfil ativo). Sem isso vira cobrança, e cobrança é o que o app promete não
 * fazer.
 */
import { Notification } from 'electron'
import { eq } from 'drizzle-orm'
import {
  DEFAULT_REMINDER,
  isReminderDue,
  nextReminderAt,
  parseDays,
  parseMinuteOfDay,
  type ReminderSettings
} from '../core/reminders'
import { runtimeText } from '../core/runtime-text'
import { getDb, schema } from './db'
import { activeProfileId } from './profiles'
import { dueCount } from './review'
import { getSettings, updateSettings } from './settings'
import { nativeLangFor } from './locale'
import { handle } from './ipc-contract'
import { emitStudentEvent, onStudentEvent } from './events'
import type { ReminderView } from '../shared/types'

const FIRED_KEY = 'reminderFired'
/** Batida: 60 s é fino o bastante para não perder a hora marcada e barato demais para importar. */
const TICK_MS = 60_000

let timer: NodeJS.Timeout | null = null
let unsubscribe: (() => void) | null = null

export function reminderSettings(): ReminderSettings {
  const settings = getSettings()
  return {
    enabled: settings.reminderEnabled,
    days: parseDays(settings.reminderDays),
    minuteOfDay: parseMinuteOfDay(settings.reminderTime, DEFAULT_REMINDER.minuteOfDay)
  }
}

function lastFiredAt(): number | null {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, FIRED_KEY)).get()
  if (!row) return null
  const value = Number(row.value)
  return Number.isFinite(value) && value > 0 ? value : null
}

function markFired(at: number): void {
  getDb()
    .insert(schema.settings)
    .values({ key: FIRED_KEY, value: String(at), updatedAt: at })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(at), updatedAt: at } })
    .run()
}

export function reminderView(profileId = activeProfileId()): ReminderView {
  const settings = reminderSettings()
  const pending = dueCount(profileId)

  return {
    enabled: settings.enabled,
    days: settings.days,
    minuteOfDay: settings.minuteOfDay,
    /** Hora marcada que o usuário vê (HH:MM). */
    time: `${String(Math.floor(settings.minuteOfDay / 60)).padStart(2, '0')}:${String(settings.minuteOfDay % 60).padStart(2, '0')}`,
    nextAt: nextReminderAt(settings, new Date()),
    pending,
    lastFiredAt: lastFiredAt(),
    /** O sistema entrega notificação aqui? (AppImage sem notify-python avisa de verdade.) */
    supported: Notification.isSupported()
  }
}

/**
 * Uma checagem: vencendo janela e havendo cards, notifica e marca a janela.
 * Exportada para ser chamada pelo timer e testada sem timer.
 */
export function checkReminder(now = new Date(), profileId = activeProfileId()): boolean {
  const settings = reminderSettings()
  const pending = dueCount(profileId)

  if (!isReminderDue(settings, now, lastFiredAt(), pending)) return false

  const lang = nativeLangFor(profileId)
  const title = runtimeText(lang, 'reminder.title')
  const body = runtimeText(lang, 'reminder.body', { count: pending })

  markFired(now.getTime())

  if (!Notification.isSupported()) {
    console.info(`[reminder] ${title} — ${body} (notificações indisponíveis neste sistema)`)
    return true
  }

  try {
    const notification = new Notification({ title, body, silent: true })
    notification.on('click', () => emitStudentEvent('reminder-opened'))
    notification.show()
    return true
  } catch (error) {
    console.warn('[reminder] falha ao notificar:', error instanceof Error ? error.message : error)
    return true
  }
}

export function updateReminderSettings(patch: {
  enabled?: boolean
  days?: number[]
  time?: string | number
}): ReminderView {
  const settings = reminderSettings()
  updateSettings({
    reminderEnabled: patch.enabled ?? settings.enabled,
    reminderDays: patch.days ? parseDays(patch.days) : settings.days,
    reminderTime: patch.time !== undefined ? parseMinuteOfDay(patch.time, settings.minuteOfDay) : settings.minuteOfDay
  })
  return reminderView()
}

export function startReminderWatch(): void {
  stopReminderWatch()
  timer = setInterval(() => {
    try {
      checkReminder()
    } catch (error) {
      console.warn('[reminder] checagem falhou:', error instanceof Error ? error.message : error)
    }
  }, TICK_MS)
  timer.unref?.()

  // Estudar mexe na fila: depois de fechar uma lição/conversa, reavaliar a janela.
  unsubscribe = onStudentEvent(() => {
    /* sem efeito colateral: a batida de 60 s já cuida disso */
  })
}

export function stopReminderWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  unsubscribe?.()
  unsubscribe = null
}

/** Só para teste. */
export function resetReminderWatchForTest(): void {
  stopReminderWatch()
  getDb().delete(schema.settings).where(eq(schema.settings.key, FIRED_KEY)).run()
}

export function registerReminderIpc(): void {
  handle('reminder:get', () => reminderView())
  handle('reminder:update', (_event, patch: { enabled?: boolean; days?: number[]; time?: string }) =>
    updateReminderSettings(patch)
  )
  handle('reminder:test', () => {
    const settings = reminderSettings()
    const pending = Math.max(1, dueCount(activeProfileId()))
    const lang = nativeLangFor(activeProfileId())
    const title = runtimeText(lang, 'reminder.title')
    const body = runtimeText(lang, 'reminder.body', { count: pending })

    if (!Notification.isSupported()) {
      return { ok: false, title, body, reason: 'unsupported' as const, enabled: settings.enabled }
    }
    new Notification({ title, body, silent: true }).show()
    return { ok: true, title, body, reason: 'shown' as const, enabled: settings.enabled }
  })
}
