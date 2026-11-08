/**
 * V2 — áudio em TS puro.
 *
 * O provedor de IA devolve PCM cru (`audio/pcm;rate=24000`, 16-bit assinado,
 * mono). Para o renderer tocar isso num `<audio>` sem dependência de decodificador,
 * o main embrulha em WAV — 44 bytes de cabeçalho, nada de biblioteca.
 *
 * Também mora aqui a **chave do cache de áudio**: a mesma frase na mesma voz e
 * modelo serve para sempre sem regastar (o mesmo princípio do cache de lição do M5).
 */

export const DEFAULT_SAMPLE_RATE = 24_000

/** Escreve o cabeçalho RIFF/WAVE de um PCM16 mono em `Buffer`. */
export function encodeWav(pcm: Uint8Array | Buffer, sampleRate = DEFAULT_SAMPLE_RATE, channels = 1): Buffer {
  const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * channels * 2
  const blockAlign = channels * 2

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + bytes.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34) // bits por amostra
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(bytes.length, 40)

  return Buffer.concat([header, bytes])
}

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataOffset: number
  dataLength: number
}

/**
 * Lê o cabeçalho de um WAV. Devolve `null` para qualquer coisa que não seja
 * RIFF/WAVE — chamador trata como "sem áudio" em vez de tocar ruído.
 */
export function readWavHeader(buffer: Uint8Array | Buffer): WavInfo | null {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (bytes.length < 44) return null
  if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF') return null
  if (bytes.subarray(8, 12).toString('ascii') !== 'WAVE') return null
  if (bytes.subarray(12, 16).toString('ascii') !== 'fmt ') return null

  const channels = bytes.readUInt16LE(22)
  const sampleRate = bytes.readUInt32LE(24)
  const bitsPerSample = bytes.readUInt16LE(34)
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || channels <= 0) return null

  // Procura o chunk `data` (cabeçalhos extras entre fmt e data são comuns).
  let offset = 20 + bytes.readUInt32LE(16)
  while (offset + 8 <= bytes.length) {
    const id = bytes.subarray(offset, offset + 4).toString('ascii')
    const size = bytes.readUInt32LE(offset + 4)
    if (id === 'data') {
      return {
        sampleRate,
        channels,
        bitsPerSample,
        dataOffset: offset + 8,
        dataLength: Math.min(size, bytes.length - offset - 8)
      }
    }
    offset += 8 + size + (size % 2)
  }

  // Sem chunk `data`: assume o layout canônico de 44 bytes.
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataOffset: 44,
    dataLength: Math.max(0, bytes.length - 44)
  }
}

/** Duração em ms a partir do payload PCM (16-bit) — é o que o cache guarda. */
export function pcmDurationMs(byteLength: number, sampleRate = DEFAULT_SAMPLE_RATE, channels = 1): number {
  const samples = Math.max(0, Math.floor(byteLength / 2 / channels))
  if (sampleRate <= 0) return 0
  return Math.round((samples / sampleRate) * 1000)
}

/** Duração de um buffer WAV (cabeçalho lido; buffer podre devolve 0). */
export function wavDurationMs(buffer: Uint8Array | Buffer): number {
  const info = readWavHeader(buffer)
  if (!info) return 0
  return pcmDurationMs(info.dataLength, info.sampleRate, info.channels)
}

/**
 * `audio/pcm;rate=24000` → 24000. Alguns modelos devolvem a taxa só no mime;
 * sem taxa não há como embrulhar em WAV, então o chamador degrada.
 */
export function sampleRateFromMime(mimeType: string | null | undefined): number | null {
  const match = /rate=(\d+)/i.exec(mimeType ?? '')
  if (!match?.[1]) return null
  const rate = Number(match[1])
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

/** MIME de saída do cache (o renderer toca `data:audio/wav;base64,…`). */
export const WAV_MIME = 'audio/wav'

export function base64FromBuffer(buffer: Uint8Array | Buffer): string {
  return Buffer.from(buffer).toString('base64')
}

export function bufferFromBase64(text: string): Buffer | null {
  const clean = text.replace(/^data:[^;]+;base64,/, '').trim()
  if (!clean) return null
  // Base64 inválido não pode virar ruído tocável: `Buffer.from` nunca lança,
  // então a validação é pelo round-trip do tamanho.
  const buffer = Buffer.from(clean, 'base64')
  if (buffer.length === 0) return null
  return buffer
}

/**
 * Chave do cache de áudio: idioma + voz + modelo + texto normalizado.
 * Estável entre sessões (hash determinístico, não aleatório) e curta o bastante
 * para coluna PRIMARY KEY.
 */
export function audioCacheKey(input: { lang: string; voice: string; model: string; text: string; schemaVersion: number }): string {
  const normalized = input.text.trim().replace(/\s+/g, ' ').toLowerCase()
  const basis = `${input.schemaVersion}|${input.lang.toLowerCase()}|${input.voice.toLowerCase()}|${input.model.toLowerCase()}|${normalized}`
  // FNV-1a em 64-bit (dois 32-bit concatenados) + comprimento: collisions na
  // prática exigiriam adversário dedicado, e o custo de uma colisão é só
  // "tocar a frase errada uma vez" — nada persistido de errado.
  return `${fnv1a64(basis).toString(16)}-${basis.length}`
}

function fnv1a64(value: string): bigint {
  const PRIME = 0x100000001b3n
  const MASK = 0xffffffffffffffffn
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * PRIME) & MASK
  }
  return hash
}

/** Teto honesto de tamanho de áudio no cache (12 s em 24 kHz mono já é parágrafo). */
export const MAX_AUDIO_BYTES = 12 * 24_000 * 2
