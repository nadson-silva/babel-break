/**
 * V2 — contrato de voz (TTS/ASR) em TS puro.
 *
 * Duas coisas mora aqui: o catálogo de vozes que os modelos Gemini TTS expõem
 * (nomes estáveis, exibidos como estão — são nomes próprios, não texto de
 * interface) e as **instruções de fala**, que são internas, como os prompts de
 * conteúdo. Diferente dos prompts de geração (PT-BR, língua de trabalho do app),
 * a instrução de TTS/ASR vai em inglês porque é a forma documentada e testada
 * pelo provedor para controlar estilo e ritmo; o texto a ser falado nunca é
 * tocado.
 */
import type { SpeechRate } from '../shared/types'

export interface VoiceOption {
  /** Nome exato aceito pelo provedor (`Kore`). */
  id: string
  /** Descriptor do provedor ('Firm', 'Warm'…). */
  style: string
}

/** As 30 vozes prebuilt do Gemini TTS (ordem do catálogo oficial). */
export const GEMINI_VOICES: VoiceOption[] = [
  { id: 'Zephyr', style: 'Bright' },
  { id: 'Puck', style: 'Upbeat' },
  { id: 'Charon', style: 'Informative' },
  { id: 'Kore', style: 'Firm' },
  { id: 'Fenrir', style: 'Excitable' },
  { id: 'Leda', style: 'Youthful' },
  { id: 'Orus', style: 'Firm' },
  { id: 'Aoede', style: 'Breezy' },
  { id: 'Callirrhoe', style: 'Easy-going' },
  { id: 'Autonoe', style: 'Bright' },
  { id: 'Enceladus', style: 'Breathy' },
  { id: 'Iapetus', style: 'Clear' },
  { id: 'Umbriel', style: 'Easy-going' },
  { id: 'Algieba', style: 'Smooth' },
  { id: 'Despina', style: 'Smooth' },
  { id: 'Erinome', style: 'Clear' },
  { id: 'Algenib', style: 'Gravelly' },
  { id: 'Rasalgethi', style: 'Informative' },
  { id: 'Laomedeia', style: 'Upbeat' },
  { id: 'Achernar', style: 'Soft' },
  { id: 'Alnilam', style: 'Firm' },
  { id: 'Schedar', style: 'Even' },
  { id: 'Gacrux', style: 'Mature' },
  { id: 'Pulcherrima', style: 'Forward' },
  { id: 'Achird', style: 'Friendly' },
  { id: 'Zubenelgenubi', style: 'Casual' },
  { id: 'Vindemiatrix', style: 'Gentle' },
  { id: 'Sadachbia', style: 'Lively' },
  { id: 'Sadaltager', style: 'Knowledgeable' },
  { id: 'Sulafat', style: 'Warm' }
]

export const DEFAULT_VOICE = 'Kore'

export function isKnownVoice(voice: string | null | undefined): boolean {
  return GEMINI_VOICES.some((entry) => entry.id.toLowerCase() === (voice ?? '').trim().toLowerCase())
}

/** Nome da voz com fallback defensível (config podre não derruba o TTS). */
export function resolveVoice(voice: string | null | undefined): string {
  const wanted = (voice ?? '').trim()
  const match = GEMINI_VOICES.find((entry) => entry.id.toLowerCase() === wanted.toLowerCase())
  return match?.id ?? DEFAULT_VOICE
}

/**
 * Instrução de síntese. O texto do aluno vai entre aspas tipográficas para o
 * modelo não confundir instrução com fala, e o ritmo é pedido em inglês — o
 * idioma-alvo da frase não é declarado: o modelo detecta pela própria escrita.
 */
export function ttsInstruction(input: { text: string; rate: SpeechRate }): string {
  const rate =
    input.rate === 'slow'
      ? 'Speak slowly and very clearly, pausing between phrases.'
      : input.rate === 'fast'
        ? 'Speak at a natural, slightly quick conversational pace.'
        : 'Speak at a natural conversational pace, clearly.'

  const safe = input.text.replace(/[“”]/g, '"').trim()
  return [
    'Read the following sentence aloud, exactly as written, in its own language.',
    'Do not translate, do not add words, do not narrate.',
    rate,
    `Sentence: “${safe}”`
  ].join(' ')
}

/**
 * Instrução de transcrição. A frase esperada entra como *hint* (contexto), nunca
 * como ordem de repetição — senão o modelo "ouve" o que quer o prompt e o score
 * de pronúncia vira ficção. O app mostra a transcrição crua para o aluno poder
 * discordar.
 */
export function asrInstruction(input: { langName: string; hint?: string | null }): string {
  const hint = input.hint?.trim()
  return [
    `Transcribe ONLY what the speaker says, in ${input.langName}.`,
    'Return the plain text and nothing else: no labels, no translation, no commentary, no punctuation you did not hear.',
    'If the speech is unclear, transcribe the part you could hear.',
    hint
      ? `Context (the learner was asked to say something like this — do NOT copy it blindly): ${JSON.stringify(hint)}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Mapeia mime de saída para "dá para tocar direto?". */
export function isPlayableMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false
  const lower = mimeType.toLowerCase()
  return lower.startsWith('audio/wav') || lower.startsWith('audio/mp3') || lower.startsWith('audio/mpeg') || lower.startsWith('audio/ogg')
}

// --- V3: conversa em tempo real ------------------------------------------------
//
// O motor ao vivo fala PCM cru, não contêiner: 16 kHz mono na entrada do micro,
// 24 kHz mono na saída do tutor (formatos do Gemini Live; o motor local do
// Lote 6 usa os mesmos números para a UI não conhecer diferença).

/** Entrada do microfone no motor ao vivo. */
export const LIVE_INPUT_MIME = 'audio/pcm;rate=16000'
export const LIVE_INPUT_SAMPLE_RATE = 16000
/** Saída padrão do tutor (o mime do chunk pode declarar outra; o UI usa `sampleRate`). */
export const LIVE_OUTPUT_SAMPLE_RATE = 24000

/** Frames de ~100 ms de PCM16 16 kHz: 3.2 KB crus, ~4.3 KB em base64. */
export const LIVE_FRAME_BYTES = LIVE_INPUT_SAMPLE_RATE * 2 * (100 / 1000)

/** Teto de um chunk de áudio no IPC (10 s — dez vezes um frame; margem honesta). */
export const LIVE_CHUNK_BASE64_MAX = Math.ceil(((LIVE_INPUT_SAMPLE_RATE * 2 * 10) / 3) * 4)
