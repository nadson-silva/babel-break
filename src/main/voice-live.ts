/**
 * V3 — conversa por voz em tempo real: o gerenciador de sessão ao vivo.
 *
 * O motor (Gemini Live hoje, sherpa-onnx no Lote 6) é plugável atrás de
 * `RealtimeCapability`. Este módulo é o que NÃO é o motor:
 *
 * 1. **Uma chamada por vez**: o renderer liga/desliga; nada roda sem botão.
 * 2. **Retomada**: o Live API derruba a conexão em ~10 min (`goAway`) e o
 *    socket pode cair sozinho. A sessão do USUÁRIO (o `sessionId`) sobrevive:
 *    reconectamos com o handle nativo de resumption — ou, sem handle,
 *    reinjetando as últimas falas como texto. O renderer não precisa saber.
 * 3. **Transcrições viram turnos**: `userTranscript`/`modelTranscript` finais
 *    alimentam o histórico de retomada (o Lote 3 os grava em `messages` e roda
 *    a passada de correção pós-turno).
 * 4. **Eventos com carimbo**: `voiceLive:event` é global como `chat:event`
 *    (M6/E4) — `sessionId` + `conversationId` em tudo. Uma `generation` interna
 *    descarta eventos de conexões velhas quando a retomada troca o socket.
 *
 * O segredo da API nunca saiu do processo main, e o áudio do micro viaja em
 * chunks de ~100 ms em base64 — o mesmo formato dos canais de voz da v2, só
 * que contínuo.
 */
import { BrowserWindow } from 'electron'
import type {
  ChatMessage,
  VoiceLiveEvent,
  VoiceLiveStartInput,
  VoiceLiveStartView,
  VoiceLiveState,
  VoiceLiveStatusView,
  VoiceLiveTurnMode
} from '../shared/types'
import { clampLevel } from '../core/cefr'
import { LIVE_OUTPUT_SAMPLE_RATE } from '../core/voice'
import { liveOpenerMessage, liveVoiceSystem, type TutorContext } from '../core/prompts'
import { runtimeText } from '../core/runtime-text'
import { errorHints } from './notebook'
import { liveContextFor } from './tutor'
import { localeFor, nativeLangFor, profileRow } from './locale'
import { getProvider } from './providers'
import type { LiveSessionHandle, LiveStartOptions, ProviderLiveEvent, RealtimeCapability } from './providers/types'
import { getSettings } from './settings'
import { resolveProfileId } from './profiles'
import { handle } from './ipc-contract'

export const LIVE_CHANNEL = 'voiceLive:event'

/** Tentativas de reconexão antes de desistir — depois disso a UI diz a verdade. */
const MAX_RECONNECTS = 3
const RECONNECT_DELAY_MS = 400
/** Máximo de turnos reinjetados numa retomada sem handle nativo. */
const RESUME_HISTORY_TURNS = 20

// --- costura de teste (mesmo padrão de `setSpeechEngineForTest`) --------------

let engineOverride: RealtimeCapability | null = null
let overrideActive = false

export function setLiveEngineForTest(engine: RealtimeCapability | null): void {
  engineOverride = engine
  overrideActive = true
}

export function clearLiveEngineOverrideForTest(): void {
  engineOverride = null
  overrideActive = false
}

function liveEngine(): RealtimeCapability | null {
  const settings = getSettings()
  if (!settings.voiceEnabled) return null
  if (overrideActive) return engineOverride
  return getProvider(settings.provider).live ?? null
}

// --- eventos ------------------------------------------------------------------

const listeners = new Set<(event: VoiceLiveEvent) => void>()

/** Para testes e módulos do main; o push ao renderer já vai por `webContents.send`. */
export function onLiveEvent(listener: (event: VoiceLiveEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function push(event: VoiceLiveEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // ouvinte podre não derruba a chamada
    }
  }
  for (const window of typeof BrowserWindow.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : []) {
    if (!window.isDestroyed()) window.webContents.send(LIVE_CHANNEL, event)
  }
}

// --- a sessão ------------------------------------------------------------------

