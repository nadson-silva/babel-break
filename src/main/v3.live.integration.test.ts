/**
 * V3 Lote 1 — conversa em tempo real, do motor ao IPC, sem rede.
 *
 * O motor é injetado (`setLiveEngineForTest` — o mesmo padrão de
 * `setSpeechEngineForTest`): o que este arquivo prova é o que o gerenciador
 * faz em volta dele — estado da chamada, transcrições que viram turnos,
 * retomada no `goAway` (handle nativo ou histórico reinjetado), o barge-in
 * que fecha o partial pendente, e a degradação honesta quando o provedor não
 * tem voz ao vivo (Ollama).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage, VoiceLiveEvent } from '../shared/types'
import type {
  LiveSessionHandle,
  LiveStartOptions,
  ProviderLiveEvent,
  RealtimeCapability
} from './providers/types'
import { initDatabase } from './db'
import { updateSettings } from './settings'
import { completeOnboarding } from './learning'
import { createConversation } from './tutor'
import { resetProviderStatus } from './provider-status'
import {
  clearLiveEngineOverrideForTest,
  interruptLive,
  liveStatus,
  onLiveEvent,
  pushLiveAudio,
  pushToTalkLive,
  resetLiveForTest,
  sendLiveText,
  setLiveEngineForTest,
  setLiveTurnMode,
  startLiveSession,
  stopLiveSession
} from './voice-live'

/** Uma "conexão" do fake: opções recebidas + o que o app mandou por ela. */
interface FakeConnection {
  options: LiveStartOptions
  emit: (event: ProviderLiveEvent) => void
  audio: string[]
  texts: string[]
  pushToTalk: boolean[]
  interrupts: number
  closed: boolean
}

const connections: FakeConnection[] = []
const events: VoiceLiveEvent[] = []
const learner = { profileId: 0, conversationId: 0 }

const fakeLive: RealtimeCapability = {
  engineId: 'fake-live',
  liveModels: ['fake-live-1'],
  defaultLiveModel: 'fake-live-1',
  voices: ['Kore'],
  defaultVoice: 'Kore',

  async startLiveSession(options, onEvent): Promise<LiveSessionHandle> {
    const connection: FakeConnection = {
      options,
      // `ready` sai por microtask — como um socket de verdade, depois que o
      // `connect` resolve e o handle existe.
      emit: onEvent,
      audio: [],
      texts: [],
      pushToTalk: [],
      interrupts: 0,
      closed: false
    }
    connections.push(connection)
    queueMicrotask(() => onEvent({ type: 'ready' }))

    return {
      sendAudio(audioBase64) {
        connection.audio.push(audioBase64)
      },
      sendText(text) {
        connection.texts.push(text)
      },
      pushToTalk(open) {
        connection.pushToTalk.push(open)
      },
      interrupt() {
        connection.interrupts += 1
      },
      close() {
        if (connection.closed) return
        connection.closed = true
        onEvent({ type: 'closed' })
      }
    }
  }
}

function lastConnection(): FakeConnection {
  const connection = connections[connections.length - 1]
  if (!connection) throw new Error('nenhuma conexão criada')
  return connection
}

function committedTurns(): ChatMessage[] {
  // O histórico reinjetado na última conexão é a janela de turnos do runtime.
  return lastConnection().options.history ?? []
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  initDatabase()
  updateSettings({
    provider: 'ollama',
    ollamaModel: '',
    ollamaBaseUrl: 'http://127.0.0.1:1',
    pregenerate: false,
    voiceEnabled: true,
    liveModel: '',
    voiceName: 'Kore',
    speechRate: 'normal'
  })
  resetProviderStatus()

  const state = completeOnboarding({ goal: 'viagem', cefr: 'A2', targetLang: 'en', nativeLang: 'pt-BR' })
  learner.profileId = state.profile.id
  const view = await createConversation(state.profile.id, { topic: 'hotéis' })
  learner.conversationId = view.conversation.id
})

beforeEach(() => {
  // `resetLiveForTest` limpa os listeners — a assinatura do collector é por
  // teste, não uma vez por arquivo (senão o segundo teste fica surdo).
  onLiveEvent((event) => events.push(event))
  setLiveEngineForTest(fakeLive)
})

afterEach(async () => {
  stopLiveSession()
  await sleep(0)
  resetLiveForTest()
  clearLiveEngineOverrideForTest()
  connections.length = 0
  events.length = 0
})

