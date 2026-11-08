/**
 * V2 — áudio no renderer.
 *
 * Dois papéis, nenhum deles com dependência nova:
 *
 * - **gravar**: `MediaRecorder` pega o microfone; o blob é decodificado pelo
 *   Web Audio e reamostrado para **WAV PCM16 mono 16 kHz** — o formato que
 *   qualquer provedor de ASR aceita. Mandar `audio/webm;codecs=opus` do
 *   Chromium para um modelo de transcrição é pedir um erro criptico.
 * - **ouvir**: a voz do sistema (Web Speech API) como alternativa quando o
 *   provedor não sintetiza nada (Ollama). No Linux sem voz instalada
 *   `getVoices()` vem vazio: é por isso que `systemVoicesSupported` checa de
 *   verdade, em vez de assumir que `speechSynthesis` existe e funciona.
 */

export interface RecordedTake {
  /** base64 sem data URL — o que o `voice:grade` espera. */
  audio: string
  mime: string
  durationMs: number
}

const TARGET_SAMPLE_RATE = 16_000

export function systemVoicesSupported(): boolean {
  if (typeof window === 'undefined') return false
  const synth = window.speechSynthesis
  if (!synth || typeof SpeechSynthesisUtterance !== 'function') return false
  try {
    return synth.getVoices().length > 0
  } catch {
    return false
  }
}

export function pickSystemVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined') return null
  try {
    const voices = window.speechSynthesis.getVoices()
    if (voices.length === 0) return null
    const wanted = lang.toLowerCase()
    return (
      voices.find((voice) => voice.lang.toLowerCase() === wanted) ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith(wanted.split('-')[0] ?? wanted)) ??
      null
    )
  } catch {
    return null
  }
}

/** Fala pela voz do sistema. Resolve quando termina; rejeita se não há voz. */
export function speakWithSystemVoice(text: string, lang: string, rate = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      reject(new Error('no-speech-synthesis'))
      return
    }
    const voice = pickSystemVoice(lang)
    if (!voice) {
      reject(new Error('no-voice-for-lang'))
      return
    }

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = voice.lang
    utterance.voice = voice
    utterance.rate = rate
    utterance.onend = () => resolve()
    utterance.onerror = () => reject(new Error('speech-synthesis-failed'))

    try {
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    } catch {
      reject(new Error('speech-synthesis-failed'))
    }
  })
}

export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices != null &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  )
}

/**
 * Gravador de uma fala. `start` pede o microfone (o SO decide); `stop` devolve o
 * WAV já convertido para o provedor. Cancelar não deixa stream aberto.
 */
export class MicRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startedAt = 0

  async start(): Promise<void> {
    if (!micSupported()) throw new Error('mic-unsupported')
    if (this.recorder) return

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this.stream = stream
    this.chunks = []

    const mime = preferredRecorderMime()
    this.recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.recorder.start(250)
    this.startedAt = Date.now()
  }

  get active(): boolean {
    return this.recorder != null && this.recorder.state !== 'inactive'
  }

  get elapsedMs(): number {
    return this.startedAt === 0 ? 0 : Date.now() - this.startedAt
  }

  async stop(): Promise<RecordedTake> {
    const recorder = this.recorder
    if (!recorder) throw new Error('not-recording')

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }))
      recorder.onerror = () => reject(new Error('recorder-failed'))
      recorder.stop()
    })

    this.release()
    return encodeTake(blob)
  }

  cancel(): void {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      // já parado
    }
    this.release()
  }

  private release(): void {
    this.recorder = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.startedAt = 0
  }
}

function preferredRecorderMime(): string | null {
  const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime
    } catch {
      return null
    }
  }
  return null
}

/**
 * Blob do microfone → WAV PCM16 mono 16 kHz em base64. `decodeAudioData` faz o
 * decode (opus/vorbis/aac) e o `OfflineAudioContext` a reamostragem — nada de
 * ffmpeg no app.
 */
export async function encodeTake(blob: Blob): Promise<RecordedTake> {
  const bytes = await blob.arrayBuffer()
  const durationFromBlob = estimateDurationMs(blob)

  const AudioContextClass: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) {
    // Sem Web Audio: devolve o original e o provedor decide (Gemini aceita ogg).
    return { audio: arrayBufferToBase64(bytes), mime: blob.type || 'audio/webm', durationMs: durationFromBlob }
  }

  const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
    const context = new AudioContextClass()
    const settle = <T,>(promise: Promise<T> | undefined, ok: (value: T) => void): void => {
      if (promise && typeof promise.then === 'function') promise.then(ok, () => reject(new Error('decode-failed')))
    }

    // Chromium aceita callback e também devolve promessa: resolve uma vez só.
    let done = false
    const finish = (buffer: AudioBuffer): void => {
      if (done) return
      done = true
      void context.close()
      resolve(buffer)
    }
    const fail = (): void => {
      if (done) return
      done = true
      void context.close().catch(() => undefined)
      reject(new Error('decode-failed'))
    }

    const handle = context.decodeAudioData(bytes.slice(0), finish, fail)
    settle(handle, finish)
  })

  const mono = await toMonoMonoRate(decoded, TARGET_SAMPLE_RATE)
  const wav = pcm16MonoToWav(mono.samples, mono.sampleRate)

  return {
    audio: arrayBufferToBase64(wav),
    mime: 'audio/wav',
    durationMs: Math.round((mono.samples.length / mono.sampleRate) * 1000)
  }
}

/**
 * Mix para mono + reamostragem num `OfflineAudioContext` — o render é
 * assíncrono por natureza, e `encodeTake` já é `async`, então não há atalho.
 */
async function toMonoMonoRate(buffer: AudioBuffer, sampleRate: number): Promise<{ samples: Float32Array; sampleRate: number }> {
  try {
    const frames = Math.max(1, Math.ceil(buffer.duration * sampleRate))
    const context = new OfflineAudioContext(1, frames, sampleRate)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.start(0)

    const rendered = await context.startRendering()
    const channel = rendered.getChannelData(0)
    return { samples: channel, sampleRate: rendered.sampleRate }
  } catch {
    // Reamostragem indisponível: pega o canal 0 na taxa original.
    return { samples: buffer.getChannelData(0), sampleRate: buffer.sampleRate }
  }
}

function pcm16MonoToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeText = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true)
    offset += bytesPerSample
  }

  return buffer
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** Sem Web Audio: tempo aproximado pelo tamanho (opus ~ 24 kbps nominal). */
function estimateDurationMs(blob: Blob): number {
  return Math.round((blob.size / 3_000) * 1000)
}