interface LiveRuntime {
  sessionId: string
  engine: RealtimeCapability
  handle: LiveSessionHandle | null
  profileId: number
  conversationId: number | null
  turnMode: VoiceLiveTurnMode
  state: VoiceLiveState
  baseOptions: Pick<LiveStartOptions, 'model' | 'voice' | 'rate' | 'systemInstruction'>
  turns: ChatMessage[]
  userPartial: string
  modelPartial: string
  resumptionHandle: string | null
  /** Backoff da tentativa atual (reinicia quando a conexão pegou). */
  reconnectAttempts: number
  /**
   * Circuito de reconexão: contar tentativas não basta — se o servidor aceita
   * e derruba na hora, o `ready` resetaria o contador para sempre. Contamos
   * mortes RAPIDINHAS (< 5 s de vida); uma conexão que pegou e morreu depois
   * não pertence mais à série.
   */
  quickFlaps: number
  connectedAt: number
  closing: boolean
  /** Texto de abertura (uma vez por chamada; retomadas não se apresentam). */
  openerText: string | null
  controller: AbortController
  /**
   * Geração da CONEXÃO atual. Cada tentativa de reconexão incrementa. Eventos
   * do motor chegam com o número da conexão que os emitiu: se divergir, é
   * socket velho (o `closed` disparado pelo próprio `close()` de um reconnect,
   * parciais tardios) e é descartado.
   */
  generation: number
}

let current: LiveRuntime | null = null
let sequence = 0

function nextSessionId(): string {
  sequence += 1
  return `live-${Date.now().toString(36)}-${sequence}`
}

function trimTurns(runtime: LiveRuntime): void {
  if (runtime.turns.length > RESUME_HISTORY_TURNS * 2) {
    runtime.turns.splice(0, runtime.turns.length - RESUME_HISTORY_TURNS * 2)
  }
}

function commitUser(runtime: LiveRuntime, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  runtime.turns.push({ role: 'user', content: trimmed })
  trimTurns(runtime)
}

function commitModel(runtime: LiveRuntime, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  runtime.turns.push({ role: 'assistant', content: trimmed })
  trimTurns(runtime)
}

function stamp(runtime: LiveRuntime): Pick<VoiceLiveEvent, 'sessionId' | 'conversationId' | 'engine'> {
  return {
    sessionId: runtime.sessionId,
    conversationId: runtime.conversationId,
    engine: runtime.engine.engineId
  }
}

function setState(runtime: LiveRuntime, state: VoiceLiveState): void {
  runtime.state = state
  push({ ...stamp(runtime), type: 'state', state })
}

/**
 * Fecha o que ficou pendente quando um turno termina ou é interrompido. O
 * servidor emite `turnComplete`/`interrupted` sem garantir que a última
 * transcrição parcial já teve o `finished` correspondente.
 */
function flushPartials(runtime: LiveRuntime): void {
  if (runtime.userPartial) {
    push({ ...stamp(runtime), type: 'userTranscript', text: runtime.userPartial, partial: false })
    commitUser(runtime, runtime.userPartial)
    runtime.userPartial = ''
  }
  if (runtime.modelPartial) {
    push({ ...stamp(runtime), type: 'modelTranscript', text: runtime.modelPartial, partial: false })
    commitModel(runtime, runtime.modelPartial)
    runtime.modelPartial = ''
  }
}

/**
 * A saudação do tutor. O `ready` pode chegar antes de o handle ser atribuído
 * (emissores síncronos); os dois caminhos chamam esta função, que só age com
 * handle em mãos e turno zero — e nunca se repete numa mesma chamada.
 */
function maybeSendOpener(runtime: LiveRuntime): void {
  if (!runtime.openerText || runtime.turns.length > 0 || !runtime.handle) return
  const opener = runtime.openerText
  runtime.openerText = null
  try {
    runtime.handle.sendText(opener)
  } catch {
    // saudação é cortesia; a conversa existe sem ela
  }
}

