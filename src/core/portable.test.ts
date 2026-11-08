/**
 * V2 — formato do backup portável (`core/portable.ts`).
 *
 * O que este arquivo garante é a porta de entrada: um dump só entra se tiver
 * carimbo de versão compatível **e** fechamento referencial dentro do próprio
 * arquivo. É o pré-requisito que o plano cobra de export/import (D1 + C5).
 */
import { describe, expect, it } from 'vitest'
import {
  EXPORT_FORMAT_VERSION,
  EXPORT_TABLES,
  findOrphanRows,
  inspectExport,
  summarizeCounts,
  type ExportEnvelope
} from './portable'
import { PROMPT_VERSION, SCHEMA_VERSION } from './schemas'

// Todo bloco vazio: o envelope exige todas as tabelas (o import olha chave a chave).
const EMPTY_TABLES = {
  ...Object.fromEntries(EXPORT_TABLES.map((name) => [name, []])),
  audio_cache: []
} as unknown as ExportEnvelope['tables']

function envelope(
  rows: Partial<Record<keyof ExportEnvelope['tables'], unknown[]>> = {},
  manifestOverrides: Record<string, unknown> = {}
): ExportEnvelope {
  return {
    app: 'language-teacher',
    manifest: {
      kind: 'profile',
      format: EXPORT_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
      dbVersion: 8,
      appVersion: '0.1.0',
      exportedAt: 1_700_000_000_000,
      includesAudio: false,
      audioRows: 0,
      profile: {
        name: 'Ana',
        color: 'teal',
        targetLang: 'en',
        nativeLang: 'pt-BR',
        goal: 'entrevista para dev',
        cefr: 'A2',
        focusMix: 0.3,
        placementScore: 0.4,
        onboardingCompletedAt: 1_699_000_000_000,
        prefs: null
      },
      counts: {},
      stale: { lessonContent: 0, exercises: 0 },
      ...manifestOverrides
    },
    tables: { ...EMPTY_TABLES, ...rows } as ExportEnvelope['tables']
  }
}

function text(value: unknown): string {
  return JSON.stringify(value)
}

