import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  SpeechGradeView,
  SpeechHistoryView,
  VoicePhraseView,
  VoiceStatus
} from '../../../shared/types'
import { t } from '../i18n'
import { targetLanguage } from '../lang'
import { PlayButton, SpeechRecorder, VoiceUnsupportedCard } from '../components/SpeechControls'
import { TargetText } from '../components/TargetText'

interface VoiceScreenProps {
  onOpenSettings: () => void
}

/**
 * V2: prática de voz solta — sem lição, sem sessão. O aluno escolhe uma frase da
 * própria memória (últimas lições + frases certas do caderno), ouve, repete e vê
 * onde a pronúncia travou. `speaking`/`listening` entram no painel a partir daqui.
 */
export function VoiceScreen({ onOpenSettings }: VoiceScreenProps): JSX.Element {
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [phrases, setPhrases] = useState<VoicePhraseView[]>([])
  const [history, setHistory] = useState<SpeechHistoryView | null>(null)
  const [index, setIndex] = useState(0)
  const [lastResult, setLastResult] = useState<SpeechGradeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextStatus, nextPhrases, nextHistory] = await Promise.all([
        window.api.voice.status(),
        window.api.voice.phrases(14),
        window.api.voice.history(12)
      ])
      if (!alive.current) return
      setStatus(nextStatus)
      setPhrases(nextPhrases)
      setHistory(nextHistory)
      setError(null)
    } catch (loadError) {
      if (alive.current) setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [load])

  const phrase = phrases[index] ?? null

  function next(): void {
    setLastResult(null)
    setIndex((value) => (value + 1) % Math.max(1, phrases.length))
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div>
          <h1 className="text-base font-semibold">{t.voice.title}</h1>
          <p className="mt-0.5 text-xs text-muted">{t.voice.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className="rounded-full border border-line px-2.5 py-1 text-[10px] text-muted">
              {status.mode === 'provider'
                ? `${status.provider === 'gemini' ? 'Gemini' : 'Ollama'} · TTS ${status.tts ? '✓' : '—'} · ASR ${status.asr ? '✓' : '—'}`
                : t.voice.noProviderVoice}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {t.common.refresh}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-8 py-6">
        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
            {error}
          </p>
        )}

        <VoiceUnsupportedCard status={status} />

        {status?.mode === 'none' && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {t.common.openSettings}
          </button>
        )}

        {loading && <p className="text-xs text-faint">{t.common.loading}</p>}

        {!loading && !phrase && (
          <p className="rounded-2xl border border-line bg-panel p-5 text-xs text-muted">{t.voice.noPhrases}</p>
        )}

        {phrase && (
          <section className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-faint">{t.voice.speakTitle}</p>
                <TargetText block className="mt-1 text-lg font-semibold leading-snug">
                  {phrase.target}
                </TargetText>
                {phrase.native && <p className="mt-1 text-sm text-muted">{phrase.native}</p>}
                <p className="mt-2 text-[11px] text-faint">
                  {phrase.source === 'error' ? t.voice.drillWithCorrections : phrase.origin}
                </p>
              </div>
              <PlayButton text={phrase.target} />
            </div>

            <div className="mt-4">
              <SpeechRecorder
                target={phrase.target}
                kind="speak"
                onScored={setLastResult}
                onProblem={setError}
              />
            </div>

            {lastResult && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className={`text-xs ${lastResult.passed ? 'text-accent' : 'text-warn'}`}>
                  {lastResult.passed ? t.voice.passedLabel : t.voice.failedLabel}
                </span>
                <button
                  type="button"
                  onClick={next}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90"
                >
                  {t.voice.nextPhrase}
                </button>
              </div>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-faint">{t.voice.scoreHelp}</p>
          </section>
        )}

        {phrases.length > 1 && (
          <section className="rounded-2xl border border-line bg-panel p-5">
            <p className="text-[10px] uppercase tracking-wider text-faint">{t.voice.phrasesTitle}</p>
            <p className="mt-1 text-xs text-muted">{t.voice.phrasesHelp}</p>
            <ul className="mt-3 space-y-1.5">
              {phrases.map((entry, position) => (
                <li key={`${entry.target}-${position}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setIndex(position)
                      setLastResult(null)
                      setError(null)
                    }}
                    aria-current={position === index ? 'true' : undefined}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      position === index
                        ? 'border-accent/60 bg-accent-soft text-ink'
                        : 'border-line bg-panel-2 text-muted hover:text-ink'
                    }`}
                  >
                    <span dir="auto" className="min-w-0 flex-1 truncate" lang={targetLanguage()}>
                      {entry.target}
                    </span>
                    <span className="shrink-0 text-[10px] text-faint">
                      {entry.source === 'error' ? t.nav.notebook : t.nav.lessons}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {history && history.runs.length > 0 && (
          <section className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-wider text-faint">{t.voice.historyTitle}</p>
              <p className="text-[11px] text-muted">
                {t.voice.runs.replace('{count}', String(history.total))}
                {history.speakingAverage != null &&
                  ` · ${t.voice.speakingAverage} ${Math.round(history.speakingAverage * 100)}%`}
                {history.listeningAverage != null &&
                  ` · ${t.voice.listeningAverage} ${Math.round(history.listeningAverage * 100)}%`}
              </p>
            </div>
            <ul className="mt-3 space-y-2">
              {history.runs.map((run) => (
                <li key={run.id} className="rounded-xl border border-line bg-panel-2 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span dir="auto" className="min-w-0 truncate text-xs" lang={targetLanguage()}>
                      {run.target}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {run.score == null ? '—' : `${Math.round(run.score * 100)}%`}
                    </span>
                  </div>
                  {run.transcript && (
                    <p dir="auto" className="mt-1 truncate text-[11px] text-faint" lang={targetLanguage()}>
                      {run.transcript}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