function onProviderEvent(runtime: LiveRuntime, generation: number, event: ProviderLiveEvent): void {
  if (current !== runtime) return // sessão velha (parada ou substituída)
  if (generation !== runtime.generation) return // socket velho da mesma sessão

  switch (event.type) {
    case 'ready':
      runtime.connectedAt = Date.now()
      runtime.reconnectAttempts = 0
      setState(runtime, 'ready')
      maybeSendOpener(runtime)
      break

    case 'userActivity':
      if (event.active) setState(runtime, 'listening')
      push({ ...stamp(runtime), type: 'userActivity', active: event.active })
      break

    case 'userTranscript':
      if (event.partial) {
        runtime.userPartial = event.text ?? ''
        if (runtime.state !== 'listening') setState(runtime, 'listening')
        push({ ...stamp(runtime), type: 'userTranscript', text: runtime.userPartial, partial: true })
      } else {
        runtime.userPartial = ''
        commitUser(runtime, event.text ?? '')
        push({ ...stamp(runtime), type: 'userTranscript', text: event.text ?? '', partial: false })
      }
      break

    case 'modelTranscript':
      if (event.partial) {
        runtime.modelPartial = event.text ?? ''
        push({ ...stamp(runtime), type: 'modelTranscript', text: runtime.modelPartial, partial: true })
      } else {
        runtime.modelPartial = ''
        commitModel(runtime, event.text ?? '')
        push({ ...stamp(runtime), type: 'modelTranscript', text: event.text ?? '', partial: false })
      }
      break

    case 'audioChunk':
      if (runtime.state !== 'speaking') setState(runtime, 'speaking')
      push({
        ...stamp(runtime),
        type: 'audioChunk',
        audio: event.audioBase64,
        sampleRate: event.sampleRate ?? LIVE_OUTPUT_SAMPLE_RATE
      })
      break

    case 'interrupted':
      // O aluno cortou o tutor: o player local esvazia na hora, e o que o
      // tutor chegou a dizer fecha como turno (é o que ele "falou").
      flushPartials(runtime)
      setState(runtime, 'listening')
      push({ ...stamp(runtime), type: 'interrupted' })
      break

    case 'turnComplete':
      flushPartials(runtime)
      setState(runtime, 'listening')
      push({ ...stamp(runtime), type: 'turnComplete' })
      break

    case 'resumption':
      runtime.resumptionHandle = event.resumptionHandle ?? null
      break

    case 'goAway':
      push({ ...stamp(runtime), type: 'goAway', message: event.message })
      scheduleReconnect(runtime)
      break

    case 'error':
      push({ ...stamp(runtime), type: 'error', message: event.message })
      break

    case 'closed':
      if (runtime.closing) break // stop já emitiu o 'ended'
      scheduleReconnect(runtime)
      break
  }
}

function failRuntime(runtime: LiveRuntime, message: string): void {
  if (current === runtime) current = null
  runtime.state = 'error'
  push({ ...stamp(runtime), type: 'error', message })
}

function scheduleReconnect(runtime: LiveRuntime): void {
  if (runtime.closing || current !== runtime) return

  // Morte "lenta" (conexão viveu > 5 s) quebra a série de flaps: não é o
  // mesmo servidor recusando, é a vida longa da chamada encontrando um goAway.
  if (Date.now() - runtime.connectedAt > 5_000) runtime.quickFlaps = 0
  runtime.quickFlaps += 1

  if (runtime.quickFlaps > MAX_RECONNECTS) {
    const native = nativeLangFor(runtime.profileId)
    failRuntime(runtime, runtimeText(native, 'error.voiceLiveUnavailable'))
    return
  }

  runtime.reconnectAttempts += 1
  setState(runtime, 'resuming')
  setTimeout(() => {
    void reconnect(runtime)
  }, RECONNECT_DELAY_MS * runtime.reconnectAttempts)
}

async function reconnect(runtime: LiveRuntime): Promise<void> {
  if (current !== runtime || runtime.closing) return

  runtime.generation += 1
  const generation = runtime.generation

  try {
    runtime.handle?.close()
  } catch {
    // melhor esforço — o evento `closed` deste socket cai na geração velha.
  }
  runtime.handle = null

  // Handle nativo restaura o estado no servidor (turnos já incluídos); sem
  // ele, reinjetamos o histórico textual. Os dois juntos duplicariam contexto.
  const useHandle = runtime.resumptionHandle != null

  const open = (viaHandle: boolean): Promise<LiveSessionHandle> =>
    runtime.engine.startLiveSession(
      {
        ...runtime.baseOptions,
        turnMode: runtime.turnMode,
        ...(viaHandle ? { resumptionHandle: runtime.resumptionHandle } : { history: [...runtime.turns] }),
        signal: runtime.controller.signal
      },
      (event) => onProviderEvent(runtime, generation, event)
    )

  try {
    runtime.handle = await open(useHandle)
    maybeSendOpener(runtime)
  } catch (error) {
    if (!useHandle) {
      failRuntime(runtime, error instanceof Error ? error.message : String(error))
      return
    }
    // Handle podre (servidor reiniciado): mais honesto que derrubar a chamada
    // é tentar de novo pela via do texto — uma vez.
    runtime.resumptionHandle = null
    try {
      runtime.handle = await open(false)
      maybeSendOpener(runtime)
    } catch (retryError) {
      failRuntime(runtime, retryError instanceof Error ? retryError.message : String(retryError))
    }
  }
}

