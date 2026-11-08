import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { SpeechGradeView, VoiceStatus } from '../../../shared/types'
import { t } from '../i18n'
import { targetLanguage } from '../lang'
import { MicRecorder, encodeTake, speakWithSystemVoice, systemVoicesSupported } from '../lib/audio'

/**
 * V2 — controles de voz compartilhados (player de exercício, tela de voz,
 * tutor). Tudo que fala com o main passa por aqui, então o estado de "tocando",
 * "gravando" e "sem voz" é uma coisa só na interface.
 */

interface PlayButtonProps {
  text: string
  /** Idiom-alvo da frase (default: o do perfil). */
  lang?: string
  label?: string
  compact?: boolean
  onProblem?: (message: string) => void
}

export function PlayButton({ text, lang, label, compact = false, onProblem }: PlayButtonProps): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [fromCache, setFromCache] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  const play = useCallback(async (): Promise<void> => {
    setBusy(true)
    setFailed(null)
    try {
      const result = await window.api.voice.speak({ text, lang: lang ?? targetLanguage() })
      if (result.ok && result.dataUrl) {
        const audio = new Audio(result.dataUrl)
        audioRef.current = audio
        setFromCache(result.source === 'cache')
        setPlaying(true)
        await audio.play()
        return
      }

      // Sem provedor de voz: tenta a voz do sistema antes de dizer "não dá".
      if (systemVoicesSupported()) {
        setPlaying(true)
        await speakWithSystemVoice(text, lang ?? targetLanguage())
        setPlaying(false)
        return
      }

      setFailed(result.error ?? t.voice.unavailable)
      onProblem?.(result.error ?? t.voice.unavailable)
    } catch (error) {
      setPlaying(false)
      const message = error instanceof Error ? error.message : String(error)
      setFailed(message)
      onProblem?.(message)
    } finally {
      setBusy(false)
    }
  }, [lang, onProblem, text])

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void play()}
        disabled={busy || text.trim().length === 0}
        aria-label={label ?? t.voice.play}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40 ${
          playing ? 'text-accent' : 'text-muted'
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-3.5" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5L8 5.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        {!compact && <span>{busy ? t.voice.preparing : label ?? t.voice.play}</span>}
      </button>
      {fromCache && !compact && <span className="text-[10px] text-faint">{t.voice.fromCache}</span>}
      {failed && (
        <span role="status" className="text-[10px] text-danger">
          {failed}
        </span>
      )}
    </span>
  )
}

interface RecorderProps {
  target: string
  kind: 'speak' | 'listen'
  lessonId?: number | null
  exerciseId?: number | null
  onScored: (result: SpeechGradeView) => void
  onProblem?: (message: string) => void
  /** Texto digitado em vez de gravar (compreensão sem microfone). */
  allowTyped?: boolean
}

