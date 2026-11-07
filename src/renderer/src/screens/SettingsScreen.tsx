import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type {
  AppSettings,
  LanguageOption,
  ModelInfo,
  ProfileState,
  ProfileView,
  ProviderId,
  SettingsPayload,
  TestResult
} from '../../../shared/types'
import { t, UI_LANGUAGES } from '../i18n'
import { nativeLabel, targetLabel } from '../lang'

interface SettingsScreenProps {
  settings: SettingsPayload
  languages: LanguageOption[]
  profile: ProfileView
  onChanged: (settings: SettingsPayload) => void
  /** Memória reiniciada: o App assume o perfil novo (o onboarding recomeça). */
  onMemoryReset: (state: ProfileState) => void
}

function toForm(settings: SettingsPayload): AppSettings {
  return {
    provider: settings.provider,
    geminiModel: settings.geminiModel,
    ollamaModel: settings.ollamaModel,
    ollamaBaseUrl: settings.ollamaBaseUrl,
    correctionStyle: settings.correctionStyle,
    focusMix: settings.focusMix,
    uiLang: settings.uiLang
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Section({
  title,
  help,
  aside,
  children
}: {
  title: string
  help?: string
  aside?: JSX.Element
  children: ReactNode
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {help && <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">{help}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function SettingsScreen({
  settings,
  languages,
  profile,
  onChanged,
  onMemoryReset
}: SettingsScreenProps): JSX.Element {
  const [form, setForm] = useState<AppSettings>(() => toForm(settings))
  const [models, setModels] = useState<Record<ProviderId, ModelInfo[]>>({ gemini: [], ollama: [] })
  const [modelErrors, setModelErrors] = useState<Record<ProviderId, string | null>>({
    gemini: null,
    ollama: null
  })
  const [loadingModels, setLoadingModels] = useState<Record<ProviderId, boolean>>({
    gemini: false,
    ollama: false
  })
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [testing, setTesting] = useState<ProviderId | null>(null)
  const [results, setResults] = useState<Partial<Record<ProviderId, TestResult>>>({})
  const [error, setError] = useState<string | null>(null)
  // Reinício de memória: dois toques (pedir confirmação, depois apagar).
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  // O modelo vem como <select>; o input livre fica sob demanda (e é o padrão
  // quando o provedor está inacessível e não há lista para montar).
  const [manualModel, setManualModel] = useState<Record<ProviderId, boolean>>({
    gemini: false,
    ollama: false
  })

  useEffect(() => {
    setForm(toForm(settings))
  }, [settings])

  useEffect(() => {
    void loadModels('gemini')
    void loadModels('ollama')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadModels(provider: ProviderId): Promise<void> {
    setLoadingModels((previous) => ({ ...previous, [provider]: true }))
    setModelErrors((previous) => ({ ...previous, [provider]: null }))

    try {
      const list = await window.api.models.list(provider)
      setModels((previous) => ({ ...previous, [provider]: list }))

      const first = list[0]?.id
      if (first) {
        setForm((current) => {
          if (provider === 'gemini') {
            return current.geminiModel ? current : { ...current, geminiModel: first }
          }
          return current.ollamaModel ? current : { ...current, ollamaModel: first }
        })
      }
    } catch (loadError) {
      setModelErrors((previous) => ({ ...previous, [provider]: messageOf(loadError) }))
    } finally {
      setLoadingModels((previous) => ({ ...previous, [provider]: false }))
    }
  }

  async function save(): Promise<boolean> {
    setSaving(true)
    setError(null)

    try {
      const next = await window.api.settings.update(form)
      onChanged(next)
      setForm(toForm(next))
      setSavedAt(new Date().toLocaleTimeString(form.uiLang))
      return true
    } catch (saveError) {
      setError(messageOf(saveError))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function test(provider: ProviderId): Promise<void> {
    const saved = await save()
    if (!saved) return

    setTesting(provider)
    setResults((previous) => ({ ...previous, [provider]: undefined }))

    try {
      const result = await window.api.provider.test(provider)
      setResults((previous) => ({ ...previous, [provider]: result }))
    } catch (testError) {
      setResults((previous) => ({
        ...previous,
        [provider]: { ok: false, latencyMs: 0, error: messageOf(testError) }
      }))
    } finally {
      setTesting(null)
    }
  }

  async function saveKey(): Promise<void> {
    if (!keyInput.trim()) return
    setKeyBusy(true)
    setError(null)

    try {
      const next = await window.api.settings.setGeminiKey(keyInput)
      onChanged(next)
      setKeyInput('')
      void loadModels('gemini')
    } catch (keyError) {
      setError(messageOf(keyError))
    } finally {
      setKeyBusy(false)
    }
  }

  async function clearKey(): Promise<void> {
    setKeyBusy(true)
    setError(null)

    try {
      const next = await window.api.settings.clearGeminiKey()
      onChanged(next)
    } catch (keyError) {
      setError(messageOf(keyError))
    } finally {
      setKeyBusy(false)
    }
  }

  async function resetMemory(): Promise<void> {
    setResetBusy(true)
    setError(null)

    try {
      const state = await window.api.learning.profile.resetMemory()
      setConfirmReset(false)
      onMemoryReset(state)
    } catch (resetError) {
      setError(messageOf(resetError))
    } finally {
      setResetBusy(false)
    }
  }

  const secure = settings.secureStorage.available && settings.secureStorage.backend !== 'basic_text'
  const modelKey = form.provider === 'gemini' ? 'geminiModel' : 'ollamaModel'
  const modelValue = form[modelKey]
  const modelList = models[form.provider]
  const showManualInput = manualModel[form.provider] || modelList.length === 0
  const targetOption = languages.find(
    (entry) => entry.code.toLowerCase() === profile.targetLang.toLowerCase()
  )

  function pickModel(value: string): void {
    setForm((current) =>
      form.provider === 'gemini' ? { ...current, geminiModel: value } : { ...current, ollamaModel: value }
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div>
          <h1 className="text-base font-semibold">{t.settings.title}</h1>
          <p className="text-xs text-muted">{t.settings.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && <span className="text-xs text-accent">{t.common.saved} · {savedAt}</span>}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? t.common.saving : t.common.save}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-5 pb-8">
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
              {error}
            </div>
          )}

          <Section title={t.settings.providerTitle} help={t.settings.providerHelp}>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, provider: 'ollama' }))}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  form.provider === 'ollama'
                    ? 'border-accent/60 bg-accent-soft/40'
                    : 'border-line bg-panel-2 hover:border-line/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{t.settings.ollamaName}</span>
                  <span className="size-2 rounded-full bg-accent" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t.settings.ollamaDesc}</p>
              </button>

              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, provider: 'gemini' }))}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  form.provider === 'gemini'
                    ? 'border-accent/60 bg-accent-soft/40'
                    : 'border-line bg-panel-2 hover:border-line/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{t.settings.geminiName}</span>
                  <span className="size-2 rounded-full bg-[#7aa2ff]" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t.settings.geminiDesc}</p>
              </button>
            </div>
          </Section>

          <Section
            title={t.settings.geminiKeyTitle}
            help={t.settings.geminiKeyHelp}
            aside={
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider ${
                  settings.hasGeminiKey
                    ? 'bg-accent-soft text-accent'
                    : 'bg-panel-2 text-faint'
                }`}
              >
                {settings.hasGeminiKey
                  ? t.settings.geminiKeyConfigured
                  : t.settings.geminiKeyMissing}
              </span>
            }
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder={t.settings.geminiKeyPlaceholder}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50"
              />
              <button
                type="button"
                onClick={() => void saveKey()}
                disabled={!keyInput.trim() || keyBusy}
                className="rounded-lg border border-accent/50 bg-accent-soft px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent-soft/70 disabled:opacity-40"
              >
                {t.settings.saveKey}
              </button>
              {settings.hasGeminiKey && (
                <button
                  type="button"
                  onClick={() => void clearKey()}
                  disabled={keyBusy}
                  className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-40"
                >
                  {t.settings.clearKey}
                </button>
              )}
            </div>
          </Section>

          <Section
            title={t.settings.modelTitle}
            help={t.settings.modelHelp}
            aside={
              <button
                type="button"
                onClick={() => void loadModels(form.provider)}
                disabled={loadingModels[form.provider]}
                className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
              >
                {loadingModels[form.provider] ? '…' : t.common.refresh}
              </button>
            }
          >
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {showManualInput ? (
                  <input
                    value={modelValue}
                    onChange={(event) => pickModel(event.target.value)}
                    placeholder={form.provider === 'gemini' ? 'gemini-2.5-flash' : 'qwen3.5:0.8b'}
                    className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50"
                  />
                ) : (
                  <select
                    value={modelValue}
                    onChange={(event) => pickModel(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent/50"
                  >
                    {!modelValue && <option value="">—</option>}
                    {modelValue && !modelList.some((model) => model.id === modelValue) && (
                      <option value={modelValue}>{modelValue} (não listado)</option>
                    )}
                    {modelList.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                        {model.description ? ` · ${model.description}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => void test(form.provider)}
                  disabled={testing !== null}
                  className="shrink-0 rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
                >
                  {testing === form.provider ? t.common.testing : t.common.test}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                {modelList.length > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setManualModel((current) => ({ ...current, [form.provider]: !manualModel[form.provider] }))
                    }
                    className="text-[11px] text-muted underline underline-offset-2 hover:text-ink"
                  >
                    {manualModel[form.provider] ? t.settings.chooseFromList : t.settings.typeManually}
                  </button>
                ) : (
                  <span className="text-[11px] text-faint">
                    {modelErrors[form.provider] ? t.settings.modelsUnavailable : t.settings.modelsLoading}
                  </span>
                )}
                {modelList.length > 0 && (
                  <span className="text-[11px] text-faint">
                    {t.settings.modelsFound
                      .replace('{count}', String(modelList.length))
                      .replace('{provider}', form.provider === 'gemini' ? 'Gemini' : 'Ollama')}
                  </span>
                )}
              </div>
            </div>

            {modelErrors[form.provider] && (
              <p className="mt-2 text-xs leading-relaxed text-warn">
                {t.settings.modelsError} <span className="text-faint">({modelErrors[form.provider]})</span>
              </p>
            )}

            {results[form.provider] && (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                  results[form.provider]?.ok
                    ? 'border-accent/40 bg-accent-soft/50 text-accent'
                    : 'border-danger/40 bg-danger-soft text-danger'
                }`}
              >
                <span className="font-medium">
                  {results[form.provider]?.ok ? t.settings.testOk : t.settings.testFail}
                </span>
                {results[form.provider]?.latencyMs ? (
                  <span className="text-muted"> · {results[form.provider]?.latencyMs} ms</span>
                ) : null}
                {(results[form.provider]?.detail || results[form.provider]?.error) && (
                  <span className="text-muted">
                    {' '}
                    · {results[form.provider]?.detail || results[form.provider]?.error}
                  </span>
                )}
              </div>
            )}

            {form.provider === 'ollama' && (
              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium text-muted">
                  {t.settings.ollamaUrlTitle}
                </label>
                <input
                  value={form.ollamaBaseUrl}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, ollamaBaseUrl: event.target.value }))
                  }
                  placeholder="http://127.0.0.1:11434"
                  className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50"
                />
                <p className="mt-1 text-[11px] text-faint">{t.settings.ollamaUrlHelp}</p>
              </div>
            )}
          </Section>

          <Section title={t.settings.uiLangTitle} help={t.settings.uiLangHelp}>
            <div className="flex flex-wrap gap-2">
              {UI_LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, uiLang: language.code }))}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    form.uiLang === language.code
                      ? 'border-accent/60 bg-accent-soft text-accent'
                      : 'border-line bg-panel-2 text-muted hover:text-ink'
                  }`}
                >
                  {language.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title={t.settings.languagesTitle} help={t.settings.languagesHelp}>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line-soft bg-panel-2 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-faint">{t.settings.targetLabel}</dt>
                <dd className="mt-0.5 text-sm text-ink" dir="auto">
                  {targetLabel(profile.targetLang)}
                  {targetOption?.scriptDirection === 'rtl' && (
                    <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[10px] text-faint">
                      ⇄ {t.languages.rtlNote}
                    </span>
                  )}
                  {targetOption?.tokenization === 'cjk' && (
                    <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[10px] text-faint">
                      CJK {t.languages.cjkNote}
                    </span>
                  )}
                </dd>
              </div>
              <div className="rounded-lg border border-line-soft bg-panel-2 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-faint">{t.settings.nativeLabel}</dt>
                <dd className="mt-0.5 text-sm text-ink" dir="auto">
                  {nativeLabel(profile.nativeLang)}
                </dd>
              </div>
            </dl>
          </Section>

          <Section title={t.settings.correctionTitle} help={t.settings.correctionHelp}>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['recast', t.settings.correctionRecast],
                  ['explicit', t.settings.correctionExplicit],
                  ['both', t.settings.correctionBoth]
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, correctionStyle: value }))}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    form.correctionStyle === value
                      ? 'border-accent/60 bg-accent-soft text-accent'
                      : 'border-line bg-panel-2 text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          <Section title={t.settings.focusTitle} help={t.settings.focusHelp}>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={70}
                step={5}
                value={Math.round(form.focusMix * 100)}
                onChange={(event) =>
                  setForm((current) => ({ ...current, focusMix: Number(event.target.value) / 100 }))
                }
                className="h-1.5 flex-1 accent-[#4cc2a0]"
              />
              <span className="w-14 text-right text-sm font-semibold text-accent">
                {Math.round(form.focusMix * 100)}%
              </span>
            </div>
          </Section>

          <Section
            title={t.settings.securityTitle}
            aside={
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider ${
                  secure ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn'
                }`}
              >
                {settings.secureStorage.backend ?? 'n/a'}
              </span>
            }
          >
            <p className="text-xs leading-relaxed text-muted">
              {secure
                ? t.settings.securityOk
                : settings.secureStorage.available
                  ? t.settings.securityBasic
                  : t.settings.securityUnavailable}
            </p>
            {settings.secureStorage.backend && (
              <p className="mt-1 text-[11px] text-faint">
                {t.settings.securityBackend}: {settings.secureStorage.backend}
              </p>
            )}
          </Section>

          <Section title={t.settings.runtimeTitle}>
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              {[
                ['Electron', settings.runtime.electron],
                ['Chromium', settings.runtime.chrome],
                ['Node', settings.runtime.node],
                ['Plataforma', settings.runtime.platform]
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line-soft bg-panel-2 px-3 py-2">
                  <dt className="text-[10px] uppercase tracking-wider text-faint">{label}</dt>
                  <dd className="mt-0.5 truncate text-muted" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {settings.runtime.platform === 'linux' && (
              <p className="mt-3 text-[11px] leading-relaxed text-faint">{t.settings.linuxNote}</p>
            )}
          </Section>

          <Section title={t.settings.memoryTitle} help={t.settings.memoryHelp}>
            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:border-danger/50 hover:text-danger"
              >
                {t.settings.memoryReset}
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-2 text-xs font-medium text-danger">{t.settings.memoryConfirm}</span>
                <button
                  type="button"
                  onClick={() => void resetMemory()}
                  disabled={resetBusy}
                  className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {resetBusy ? t.settings.memoryResetting : t.settings.memoryResetConfirm}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  disabled={resetBusy}
                  className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
                >
                  {t.settings.memoryResetCancel}
                </button>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
