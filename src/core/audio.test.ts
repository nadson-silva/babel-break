/**
 * V2 — áudio: WAV escrito à mão (44 bytes), leitura de cabeçalho, chave de cache
 * e os casos podres que um provedor de verdade devolve.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SAMPLE_RATE,
  MAX_AUDIO_BYTES,
  audioCacheKey,
  base64FromBuffer,
  bufferFromBase64,
  encodeWav,
  pcmDurationMs,
  readWavHeader,
  sampleRateFromMime,
  wavDurationMs
} from './audio'

const pcm = new Uint8Array(Array.from({ length: 24000 * 2 }, (_, index) => index % 2 === 0 ? 0x21 : 0x00))

describe('encodeWav', () => {
  it('gera cabeçalho RIFF/WAVE válido com o tamanho certo', () => {
    const wav = encodeWav(pcm, DEFAULT_SAMPLE_RATE)
    expect(wav.length).toBe(pcm.length + 44)
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length)
    expect(wav.readUInt32LE(40)).toBe(pcm.length)
    expect(wav.readUInt16LE(20)).toBe(1)
  })

  it('1 s de 24 kHz mono = 1000 ms de duração', () => {
    const info = readWavHeader(encodeWav(pcm, 24_000))
    expect(info?.dataLength).toBe(pcm.length)
    expect(wavDurationMs(encodeWav(pcm, 24_000))).toBe(1_000)
  })
})

describe('readWavHeader', () => {
  it('recusa o que não é WAV', () => {
    expect(readWavHeader(Buffer.from('não é áudio'))).toBeNull()
    expect(readWavHeader(new Uint8Array(4))).toBeNull()
  })

  it('atravessa chunks extras até o `data`', () => {
    const base = encodeWav(pcm, 24_000)
    // Um chunk `LIST` vazio entre `fmt ` e `data` — comum em saídas reais.
    const extra = Buffer.alloc(8)
    extra.write('LIST', 0, 'ascii')
    extra.writeUInt32LE(0, 4)
    const withExtra = Buffer.concat([base.subarray(0, 36), extra, base.subarray(36)])
    const info = readWavHeader(withExtra)
    expect(info?.dataOffset).toBe(44 + 8)
    expect(info?.dataLength).toBe(pcm.length)
    expect(wavDurationMs(withExtra)).toBe(1_000)
  })
})

describe('mime e duration', () => {
  it('extrai a taxa do mime do provedor', () => {
    expect(sampleRateFromMime('audio/pcm;rate=24000')).toBe(24_000)
    expect(sampleRateFromMime('audio/L16;rate=16000;channels=1')).toBe(16_000)
    expect(sampleRateFromMime('audio/wav')).toBeNull()
    expect(sampleRateFromMime(null)).toBeNull()
  })

  it('pcmDurationMs conta 16-bit por canal', () => {
    expect(pcmDurationMs(24_000 * 2, 24_000)).toBe(1_000)
    expect(pcmDurationMs(24_000 * 2, 24_000, 2)).toBe(500)
    expect(pcmDurationMs(0, 24_000)).toBe(0)
  })
})

describe('base64', () => {
  it('round-trip e data URL', () => {
    const text = base64FromBuffer(pcm)
    expect(bufferFromBase64(text)?.length).toBe(pcm.length)
    expect(bufferFromBase64(`data:audio/wav;base64,${text}`)?.length).toBe(pcm.length)
  })

  it('lixo vira null, não buffer vazio tocável', () => {
    expect(bufferFromBase64('')).toBeNull()
    expect(bufferFromBase64('@@@')).toBeNull()
  })
})

describe('chave do cache de áudio', () => {
  it('é estável e sensível a voz/idioma/modelo/texto', () => {
    const base = { lang: 'en', voice: 'Kore', model: 'tts-1', text: 'Hello there', schemaVersion: 1 }
    expect(audioCacheKey(base)).toBe(audioCacheKey({ ...base, text: '  hello   THERE ' }))
    expect(audioCacheKey(base)).not.toBe(audioCacheKey({ ...base, voice: 'Puck' }))
    expect(audioCacheKey(base)).not.toBe(audioCacheKey({ ...base, lang: 'es' }))
    expect(audioCacheKey(base)).not.toBe(audioCacheKey({ ...base, model: 'tts-2' }))
    expect(audioCacheKey(base)).not.toBe(audioCacheKey({ ...base, schemaVersion: 2 }))
    expect(audioCacheKey(base)).not.toBe(audioCacheKey({ ...base, text: 'Hello here' }))
  })

  it('o teto de cache existe (12 s em 24 kHz mono)', () => {
    expect(MAX_AUDIO_BYTES).toBe(576_000)
  })
})