describe('aceita um dump honesto', () => {
  it('perfil vazio passa com notas, não com erro', () => {
    const result = inspectExport(text(envelope()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.counts['lessons']).toBe(0)
    expect(result.notes).toContain('no-lessons')
    expect(result.warnings).toContain('no-audio')
  })

  it('preserva as contagens por bloco', () => {
    const result = inspectExport(
      text(
        envelope({
          units: [{ id: 1, profile_id: 7, title: 'U1', level: 'A2', position: 0, created_at: 1 }],
          lessons: [{ id: 10, unit_id: 1, profile_id: 7, title: 'L1', level: 'A2', position: 0, created_at: 1 }],
          exercises: [{ id: 20, lesson_id: 10, type: 'cloze', payload: '{}', answer_key: '{}', position: 0, created_at: 1 }],
          attempts: [{ id: 30, exercise_id: 20, response: 'x', correct: 1, created_at: 1 }]
        })
      )
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.counts['lessons']).toBe(1)
    expect(result.counts['attempts']).toBe(1)
    expect(summarizeCounts(result.counts)).toContain('1 lessons')
  })
})

describe('recusa antes de escrever qualquer coisa', () => {
  it('texto que não é JSON', () => {
    const result = inspectExport('olá')
    expect(result).toMatchObject({ ok: false, code: 'not-json' })
  })

  it('arquivo de outro programa', () => {
    const result = inspectExport(text({ hello: 'world' }))
    expect(result).toMatchObject({ ok: false, code: 'unknown-app' })
  })

  it('manifest incompleto (sem carimbo de versão)', () => {
    const dump = envelope() as unknown as { manifest: Record<string, unknown> }
    delete dump.manifest.schemaVersion
    const result = inspectExport(text(dump))
    expect(result).toMatchObject({ ok: false, code: 'shape' })
  })

  it('formato do arquivo desconhecido', () => {
    const result = inspectExport(text(envelope({}, { format: EXPORT_FORMAT_VERSION + 1 })))
    expect(result).toMatchObject({ ok: false, code: 'format-version' })
  })

  it('schema de conteúdo de outra versão (D1: nada de shim)', () => {
    const result = inspectExport(text(envelope({}, { schemaVersion: SCHEMA_VERSION + 5 })))
    expect(result).toMatchObject({ ok: false, code: 'schema-version' })
  })

  it('CEFR fora do enum é recusado no manifest', () => {
    const dump = envelope()
    // Do arquivo para cá, CEFR é enum: 'C9' (e o C2 que o app não tem) não entra.
    const profile = dump.manifest.profile as unknown as { cefr: string }
    profile.cefr = 'C9'
    expect(inspectExport(text(dump))).toMatchObject({ ok: false, code: 'shape' })
  })
})

describe('fechamento referencial dentro do arquivo (C5)', () => {
  it('exercício sem lição no dump é linha órfã', () => {
    const rows = {
      lessons: [],
      exercises: [{ id: 20, lesson_id: 10, type: 'cloze', payload: '{}', answer_key: '{}', position: 0, created_at: 1 }]
    }
    const found = findOrphanRows({ ...EMPTY_TABLES, ...rows } as ExportEnvelope['tables'])
    expect(found).toContain('exercises:20→lesson_id')
  })

  it('tentativa sem exercício, review sem card e mensagem sem conversa', () => {
    const found = findOrphanRows({
      ...EMPTY_TABLES,
      attempts: [{ id: 1, exercise_id: 99, response: 'x', correct: 1, created_at: 1 }],
      reviews: [{ id: 2, card_id: 88, rating: 3, reviewed_at: 1 }],
      messages: [{ id: 3, conversation_id: 77, role: 'user', content: 'oi', created_at: 1 }]
    } as ExportEnvelope['tables'])

    expect(found).toEqual(
      expect.arrayContaining(['attempts:1→exercise_id', 'reviews:2→card_id', 'messages:3→conversation_id'])
    )
  })

  it('track_lessons apontando para lição que não está no arquivo', () => {
    const found = findOrphanRows({
      ...EMPTY_TABLES,
      focus_tracks: [{ id: 40, profile_id: 7, title: 'T', status: 'active', source: 'user', created_at: 1 }],
      track_lessons: [{ track_id: 40, lesson_id: 11, position: 0 }]
    } as ExportEnvelope['tables'])
    expect(found).toContain('track_lessons:11→lesson_id')
  })

  it('lição de unidade de fora do dump', () => {
    const found = findOrphanRows({
      ...EMPTY_TABLES,
      lessons: [{ id: 10, unit_id: 5, title: 'L', level: 'A2', position: 0, created_at: 1 }]
    } as ExportEnvelope['tables'])
    expect(found).toContain('lessons:10→unit')
  })

  it('mistura dois perfis no mesmo arquivo', () => {
    const found = findOrphanRows({
      ...EMPTY_TABLES,
      cards: [
        { id: 1, profile_id: 7, content: '{}', kind: 'vocab', source: 'lesson', due: 1, reps: 0, lapses: 0, state: 'new', created_at: 1 },
        { id: 2, profile_id: 8, content: '{}', kind: 'vocab', source: 'lesson', due: 1, reps: 0, lapses: 0, state: 'new', created_at: 1 }
      ]
    } as ExportEnvelope['tables'])
    expect(found.some((entry) => entry.startsWith('profile_id:'))).toBe(true)
  })

  it('aceita lição de trilha e card da mesma unidade (cadeia fechada)', () => {
    const found = findOrphanRows({
      ...EMPTY_TABLES,
      focus_tracks: [{ id: 40, profile_id: 7, title: 'T', status: 'active', source: 'user', created_at: 1 }],
      lessons: [{ id: 10, track_id: 40, profile_id: 7, title: 'L', level: 'A2', position: 0, created_at: 1 }],
      track_lessons: [{ track_id: 40, lesson_id: 10, position: 0 }],
      cards: [{ id: 1, profile_id: 7, lesson_id: 10, content: '{}', kind: 'vocab', source: 'lesson', due: 1, reps: 0, lapses: 0, state: 'new', created_at: 1 }]
    } as ExportEnvelope['tables'])
    expect(found).toEqual([])
  })
})
