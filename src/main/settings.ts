import { eq } from 'drizzle-orm'
import type { AppSettings } from '../shared/types'
import { getDb, schema } from './db'

const DEFAULTS: AppSettings = {
  provider: 'ollama',
  geminiModel: 'gemini-2.5-flash',
  ollamaModel: '',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  correctionStyle: 'both',
  focusMix: 0.3,
  uiLang: 'pt-BR',
  // M5: aquecer o próximo conteúdo provável quando o app está ocioso.
  pregenerate: true,
  // V2: papéis de modelo vazios = herdar o modelo do provedor.
  quickModel: '',
  strongModel: '',
  voiceEnabled: true,
  ttsModel: '',
  asrModel: '',
  voiceName: 'Kore',
  speechRate: 'normal',
  liveModel: '',
  preferSystemVoices: false,
  // V2 (D11): padrão do algoritmo, mas o aluno pode escolher (0,70–0,97).
  retention: 0.9,
  // V2: convite opcional — desligado até o aluno pedir.
  reminderEnabled: false,
  reminderDays: [1, 3, 5],
  reminderTime: 19 * 60
}

const SETTINGS_KEY = 'settings'

export function getSettings(): AppSettings {
  const row = getDb()
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, SETTINGS_KEY))
    .get()

  if (!row) return { ...DEFAULTS }

  try {
    return { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<AppSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  const value = JSON.stringify(next)
  const now = Date.now()

  getDb()
    .insert(schema.settings)
    .values({ key: SETTINGS_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: now }
    })
    .run()

  return next
}
