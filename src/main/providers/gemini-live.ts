/**
 * V3 — conversa em tempo real no Gemini Live (voz-a-voz, bidirecional).
 *
 * É o segundo uso do `@google/genai` no app: o `generateContent` continua
 * dono do texto, do TTS e do ASR em turnos; aqui entra `ai.live.connect`, uma
 * WebSocket de sessão longa em que o micro do aluno entra como PCM 16 kHz e a
 * fala do tutor sai como PCM 24 kHz, com VAD, barge-in e transcrição dos dois
 * lados feitos pelo servidor.
 *
 * A classe `Live` do SDK é marcada experimental — por nada daqui vaza para
 * fora: o contrato do app é `RealtimeCapability`, e o gerenciador de sessão
 * (`voice-live.ts`) só conhece eventos nossos. Trocar de motor (ou de versão
 * do SDK) mexe neste arquivo e em mais nenhum.
 */
import { ActivityHandling, GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai'
import { GEMINI_VOICES, DEFAULT_VOICE, LIVE_INPUT_MIME, resolveVoice } from '../../core/voice'
import { sampleRateFromMime } from '../../core/audio'
import { getGeminiApiKey } from '../secrets'
import type {
  LiveSessionHandle,
  LiveStartOptions,
  ProviderLiveEvent,
  RealtimeCapability
} from './types'

/**
 * Modelos live GA. `native-audio` processa o som num modelo só (latência ~0,5 s
 * e barge-in melhor); o cascade antigo virou reserva se o GA sumir do mapa.
 */
export const GEMINI_LIVE_MODELS = ['gemini-live-2.5-flash-native-audio', 'gemini-live-2.5-flash-preview']
export const DEFAULT_GEMINI_LIVE_MODEL = 'gemini-live-2.5-flash-native-audio'

/** Teto da CONEXÃO (não da sessão): 15 s para abrir o socket. */
const CONNECT_TIMEOUT_MS = 15_000

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function client(): Promise<GoogleGenAI> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) {
    throw new Error('Chave da API do Gemini não configurada.')
  }
  return new GoogleGenAI({ apiKey })
}

/** Converte a mensagem do servidor nos eventos do nosso contrato. */
function translate(msg: LiveServerMessage): ProviderLiveEvent[] {
  const events: ProviderLiveEvent[] = []

  if (msg.setupComplete) {
    events.push({ type: 'ready' })
  }

  const content = msg.serverContent
  if (content) {
    for (const part of content.modelTurn?.parts ?? []) {
      const inline = part.inlineData
      if (inline?.data && (inline.mimeType ?? 'audio').startsWith('audio')) {
        events.push({
          type: 'audioChunk',
          audioBase64: inline.data,
          // mime diz a taxa ("audio/pcm;rate=24000"); ausente = padrão do motor.
          sampleRate: sampleRateFromMime(inline.mimeType) ?? undefined
        })
      }
    }
    // Texto do turno do modelo: com outputAudioTranscription ligado a fala vem
    // transcrita aqui; `finished=false` é o ditado em andamento.
    if (content.outputTranscription?.text != null) {
      events.push({
        type: 'modelTranscript',
        text: content.outputTranscription.text,
        partial: content.outputTranscription.finished !== true
      })
    }
    if (content.interimInputTranscription?.text != null && content.interimInputTranscription.text.trim()) {
      events.push({ type: 'userTranscript', text: content.interimInputTranscription.text, partial: true })
    }
    if (content.inputTranscription?.text != null) {
      events.push({
        type: 'userTranscript',
        text: content.inputTranscription.text,
        partial: content.inputTranscription.finished !== true
      })
    }
    if (content.interrupted) events.push({ type: 'interrupted' })
    if (content.turnComplete) events.push({ type: 'turnComplete' })
  }

  // Voz do aluno começando/parando — o player local precisa saber na hora.
  const activity = msg.voiceActivity?.voiceActivityType
  if (activity === 'ACTIVITY_START' || activity === 'ACTIVITY_END') {
    events.push({ type: 'userActivity', active: activity === 'ACTIVITY_START' })
  }

  if (msg.goAway) {
    events.push({ type: 'goAway', message: msg.goAway.timeLeft ?? undefined })
  }

  if (msg.sessionResumptionUpdate) {
    events.push({
      type: 'resumption',
      resumptionHandle: msg.sessionResumptionUpdate.resumable
        ? (msg.sessionResumptionUpdate.newHandle ?? null)
        : null
    })
  }

  return events
}

