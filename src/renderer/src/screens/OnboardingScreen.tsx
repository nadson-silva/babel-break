import { useState } from 'react'
import type { JSX } from 'react'
import type {
  CefrLevel,
  LanguageOption,
  OnboardingInput,
  PlacementResult,
  PlacementTest,
  ProfileState,
  SettingsPayload
} from '../../../shared/types'
import { t, languagePickerLabel } from '../i18n'
import { setTargetLanguage, targetLabel } from '../lang'

interface OnboardingScreenProps {
  settings: SettingsPayload
  languages: LanguageOption[]
  onDone: (state: ProfileState) => void
}

type Step = 'language' | 'goal' | 'level' | 'test' | 'result'

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1']

const LEVEL_HINTS: Record<CefrLevel, string> = {
  A1: 'Iniciante',
  A2: 'Básico',
  B1: 'Intermediário',
  B2: 'Intermediário avançado',
  C1: 'Avançado'
}

/** Idiomas das explicações: qualquer um que o aluno fale de verdade. */
const NATIVE_CANDIDATES = ['pt-BR', 'en', 'es']

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function OnboardingScreen({ settings, languages, onDone }: OnboardingScreenProps): JSX.Element {
  const [step, setStep] = useState<Step>('language')
  const [targetLang, setTargetLang] = useState('en')
  const [nativeLang, setNativeLang] = useState('pt-BR')
  const [goal, setGoal] = useState('')
  const [manualLevel, setManualLevel] = useState<CefrLevel | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [test, setTest] = useState<PlacementTest | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [current, setCurrent] = useState(0)
  const [result, setResult] = useState<PlacementResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const model = settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel
  // Sem o registro carregado ainda (IPC em voo), o passo abre só com o padrão.
  const targetOptions = languages.length > 0 ? languages : [{ code: 'en', nativeName: 'English', name: 'English', promptName: 'inglês', scriptDirection: 'ltr' as const, tokenization: 'space' as const }]
  const lang = targetLabel(targetLang)

  function pickTarget(option: LanguageOption): void {
    setTargetLang(option.code)
    // O nativo nunca pode ser o idioma que se está aprendendo.
    if (nativeLang.split('-')[0] === option.code.split('-')[0]) {
      setNativeLang('pt-BR')
    }
  }

  async function startTest(): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      const generated = await window.api.learning.placement.generate({ goal, targetLang, nativeLang })
      setTest(generated)
      setAnswers(new Array(generated.questions.length).fill(-1))
      setCurrent(0)
      setStep('test')
    } catch (testError) {
      setError(messageOf(testError))
    } finally {
      setBusy(false)
    }
  }

  async function submitTest(): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      const graded = await window.api.learning.placement.submit(answers)
      setResult(graded)
      setStep('result')
    } catch (testError) {
      setError(messageOf(testError))
    } finally {
      setBusy(false)
    }
  }

  async function finish(cefr: CefrLevel): Promise<void> {
    setBusy(true)
    setError(null)

    const input: OnboardingInput = { goal: goal.trim(), cefr, targetLang, nativeLang }

    try {
      setTargetLanguage(targetLang)
      const state = await window.api.learning.profile.onboard(input)
      onDone(state)
    } catch (onboardError) {
      setError(messageOf(onboardError))
      setBusy(false)
    }
  }

  const question = test?.questions[current]
  const answered = question ? answers[current] >= 0 : false
  const allAnswered = test ? answers.every((answer) => answer >= 0) : false

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-8 py-12">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-accent text-sm font-bold text-accent-ink">
            LT
          </div>
          <div>
            <div className="text-sm font-semibold">{t.app.name}</div>
            <div className="text-[11px] text-faint">{t.app.tagline}</div>
          </div>
        </div>

        <div className="mt-10">
          <h1 className="text-2xl font-semibold">{t.onboarding.title}</h1>
          <p className="mt-1.5 text-sm text-muted">{t.onboarding.subtitle}</p>
        </div>

        <div className="mt-8 flex-1">
          {error && (
            <div className="mb-5 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
              <div className="font-medium">{t.onboarding.errorTitle}</div>
              <div className="mt-1 leading-relaxed">{error}</div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="mt-2 text-[11px] underline underline-offset-2"
              >
                {t.onboarding.retry}
              </button>
            </div>
          )}

          {step === 'language' && (
            <section className="rounded-2xl border border-line bg-panel p-6">
              <h2 className="text-sm font-semibold">{t.languages.targetTitle}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">{t.languages.targetHelp}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {targetOptions.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    onClick={() => pickTarget(option)}
                    className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                      targetLang === option.code
                        ? 'border-accent/60 bg-accent-soft text-accent'
                        : 'border-line bg-panel-2 text-muted hover:text-ink'
                    }`}
                  >
                    <span lang={option.code} dir="auto" className="font-medium">
                      {languagePickerLabel(option)}
                    </span>
                    {(option.scriptDirection === 'rtl' || option.tokenization === 'cjk') && (
                      <span className="ml-1.5 text-[10px] text-faint">
                        {option.scriptDirection === 'rtl' ? '⇄' : 'CJK'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                ⇄ {t.languages.rtlNote} · CJK {t.languages.cjkNote}
              </p>

              {targetLang !== 'en' && (
                <p className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-warn">
                  {t.languages.fixtureNote}
                </p>
              )}

              <div className="mt-6">
                <h3 className="text-xs font-semibold">{t.languages.nativeTitle}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{t.languages.nativeHelp}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {NATIVE_CANDIDATES.filter((code) => code.split('-')[0] !== targetLang.split('-')[0]).map(
                    (code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setNativeLang(code)}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                          nativeLang === code
                            ? 'border-accent/60 bg-accent-soft text-accent'
                            : 'border-line bg-panel-2 text-muted hover:text-ink'
                        }`}
                      >
                        {t.languages.names[code as keyof typeof t.languages.names] ?? code}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep('goal')}
                  className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                >
                  {t.onboarding.next}
                </button>
              </div>
            </section>
          )}

          {step === 'goal' && (
            <section className="rounded-2xl border border-line bg-panel p-6">
              <h2 className="text-sm font-semibold">{t.onboarding.stepGoal}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">{t.onboarding.goalHelp}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {t.onboarding.goalSuggestions.map((suggestion) => {
                  const label = suggestion.replace('{lang}', lang)
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setGoal(label)}
                      className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                        goal === label
                          ? 'border-accent/60 bg-accent-soft text-accent'
                          : 'border-line bg-panel-2 text-muted hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              <input
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder={t.onboarding.goalPlaceholder}
                className="mt-4 w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50"
              />

              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep('language')}
                  className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
                >
                  {t.onboarding.back}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('level')}
                  disabled={!goal.trim()}
                  className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t.onboarding.next}
                </button>
              </div>
            </section>
          )}

          {step === 'level' && (
            <section className="rounded-2xl border border-line bg-panel p-6">
              <h2 className="text-sm font-semibold">{t.onboarding.stepLevel.replace('{lang}', lang)}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">{t.onboarding.levelHelp}</p>

              {!model && (
                <div className="mt-4 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
                  {t.home.noModel}
                </div>
              )}

              <button
                type="button"
                onClick={() => void startTest()}
                disabled={busy || !model}
                className="mt-5 flex w-full items-center justify-between rounded-xl border border-accent/50 bg-accent-soft/50 px-4 py-4 text-left transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>
                  <span className="block text-sm font-semibold text-accent">
                    {busy ? t.onboarding.generatingTest : t.onboarding.takeTest}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{t.onboarding.takeTestHelp}</span>
                </span>
                <span className="text-accent">→</span>
              </button>

              <div className="mt-6 flex items-center justify-between">
                <span className="text-xs text-muted">{t.onboarding.chooseManual}</span>
                <button
                  type="button"
                  onClick={() => setShowManual((value) => !value)}
                  className="text-xs text-accent"
                >
                  {showManual ? '—' : '+'}
                </button>
              </div>

              <div className={`mt-3 grid gap-2 sm:grid-cols-5 ${showManual ? '' : 'hidden'}`}>
                {LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setManualLevel(level)}
                    className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                      manualLevel === level
                        ? 'border-accent/60 bg-accent-soft'
                        : 'border-line bg-panel-2 hover:border-line/80'
                    }`}
                  >
                    <div className="text-sm font-semibold text-ink">{level}</div>
                    <div className="mt-0.5 text-[10px] text-muted">{LEVEL_HINTS[level]}</div>
                  </button>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep('goal')}
                  className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
                >
                  {t.onboarding.back}
                </button>
                <button
                  type="button"
                  onClick={() => manualLevel && void finish(manualLevel)}
                  disabled={!manualLevel || busy}
                  className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? t.onboarding.saving : t.onboarding.start}
                </button>
              </div>
            </section>
          )}

          {step === 'test' && test && question && (
            <section className="rounded-2xl border border-line bg-panel p-6">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {t.onboarding.question} {current + 1} {t.onboarding.of} {test.questions.length}
                </span>
                <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-faint">
                  {question.level}
                </span>
              </div>

              <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${((current + 1) / test.questions.length) * 100}%` }}
                />
              </div>

              <p className="mt-5 text-base leading-relaxed text-ink" dir="auto" lang={targetLang}>
                {question.prompt}
              </p>

              <div className="mt-4 space-y-2">
                {question.options.map((option, index) => {
                  const selected = answers[current] === index
                  return (
                    <button
                      key={`${question.id}-${index}`}
                      type="button"
                      onClick={() => {
                        setAnswers((previous) => {
                          const next = [...previous]
                          next[current] = index
                          return next
                        })
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                        selected
                          ? 'border-accent/60 bg-accent-soft text-ink'
                          : 'border-line bg-panel-2 text-muted hover:border-line/80 hover:text-ink'
                      }`}
                    >
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-full border text-[11px] ${
                          selected ? 'border-accent text-accent' : 'border-line text-faint'
                        }`}
                      >
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span dir="auto" lang={targetLang}>
                        {option}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCurrent((value) => Math.max(0, value - 1))}
                  disabled={current === 0}
                  className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink disabled:opacity-30"
                >
                  {t.onboarding.back}
                </button>

                <div className="flex items-center gap-2">
                  {current < test.questions.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => setCurrent((value) => Math.min(test.questions.length - 1, value + 1))}
                      disabled={!answered}
                      className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {t.onboarding.next}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void submitTest()}
                      disabled={!allAnswered || busy}
                      className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy ? t.onboarding.saving : t.onboarding.finishTest}
                    </button>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setTest(null)
                  setStep('level')
                  setShowManual(true)
                }}
                className="mt-4 text-[11px] text-faint underline underline-offset-2 hover:text-muted"
              >
                {t.onboarding.skipTest}
              </button>
            </section>
          )}

          {step === 'result' && result && (
            <section className="rounded-2xl border border-accent/40 bg-panel p-6 text-center">
              <div className="text-xs uppercase tracking-wider text-faint">{t.onboarding.testResult}</div>
              <div className="mt-2 text-5xl font-semibold text-accent">{result.cefr}</div>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
                {t.onboarding.testResultBody
                  .replace('{correct}', String(result.correct))
                  .replace('{total}', String(result.total))}
              </p>
              <button
                type="button"
                onClick={() => void finish(result.cefr)}
                disabled={busy}
                className="mt-6 rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {busy ? t.onboarding.saving : t.onboarding.start}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