// --- superfície pública (handlers e testes) -----------------------------------

function freshContext(profileId: number, topic: string | null): TutorContext {
  const profile = profileRow(profileId)
  if (!profile) throw new Error('Perfil não encontrado.')
  return {
    level: clampLevel(profile.cefr),
    goal: profile.goal ?? '',
    style: getSettings().correctionStyle,
    errors: errorHints(profileId, 6),
    vocabulary: [],
    summary: null,
    lesson: null,
    topic,
    scenario: null,
    locale: localeFor(profile)
  }
}

export async function startLiveSession(
  profileId: number,
  input: VoiceLiveStartInput = {}
): Promise<VoiceLiveStartView> {
  // Idempotente: ligar de novo durante uma chamada ativa devolve a mesma.
  if (current && !current.closing && current.state !== 'error') {
    return { ok: true, sessionId: current.sessionId, conversationId: current.conversationId, state: current.state }
  }

  const engine = liveEngine()
  if (!engine) {
    return { ok: false, error: runtimeText(nativeLangFor(profileId), 'error.voiceLiveUnavailable') }
  }

  const settings = getSettings()
  let context: TutorContext
  let history: ChatMessage[] = []

  try {
    if (input.conversationId) {
      const prepared = liveContextFor(profileId, input.conversationId)
      context = prepared.context
      history = prepared.window
    } else {
      context = freshContext(profileId, input.topic?.trim() || null)
    }
  } catch (error) {
    // conversa de outro perfil/inexistente: {ok:false} honesto, não rejection (M6/B9)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const turnMode: VoiceLiveTurnMode = input.turnMode ?? 'vad'
  const runtime: LiveRuntime = {
    sessionId: nextSessionId(),
    engine,
    handle: null,
    profileId,
    conversationId: input.conversationId ?? null,
    turnMode,
    state: 'connecting',
    baseOptions: {
      model: settings.liveModel.trim() || engine.defaultLiveModel,
      voice: settings.voiceName.trim() || engine.defaultVoice,
      rate: settings.speechRate,
      systemInstruction: liveVoiceSystem({ context, rate: settings.speechRate, turnMode })
    },
    turns: [],
    userPartial: '',
    modelPartial: '',
    resumptionHandle: null,
    reconnectAttempts: 0,
    quickFlaps: 0,
    connectedAt: 0,
    closing: false,
    // Retomada de conversa não se apresenta de novo.
    openerText: history.length > 0 ? null : liveOpenerMessage(context),
    controller: new AbortController(),
    generation: 1
  }

  current = runtime
  push({ ...stamp(runtime), type: 'state', state: 'connecting' })

  const generation = runtime.generation
  try {
    runtime.handle = await engine.startLiveSession(
      {
        ...runtime.baseOptions,
        turnMode,
        ...(history.length > 0 ? { history } : {}),
        signal: runtime.controller.signal
      },
      (event) => onProviderEvent(runtime, generation, event)
    )
    maybeSendOpener(runtime)
  } catch (error) {
    failRuntime(runtime, error instanceof Error ? error.message : String(error))
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  return { ok: true, sessionId: runtime.sessionId, conversationId: runtime.conversationId, state: runtime.state }
}

function sameSession(sessionId?: string | null): LiveRuntime | null {
  if (!current) return null
  if (sessionId && current.sessionId !== sessionId) return null
  return current
}

export function pushLiveAudio(sessionId: string, audioBase64: string): boolean {
  const runtime = sameSession(sessionId)
  if (!runtime?.handle) return false
  try {
    runtime.handle.sendAudio(audioBase64)
    return true
  } catch {
    return false
  }
}

/** Texto digitado durante a chamada — vira turno do aluno sem virar transcrição. */
export function sendLiveText(sessionId: string, text: string): boolean {
  const runtime = sameSession(sessionId)
  if (!runtime?.handle) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  commitUser(runtime, trimmed)
  try {
    runtime.handle.sendText(trimmed)
    return true
  } catch {
    return false
  }
}

export function interruptLive(sessionId?: string | null): boolean {
  const runtime = sameSession(sessionId)
  if (!runtime?.handle) return false
  try {
    runtime.handle.interrupt()
    return true
  } catch {
    return false
  }
}

export function pushToTalkLive(sessionId: string, open: boolean): boolean {
  const runtime = sameSession(sessionId)
  if (!runtime?.handle) return false
  try {
    runtime.handle.pushToTalk(open)
    return true
  } catch {
    return false
  }
}

/**
 * Trocar VAD automático ⇄ push-to-talk exige um novo connect (a configuração
 * vive na conexão). A chamada continua a mesma: mesmo `sessionId`, mesmos
 * turnos — só muda a detecção de fim de fala.
 */
export async function setLiveTurnMode(sessionId: string, mode: VoiceLiveTurnMode): Promise<VoiceLiveStartView> {
  const runtime = sameSession(sessionId)
  if (!runtime) return { ok: false, error: 'Nenhuma chamada ativa.' }
  if (runtime.turnMode === mode) {
    return { ok: true, sessionId: runtime.sessionId, conversationId: runtime.conversationId, state: runtime.state }
  }
  runtime.turnMode = mode
  // O handle de retomada não carrega a config nova — usa o histórico textual.
  runtime.resumptionHandle = null
  runtime.quickFlaps = 0
  setState(runtime, 'resuming')
  await reconnect(runtime)
  return { ok: true, sessionId: runtime.sessionId, conversationId: runtime.conversationId, state: runtime.state }
}

export function stopLiveSession(sessionId?: string | null): VoiceLiveStartView {
  const runtime = sameSession(sessionId ?? null)
  if (!runtime) {
    return { ok: true, state: 'ended' }
  }

  runtime.closing = true
  if (current === runtime) current = null
  try {
    runtime.handle?.close()
  } catch {
    // nada a fechar
  }
  runtime.controller.abort()
  runtime.state = 'ended'
  push({ ...stamp(runtime), type: 'state', state: 'ended' })
  push({ ...stamp(runtime), type: 'ended' })
  return { ok: true, sessionId: runtime.sessionId, conversationId: runtime.conversationId, state: 'ended' }
}

export function liveStatus(profileId = resolveProfileId()): VoiceLiveStatusView {
  const engine = liveEngine()
  return {
    available: engine != null,
    active: current != null && !current.closing,
    sessionId: current?.sessionId ?? null,
    state: current?.state ?? 'idle',
    engine: engine?.engineId ?? null,
    conversationId: current?.conversationId ?? null,
    turnMode: current?.turnMode ?? 'vad',
    detail: engine ? null : runtimeText(nativeLangFor(profileId), 'error.voiceLiveUnavailable')
  }
}

/** Para testes: derruba a sessão atual sem passar pelo IPC. */
export function resetLiveForTest(): void {
  if (current) {
    current.closing = true
    current.controller.abort()
    try {
      current.handle?.close()
    } catch {
      // nada a fechar
    }
  }
  current = null
  listeners.clear()
}

// --- IPC ------------------------------------------------------------------------

export function registerVoiceLiveIpc(): void {
  handle('voiceLive:start', (_event, input: VoiceLiveStartInput = {}) =>
    startLiveSession(resolveProfileId(), input)
  )

  handle('voiceLive:stop', (_event, sessionId?: string) => stopLiveSession(sessionId))

  handle('voiceLive:status', () => liveStatus())

  handle('voiceLive:audio', (_event, input: { sessionId: string; audio: string }) =>
    pushLiveAudio(input.sessionId, input.audio)
  )

  handle('voiceLive:text', (_event, input: { sessionId: string; text: string }) =>
    sendLiveText(input.sessionId, input.text)
  )

  handle('voiceLive:turn-mode', (_event, input: { sessionId: string; mode: VoiceLiveTurnMode }) =>
    setLiveTurnMode(input.sessionId, input.mode)
  )

  handle('voiceLive:interrupt', (_event, sessionId: string) => interruptLive(sessionId))

  /** Push-to-talk (modo manual): abrir/fechar o turno do aluno. */
  handle('voiceLive:push-to-talk', (_event, input: { sessionId: string; open: boolean }) =>
    pushToTalkLive(input.sessionId, input.open)
  )
}