describe('degradação honesta', () => {
  it('sem motor ao vivo, a chamada não acontece e a UI recebe o motivo', async () => {
    setLiveEngineForTest(null)
    const status = liveStatus(learner.profileId)
    expect(status.available).toBe(false)
    expect(status.detail).toMatch(/tempo real/i)

    const start = await startLiveSession(learner.profileId, { topic: 'teste' })
    expect(start.ok).toBe(false)
    expect(start.error).toMatch(/tempo real/i)
  })

  it('voz desligada nas configurações derruba também o tempo real', async () => {
    updateSettings({ voiceEnabled: false })
    const status = liveStatus(learner.profileId)
    expect(status.available).toBe(false)
    updateSettings({ voiceEnabled: true })
  })

  it('conversa de outro dono recusa com {ok:false}, não com rejection', async () => {
    const start = await startLiveSession(learner.profileId, { conversationId: 99_999 })
    expect(start.ok).toBe(false)
    expect(start.error).toMatch(/conversa/i)
  })
})

describe('ciclo de uma chamada', () => {
  it('liga, o tutor abre a boca, e o áudio dos dois lados vira evento carimbado', async () => {
    const start = await startLiveSession(learner.profileId, { conversationId: learner.conversationId })
    expect(start.ok).toBe(true)
    expect(start.conversationId).toBe(learner.conversationId)
    const connection = lastConnection()

    // Instrução montada do contexto da conversa (tema + par de idiomas).
    expect(connection.options.systemInstruction).toContain('POR VOZ')
    expect(connection.options.systemInstruction).toContain('hotéis')
    expect(connection.options.model).toBe('fake-live-1')

    // O tutor se apresenta sem o aluno falar primeiro — turno de sistema,
    // enviado só depois que a conexão existe.
    await sleep(0)
    expect(connection.texts.length).toBe(1)
    expect(connection.texts[0]).toMatch(/Cumprimente|personagem/)

    const states = events.filter((event) => event.type === 'state').map((event) => event.state)
    expect(states).toEqual(['connecting', 'ready'])
    for (const event of events) {
      expect(event.sessionId).toBe(start.sessionId)
      expect(event.conversationId).toBe(learner.conversationId)
      expect(event.engine).toBe('fake-live')
    }

    // Microfone: o frame chega na conexão; sessionId errado é recusado.
    expect(pushLiveAudio(start.sessionId!, 'AAAA')).toBe(true)
    expect(connection.audio).toEqual(['AAAA'])
    expect(pushLiveAudio('live-estrela', 'AAAA')).toBe(false)

    // Aluno fala (parcial → final).
    connection.emit({ type: 'userTranscript', text: 'I want a', partial: true })
    connection.emit({ type: 'userTranscript', text: 'I want a hotel near the beach.', partial: false })
    const userEvents = events.filter((event) => event.type === 'userTranscript')
    expect(userEvents.map((event) => event.partial)).toEqual([true, false])
    expect(events.some((event) => event.type === 'state' && event.state === 'listening')).toBe(true)

    // Tutor responde: áudio em chunk + transcrição parcial e final.
    connection.emit({ type: 'audioChunk', audioBase64: '/2f/8A==', sampleRate: 24000 })
    connection.emit({ type: 'modelTranscript', text: 'Sure,', partial: true })
    connection.emit({ type: 'modelTranscript', text: 'Sure, I can help with that.', partial: false })
    connection.emit({ type: 'turnComplete' })

    const audioEvent = events.find((event) => event.type === 'audioChunk')
    expect(audioEvent?.audio).toBe('/2f/8A==')
    expect(audioEvent?.sampleRate).toBe(24000)
    expect(events.some((event) => event.type === 'state' && event.state === 'speaking')).toBe(true)
    expect(events.at(-1)?.type).toBe('turnComplete')

    // Desligar fecha a conexão e conta o fim.
    const stop = stopLiveSession(start.sessionId)
    expect(stop.ok).toBe(true)
    expect(connection.closed).toBe(true)
    expect(events.filter((event) => event.type === 'ended').length).toBe(1)
    expect(liveStatus(learner.profileId).active).toBe(false)
  })

  it('ligar duas vezes devolve a mesma chamada (uma por vez)', async () => {
    const first = await startLiveSession(learner.profileId, { topic: 'um' })
    const second = await startLiveSession(learner.profileId, { topic: 'dois' })
    expect(second.sessionId).toBe(first.sessionId)
    expect(connections.length).toBe(1)
  })

  it('texto digitado durante a chamada vira turno do aluno', async () => {
    const start = await startLiveSession(learner.profileId, { topic: 'um' })
    await sleep(0)
    expect(sendLiveText(start.sessionId!, 'Where is the station?')).toBe(true)
    expect(sendLiveText(start.sessionId!, '   ')).toBe(false)
    expect(sendLiveText('live-estrela', 'oi')).toBe(false)
    expect(lastConnection().texts).toContain('Where is the station?')
  })

  it('interrupted fecha o partial do tutor e derruba o player (evento)', async () => {
    const start = await startLiveSession(learner.profileId, { topic: 'um' })
    const connection = lastConnection()
    connection.emit({ type: 'modelTranscript', text: 'Well, you could', partial: true })
    connection.emit({ type: 'interrupted' })

    const finals = events.filter((event) => event.type === 'modelTranscript' && event.partial === false)
    expect(finals.map((event) => event.text)).toEqual(['Well, you could'])
    expect(events.at(-1)?.type).toBe('interrupted')
    expect(connection.interrupts).toBe(0) // o barge-in aqui veio do SERVIDOR
    expect(interruptLive(start.sessionId)).toBe(true) // e o botão local chega no motor
    expect(connection.interrupts).toBe(1)
  })

  it('push-to-talk (modo manual) vai ao motor pela conexão ativa', async () => {
    const start = await startLiveSession(learner.profileId, { topic: 'um', turnMode: 'manual' })
    await sleep(0)
    expect(lastConnection().options.turnMode).toBe('manual')
    expect(pushToTalkLive(start.sessionId!, true)).toBe(true)
    expect(pushToTalkLive(start.sessionId!, false)).toBe(true)
    expect(lastConnection().pushToTalk).toEqual([true, false])
  })
})