export function SpeechRecorder({
  target,
  kind,
  lessonId,
  exerciseId,
  onScored,
  onProblem,
  allowTyped = true
}: RecorderProps): JSX.Element {
  const [state, setState] = useState<'idle' | 'recording' | 'scoring'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<SpeechGradeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const recorderRef = useRef<MicRecorder | null>(null)
  const tickRef = useRef<number | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (tickRef.current != null) window.clearInterval(tickRef.current)
      recorderRef.current?.cancel()
      recorderRef.current = null
    }
  }, [])

  const stopTick = (): void => {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  async function record(): Promise<void> {
    setError(null)
    setResult(null)
    const recorder = new MicRecorder()
    recorderRef.current = recorder

    try {
      await recorder.start()
      setState('recording')
      setElapsed(0)
      stopTick()
      tickRef.current = window.setInterval(() => {
        if (alive.current) setElapsed(recorder.elapsedMs)
      }, 200)
    } catch (startError) {
      recorder.cancel()
      recorderRef.current = null
      const message = startError instanceof Error ? startError.message : String(startError)
      const denied = /NotAllowed|denied|Permission/i.test(message)
      setError(denied ? t.voice.micDenied : t.voice.micUnavailable)
      setState('idle')
      onProblem?.(message)
    }
  }

  async function submit(): Promise<void> {
    const recorder = recorderRef.current
    if (!recorder) return
    stopTick()
    setState('scoring')

    try {
      const take = await recorder.stop()
      recorderRef.current = null
      const scored = await window.api.voice.grade({
        mime: take.mime,
        audio: take.audio,
        target,
        kind,
        lessonId: lessonId ?? null,
        exerciseId: exerciseId ?? null,
        requestId: `take-${Date.now()}`
      })
      if (!alive.current) return
      setResult(scored)
      onScored(scored)
    } catch (gradeError) {
      if (!alive.current) return
      recorderRef.current?.cancel()
      recorderRef.current = null
      const message = gradeError instanceof Error ? gradeError.message : String(gradeError)
      setError(message)
      onProblem?.(message)
    } finally {
      if (alive.current) setState('idle')
    }
  }

  function cancel(): void {
    stopTick()
    recorderRef.current?.cancel()
    recorderRef.current = null
    setState('idle')
    setElapsed(0)
  }

  async function submitTyped(): Promise<void> {
    if (!typed.trim()) return
    setState('scoring')
    setError(null)
    try {
      const scored = await window.api.voice.grade({
        mime: 'audio/wav',
        audio: '',
        target,
        kind,
        lessonId: lessonId ?? null,
        exerciseId: exerciseId ?? null,
        typedAnswer: typed.trim()
      })
      if (!alive.current) return
      setResult(scored)
      onScored(scored)
    } catch (gradeError) {
      if (alive.current) setError(gradeError instanceof Error ? gradeError.message : String(gradeError))
    } finally {
      if (alive.current) setState('idle')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {state !== 'recording' ? (
          <button
            type="button"
            onClick={() => void record()}
            disabled={state === 'scoring'}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            <MicIcon />
            {t.voice.record}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-surface transition-colors hover:bg-danger/90"
          >
            <StopIcon />
            {t.voice.stop.replace('{seconds}', String(Math.round(elapsed / 1000)))}
          </button>
        )}

        {state === 'scoring' && <span className="text-xs text-muted">{t.voice.scoring}</span>}
        {state === 'recording' && (
          <button
            type="button"
            onClick={cancel}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {t.common.cancel}
          </button>
        )}
        <PlayButton text={target} compact label={t.voice.hearTarget} />
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {result && <SpeechResult result={result} />}

      {allowTyped && !result && (
        <div className="flex items-center gap-2">
          <input
            dir="auto"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={t.voice.typeInstead}
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50"
          />
          <button
            type="button"
            onClick={() => void submitTyped()}
            disabled={state === 'scoring' || typed.trim().length === 0}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-50"
          >
            {t.voice.check}
          </button>
        </div>
      )}
    </div>
  )
}

/** Score com as palavras marcadas — o aluno vê *onde* errou, não só o número. */
export function SpeechResult({ result }: { result: SpeechGradeView }): JSX.Element {
  const percent = Math.round(result.score * 100)
  const tone = result.passed ? 'text-accent' : percent >= 50 ? 'text-warn' : 'text-danger'

  return (
    <div className="rounded-xl border border-line bg-panel-2 p-3">
      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-semibold ${tone}`}>{percent}%</span>
        <span className="text-xs text-muted">{t.voice.pronunciation}</span>
      </div>
      <p dir="auto" className="mt-2 text-sm leading-relaxed">
        {result.words.map((word, index) => (
          <span
            key={`${word.text}-${index}`}
            title={word.heard ? t.voice.heard.replace('{word}', word.heard) : undefined}
            className={
              word.status === 'ok'
                ? 'text-ink'
                : word.status === 'near'
                  ? 'text-warn underline decoration-warn/60 decoration-dotted underline-offset-4'
                  : 'text-danger underline decoration-danger/60 decoration-dotted underline-offset-4'
            }
          >
            {word.text}{' '}
          </span>
        ))}
      </p>
      {result.transcript !== null && (
        <p dir="auto" className="mt-2 text-[11px] text-faint">
          {t.voice.heardLine.replace('{transcript}', result.transcript || '—')}
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted">{result.summary}</p>
    </div>
  )
}

/**
 * Ditado para o chat: grava, transcreve e devolve o texto — o aluno ainda edita
 * antes de enviar. Não pontua nada (é entrada de voz, não avaliação).
 */
export function MicDictate({ onText, onProblem }: { onText: (text: string) => void; onProblem?: (message: string) => void }): JSX.Element {
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MicRecorder | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      recorderRef.current?.cancel()
    }
  }, [])

  async function start(): Promise<void> {
    setError(null)
    const recorder = new MicRecorder()
    recorderRef.current = recorder
    try {
      await recorder.start()
      setState('recording')
    } catch (startError) {
      recorder.cancel()
      recorderRef.current = null
      const message = startError instanceof Error ? startError.message : String(startError)
      setError(/NotAllowed|denied|Permission/i.test(message) ? t.voice.micDenied : t.voice.micUnavailable)
      setState('idle')
      onProblem?.(message)
    }
  }

  async function finish(): Promise<void> {
    const recorder = recorderRef.current
    if (!recorder) return
    setState('working')
    try {
      const take = await recorder.stop()
      recorderRef.current = null
      const result = await window.api.voice.dictate({ mime: take.mime, audio: take.audio })
      if (!alive.current) return
      if (result.ok) onText(result.text)
      else setError(result.error ?? t.voice.micUnavailable)
    } catch (gradeError) {
      recorderRef.current?.cancel()
      recorderRef.current = null
      if (alive.current) setError(gradeError instanceof Error ? gradeError.message : String(gradeError))
    } finally {
      if (alive.current) setState('idle')
    }
  }

  function stop(): void {
    recorderRef.current?.cancel()
    recorderRef.current = null
    setState('idle')
  }

  return (
    <span className="inline-flex items-center gap-2">
      {state === 'recording' ? (
        <>
          <button
            type="button"
            onClick={() => void finish()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-2.5 py-1.5 text-xs font-semibold text-surface transition-colors hover:bg-danger/90"
          >
            <StopIcon />
            {t.voice.sendDictation}
          </button>
          <button
            type="button"
            onClick={stop}
            aria-label={t.common.cancel}
            className="rounded-lg border border-line px-2 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            ×
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={state === 'working'}
          title={error ?? undefined}
          aria-label={t.voice.dictate}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
        >
          <MicIcon />
          {state === 'working' ? t.voice.scoring : t.voice.dictate}
        </button>
      )}
      {error && (
        <span role="status" className="text-[10px] text-danger">
          {error}
        </span>
      )}
    </span>
  )
}

export function VoiceUnsupportedCard({ status }: { status: VoiceStatus | null }): JSX.Element | null {
  if (!status || status.mode === 'provider') return null
  return (
    <div className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-xs text-ink">
      <p className="font-semibold">{t.voice.noProviderVoice}</p>
      <p className="mt-1 text-muted">{status.detail ?? t.voice.noProviderHelp}</p>
    </div>
  )
}

function MicIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-3.5" aria-hidden="true">
      <path d="M12 4.5a2.6 2.6 0 0 1 2.6 2.6v4a2.6 2.6 0 0 1-5.2 0v-4A2.6 2.6 0 0 1 12 4.5Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function StopIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-3.5" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** Reuso do WAV-encoder em teste de renderer (exporta para não duplicar lógica). */
export { encodeTake }