export const geminiLive: RealtimeCapability = {
  engineId: 'gemini-live',
  liveModels: GEMINI_LIVE_MODELS,
  defaultLiveModel: DEFAULT_GEMINI_LIVE_MODEL,
  voices: GEMINI_VOICES.map((voice) => voice.id),
  defaultVoice: DEFAULT_VOICE,

  async startLiveSession(options: LiveStartOptions, onEvent): Promise<LiveSessionHandle> {
    const ai = await client()
    let closed = false
    let readySent = false
    let closedSent = false

    const emit = (event: ProviderLiveEvent): void => {
      if (event.type === 'ready') {
        if (readySent) return
        readySent = true
      }
      if (event.type === 'closed') {
        // onclose do socket e o close() explícito disparam o mesmo fim: um.
        if (closedSent) return
        closedSent = true
        closed = true
        onEvent(event)
        return
      }
      if (closed) return
      onEvent(event)
    }

    const connectController = new AbortController()
    const connectTimer = setTimeout(() => {
      connectController.abort(new Error('A conexão com o tempo real expirou.'))
    }, CONNECT_TIMEOUT_MS)
    // A sessão live é longa: o timeout morre junto com o `connect`. Depois de
    // aberta, só morre pelo signal do gerenciador (parar a chamada) ou pelo
    // socket. Um `AbortSignal.timeout` vivo aqui derrubaria a chamada inteira.
    const abortSignal = options.signal
      ? typeof AbortSignal.any === 'function'
        ? AbortSignal.any([options.signal, connectController.signal])
        : options.signal
      : connectController.signal

    let session
    try {
      session = await ai.live.connect({
        model: options.model.trim() || DEFAULT_GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: options.systemInstruction,
          temperature: 0.7,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: resolveVoice(options.voice) } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // Retomada nativa: o servidor devolve um handle e a sessão sobrevive
          // ao GoAway de ~10 min sem reinjetar histórico.
          sessionResumption: options.resumptionHandle ? { handle: options.resumptionHandle } : {},
          realtimeInputConfig: {
            activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            automaticActivityDetection:
              options.turnMode === 'manual'
                ? { disabled: true }
                : {
                    // O aluno pausa no meio da frase — 800 ms de silêncio é o
                    // equilíbrio entre não cortar ideia e não demorar a resposta.
                    silenceDurationMs: 800
                  }
          },
          abortSignal
        },
        callbacks: {
          onopen: () => undefined,
          onmessage: (msg: LiveServerMessage) => {
            for (const event of translate(msg)) emit(event)
          },
          onerror: (error) => {
            emit({ type: 'error', message: errorMessage(error) })
          },
          onclose: (closeEvent) => {
            const reason = (closeEvent as unknown as { reason?: string })?.reason
            emit({ type: 'closed', message: reason || undefined })
          }
        }
      })
    } finally {
      clearTimeout(connectTimer)
    }

    // Sessão retomada sem handle nativo (motor local ou primeira versão do
    // goAway): o gerenciador manda o histórico textual, que pré-preenche o
    // contexto do modelo na ordem garantida.
    if (options.history && options.history.length > 0) {
      session.sendClientContent({
        turns: options.history.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }]
        })),
        turnComplete: false
      })
    }

    const guard = (action: () => void): void => {
      if (closed) return
      try {
        action()
      } catch (error) {
        emit({ type: 'error', message: errorMessage(error) })
      }
    }

    return {
      sendAudio(audioBase64: string): void {
        // PCM16 16 kHz do micro — o servidor segmenta e detecta o turno.
        guard(() => session.sendRealtimeInput({ audio: { mimeType: LIVE_INPUT_MIME, data: audioBase64 } }))
      },
      sendText(text: string): void {
        // Texto no lugar de áudio fecha o turno e cobra resposta.
        guard(() =>
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true
          })
        )
      },
      pushToTalk(open: boolean): void {
        // Só tem sentido com VAD desligado (turnMode manual): os sinais são
        // ignorados no automático, então mandar é inofensivo.
        guard(() => session.sendRealtimeInput(open ? { activityStart: {} } : { activityEnd: {} }))
      },
      interrupt(): void {
        // Barge-in na nuvem é feito pelo servidor quando o aluno fala; o
        // interrupt() local existe para o motor do Lote 6 e para push-to-talk.
        if (options.turnMode === 'manual') {
          guard(() => session.sendRealtimeInput({ activityStart: {} }))
        }
      },
      close(): void {
        if (closed) return
        try {
          session.close()
        } catch {
          // socket já morto — o evento 'closed' veio (ou virá) pelo onclose.
        }
        emit({ type: 'closed' })
      }
    }
  }
}