describe('retomada (goAway e socket caído)', () => {
  it('com handle nativo: reconecta por ele, sem reinjetar histórico', async () => {
    const start = await startLiveSession(learner.profileId, { topic: 'praia' })
    const first = lastConnection()
    await sleep(0)
    first.emit({ type: 'resumption', resumptionHandle: 'handle-42' })
    first.emit({ type: 'userTranscript', text: 'Any plans?', partial: false })

    first.emit({ type: 'goAway', message: '10m' })
    expect(events.some((event) => event.type === 'goAway')).toBe(true)
    expect(events.some((event) => event.type === 'state' && event.state === 'resuming')).toBe(true)

    await sleep(600) // primeiro backoff: 400 ms
    expect(connections.length).toBe(2)
    const second = lastConnection()
    expect(second.options.resumptionHandle).toBe('handle-42')
    expect(second.options.history).toBeUndefined()
    expect(second.options.systemInstruction).toBe(first.options.systemInstruction)
    // A chamada é a mesma: mesmo sessionId, o `closed` da conexão velha não
    // terminou nada nem agendou reconnect extra.
    expect(events.filter((event) => event.type === 'ended').length).toBe(0)
    expect(liveStatus(learner.profileId).sessionId).toBe(start.sessionId)

    // O novo `ready` vem com o contexto restaurado no servidor: o tutor não
    // recomeça a saudação.
    expect(second.texts).toEqual([])
  })

  it('sem handle: reinjeta o histórico textual (user+assistant fechados)', async () => {
    await startLiveSession(learner.profileId, { topic: 'trem' })
    const first = lastConnection()
    await sleep(0)
    first.emit({ type: 'userTranscript', text: 'The train is late.', partial: false })
    first.emit({ type: 'modelTranscript', text: 'Oh no. Which line?', partial: false })

    first.emit({ type: 'closed', message: 'socket caiu' })
    await sleep(600)
    expect(connections.length).toBe(2)
    const second = lastConnection()
    const history = committedTurns()
    expect(history).toEqual([
      { role: 'user', content: 'The train is late.' },
      { role: 'assistant', content: 'Oh no. Which line?' }
    ])
    // Retomada com histórico: o tutor não recomeça a saudação.
    expect(second.texts).toEqual([])
  })

  it('servidor que aceita e derruba na hora: o circuito desiste com honestidade', async () => {
    await startLiveSession(learner.profileId, { topic: 'fim' })

    // Quatro quedas seguidas (cada reconexão morre < 5 s depois do ready).
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const connection = connections[attempt]
      if (!connection) throw new Error(`conexão ${attempt} não criada`)
      connection.emit({ type: 'closed' })
      await sleep(520) // backoff de 400 ms + folga
    }

    expect(liveStatus(learner.profileId).active).toBe(false)
    const errorEvents = events.filter((event) => event.type === 'error')
    expect(errorEvents.length).toBe(1)
    expect(errorEvents[0]?.message).toMatch(/tempo real/i)
  })

  it('trocar o modo de turno reconecta a MESMA chamada com a config nova', async () => {
    const start = await startLiveSession(learner.profileId, { topic: 'modo' })
    const first = lastConnection()
    await sleep(0)
    first.emit({ type: 'userTranscript', text: 'Hello?', partial: false })

    const view = await setLiveTurnMode(start.sessionId!, 'manual')
    expect(view.ok).toBe(true)
    expect(connections.length).toBe(2)
    const second = lastConnection()
    expect(second.options.turnMode).toBe('manual')
    expect(second.options.resumptionHandle).toBeUndefined() // handle não carrega config nova
    expect(committedTurns()).toEqual([{ role: 'user', content: 'Hello?' }])
    expect(liveStatus(learner.profileId).sessionId).toBe(start.sessionId)
    expect(liveStatus(learner.profileId).turnMode).toBe('manual')
  })
})
