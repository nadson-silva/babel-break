/**
 * V2 — lembrete opt-in (§11/§14 do plano: "frequência livre pode reduzir
 * retenção" → a resposta é convite, nunca cobrança).
 *
 * As regras que fazem disto um convite e não uma martelada:
 *
 * - **desligado por padrão**, e o usuário escolhe dias e horário;
 * - **um disparo por janela**: o mesmo dia/horário não notifica duas vezes, mesmo
 *   que o app fique aberto a semana inteira;
 * - **só com algo para fazer**: nada de cards vencidos e nenhuma lição na fila →
 *   nada de notificação. O plano proíbe culpa; mensagem sem conteúdo é culpa;
 * - sem streak, sem meta, sem "você está perdendo dias": o texto diz quantos
 *   cards venceram, no idioma das explicações do aluno.
 *
 * Pura e testável: nenhuma chamada de sistema aqui — só aritmética de calendário.
 */

export interface ReminderSettings {
  enabled: boolean
  /** 0 = domingo … 6 = sábado (mesma numeração de `Date.getDay()`). */
  days: number[]
  /** Minutos desde a meia-noite local ('08:30' → 510). */
  minuteOfDay: number
}

export const DEFAULT_REMINDER: ReminderSettings = {
  enabled: false,
  days: [1, 3, 5],
  minuteOfDay: 19 * 60
}

export const MINUTE_OF_DAY_MAX = 24 * 60 - 1

export function parseDays(value: unknown): number[] {
  const list = Array.isArray(value) ? value : []
  const days: number[] = []
  for (const entry of list) {
    // `Number(null)` é 0 e `Number('')` também: sem peneirar tipo, um JSON
    // podre virava "domingo" no calendário do usuário.
    const numeric = typeof entry === 'number' ? entry : typeof entry === 'string' && /^\d$/.test(entry.trim()) ? Number(entry) : Number.NaN
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) days.push(numeric)
  }
  return [...new Set(days)].sort((a, b) => a - b)
}

export function parseMinuteOfDay(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(MINUTE_OF_DAY_MAX, Math.max(0, Math.round(value)))
  }
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(String(value ?? '').trim())
  const hours = Number(match?.[1])
  const minutes = Number(match?.[2])
  if (!match || !Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return Math.min(MINUTE_OF_DAY_MAX, Math.max(0, fallback))
  }
  if (hours > 23 || minutes > 59) return Math.min(MINUTE_OF_DAY_MAX, Math.max(0, fallback))
  return hours * 60 + minutes
}

export function formatMinuteOfDay(value: number): string {
  const safe = Math.min(MINUTE_OF_DAY_MAX, Math.max(0, value))
  const hours = Math.floor(safe / 60)
  const minutes = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Início do dia local (ancora o cálculo sem depender do fuso do teste). */
function startOfDay(now: Date): number {
  const copy = new Date(now)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

/** Timestamp da janela de hoje (dia da semana + hora escolhida), ou null. */
export function todaysSlot(settings: ReminderSettings, now: Date): number | null {
  if (!settings.enabled || settings.days.length === 0) return null
  if (!settings.days.includes(now.getDay())) return null
  return startOfDay(now) + settings.minuteOfDay * 60_000
}

/**
 * Próxima janela do lembrete: hoje, se ainda não passou; senão o próximo dia
 * escolhido. Limitado a 14 dias para não varrer um calendário infinito quando
 * `days` fica vazio por engano.
 */
export function nextReminderAt(settings: ReminderSettings, now = new Date()): number | null {
  if (!settings.enabled || settings.days.length === 0) return null

  for (let offset = 0; offset < 14; offset += 1) {
    const day = new Date(startOfDay(now) + offset * 86_400_000)
    if (!settings.days.includes(day.getDay())) continue
    const at = day.getTime() + settings.minuteOfDay * 60_000
    if (at > now.getTime()) return at
  }

  return null
}

/**
 * Deve notificar agora? Compara com a última janela disparada (`lastFiredAt`),
 * nunca com "há quanto tempo não aviso" — acordar o app na quinta não pode fazer
 * o lembrete de segunda disparar atrasado.
 */
export function isReminderDue(
  settings: ReminderSettings,
  now: Date,
  lastFiredAt: number | null,
  pendingCount: number
): boolean {
  if (pendingCount <= 0) return false
  const slot = todaysSlot(settings, now)
  if (slot == null) return false
  if (now.getTime() < slot) return false
  // Janela já disparada hoje? (a checagem periódica roda de minuto em minuto)
  if (lastFiredAt != null && lastFiredAt >= slot) return false
  return true
}

/** Rótulo humano da configuração, para a tela de Configurações. */
export function describeSchedule(settings: ReminderSettings, dayLabels: string[]): string {
  if (!settings.enabled || settings.days.length === 0) return 'off'
  const days = settings.days.map((day) => dayLabels[day] ?? String(day)).join(' · ')
  return `${days} ${formatMinuteOfDay(settings.minuteOfDay)}`
}
