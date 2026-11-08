/**
 * Contrato de voz em TS puro: catálogo de vozes e a diferença de prompt entre
 * os TTS legados (instrução no texto) e os 3.8 (transcrição literal + style).
 */
import { describe, expect, it } from 'vitest'
import type { SpeechRate } from '../shared/types'
import {
  DEFAULT_VOICE,
  GEMINI_VOICES,
  asrInstruction,
  isKnownVoice,
  isVerbatimTtsModel,
  resolveVoice,
  ttsInstruction,
  ttsStyle,
  ttsTranscript
} from './voice'

describe('vozes', () => {
  it('aceita o nome do catálogo ignorando maiúsculas e espaços', () => {
    expect(resolveVoice(' kore ')).toBe('Kore')
    expect(resolveVoice('SULAFAT')).toBe('Sulafat')
    expect(isKnownVoice('Puck')).toBe(true)
  })

  it('config podre cai na voz padrão em vez de derrubar o TTS', () => {
    expect(resolveVoice('voz-que-não-existe')).toBe(DEFAULT_VOICE)
    expect(resolveVoice(null)).toBe(DEFAULT_VOICE)
    expect(isKnownVoice(undefined)).toBe(false)
    expect(GEMINI_VOICES).toHaveLength(30)
  })
})

describe('isVerbatimTtsModel', () => {
  it('trata como literal tudo que não é preview', () => {
    expect(isVerbatimTtsModel('gemini-3.8-flash-tts')).toBe(true)
    expect(isVerbatimTtsModel('gemini-3.8-flash-lite-tts')).toBe(true)
  })

  it('mantém o prompt legado nos previews (2.5 e 3.1)', () => {
    expect(isVerbatimTtsModel('gemini-2.5-flash-preview-tts')).toBe(false)
    expect(isVerbatimTtsModel('gemini-2.5-pro-preview-tts')).toBe(false)
    expect(isVerbatimTtsModel('gemini-3.1-flash-tts-preview')).toBe(false)
  })

  it('modelo vazio não é literal (nem inventa contrato)', () => {
    expect(isVerbatimTtsModel('')).toBe(false)
    expect(isVerbatimTtsModel(null)).toBe(false)
  })
})

describe('ttsTranscript', () => {
  it('tira as aspas de enfeite e mantém a pontuação que é fala', () => {
    expect(ttsTranscript('  “I don’t know, okay?”  ')).toBe("I don’t know, okay?")
    expect(ttsTranscript('«¿Cómo estás?»')).toBe('¿Cómo estás?')
  })
})

describe('ttsStyle', () => {
  it('cada ritmo pede um estilo diferente', () => {
    expect(ttsStyle('slow')).toContain('slowly')
    expect(ttsStyle('fast')).toContain('quick')
    expect(ttsStyle('normal')).toContain('natural')
    const styles = (['slow', 'fast', 'normal'] as SpeechRate[]).map((rate) => ttsStyle(rate))
    expect(new Set(styles).size).toBe(3)
  })

  it('é frase de estilo, não frase a ser lida (sem ponto final)', () => {
    for (const rate of ['slow', 'fast', 'normal'] as const) {
      expect(ttsStyle(rate).endsWith('.')).toBe(false)
    }
  })
})

describe('ttsInstruction (legado)', () => {
  it('isola a frase do aluno entre aspas e declara o idioma como próprio', () => {
    const instruction = ttsInstruction({ text: 'Ich habe Hunger.', rate: 'slow' })
    expect(instruction).toContain('Sentence: “Ich habe Hunger.”')
    expect(instruction).toContain('Do not translate')
    expect(instruction).toContain('Speak slowly')
  })

  it('não deixa aspas tipográficas confundirem a fronteira da frase', () => {
    expect(ttsInstruction({ text: '“Hola”', rate: 'normal' })).toContain('Sentence: “"Hola"”')
  })
})

describe('asrInstruction', () => {
  it('usa a frase esperada como contexto, nunca como cópia', () => {
    const instruction = asrInstruction({ langName: 'español', hint: '¿Cómo estás?' })
    expect(instruction).toContain('in español')
    expect(instruction).toContain('do NOT copy it blindly')
  })

  it('sem hint não sobra linha vazia', () => {
    expect(asrInstruction({ langName: 'English' })).not.toContain('\n\n')
  })
})
