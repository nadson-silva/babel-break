/**
 * V2 — as migrações 0007/0008 aplicadas num banco **com dados da v1**.
 *
 * O resto da suíte abre um banco vazio e deixa o migrator do Drizzle aplicar tudo
 * em sequência, o que não prova o que importa aqui: o *backfill* de
 * `lessons.profile_id` numa base que já tem lições de currículo (dono via
 * `units`) e de trilha (dono via `focus_tracks`), e uma lição realmente órfã
 * continuando sem dono (é isso que o export/import recusa, em vez de exportar
 * perfil corrompido).
 *
 * Reconstrói o estado da v1 aplicando os SQL de 0000–0006 na ordem do journal,
 * insere linhas como o app inseria, e aplica 0007 e 0008 **uma vez só**.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle')
const V1_NOW = 1_794_100_000_000

function applySqlFile(db: Database.Database, tag: string): void {
  const text = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8')
  for (const statement of text.split('--> statement-breakpoint')) {
    const clean = statement.trim()
    if (clean) db.exec(clean)
  }
}

function journalTags(): Array<{ idx: number; tag: string }> {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')
  ) as { entries: Array<{ idx: number; tag: string }> }
  return journal.entries
}

const state = { db: null as unknown as Database.Database, dir: '' }

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-migration-v2-'))
  const db = new Database(path.join(dir, 'v1.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Sobe o schema exatamente como a v1 deixou (0000…0006).
  for (const entry of journalTags()) {
    if (entry.idx <= 6) applySqlFile(db, entry.tag)
  }

  db.prepare(
    `insert into profiles (target_lang, native_lang, goal, cefr, focus_mix, created_at)
     values ('en', 'pt-BR', 'entrevista', 'A2', 0.3, ?)`
  ).run(V1_NOW)
  db.prepare(`insert into units (id, profile_id, title, level, position, created_at) values (1, 1, 'U1', 'A2', 0, ?)`).run(V1_NOW)
  db.prepare(
    `insert into focus_tracks (id, profile_id, title, status, source, created_at) values (7, 1, 'T1', 'active', 'user', ?)`
  ).run(V1_NOW)
  db.prepare(
    `insert into lessons (id, unit_id, track_id, title, level, position, created_at) values
      (11, 1,    null, 'L1 base',   'A2', 0, ?),
      (12, 1,    null, 'L2 base',   'A2', 1, ?),
      (13, null, 7,    'L1 trilha', 'A2', 0, ?),
      (14, null, null, 'órfã',      'A2', 9, ?)`
  ).run(V1_NOW, V1_NOW, V1_NOW, V1_NOW)
  db.prepare(`insert into track_lessons (track_id, lesson_id, position) values (7, 13, 0)`).run()
  db.prepare(
    `insert into exercises (id, lesson_id, type, payload, answer_key, position, created_at)
     values (21, 11, 'cloze', '{}', '{}', 0, ?)`
  ).run(V1_NOW)
  db.prepare(`insert into cards (id, profile_id, content, kind, source, due, reps, lapses, state, created_at)
              values (41, 1, '{}', 'vocab', 'lesson', 0, 0, 0, 'new', ?)`).run(V1_NOW)
  db.prepare(`insert into reviews (card_id, rating, reviewed_at) values (41, 3, ?)`).run(V1_NOW)
  db.prepare(`insert into study_sessions (id, profile_id, kind, started_at) values (31, 1, 'lesson', ?)`).run(V1_NOW)

  // As duas migrações da v2, uma vez só — como o migrator faria no boot.
  applySqlFile(db, '0007_stiff_doctor_strange')
  applySqlFile(db, '0008_overrated_black_crow')

  state.db = db
  state.dir = dir
})

afterAll(() => {
  state.db?.close()
  try {
    fs.rmSync(state.dir, { recursive: true, force: true })
  } catch {
    // nada vivo depende do diretório temporário
  }
})

function columns(table: string): string[] {
  return (state.db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map((entry) => entry.name)
}

function ownerOf(id: number): number | null {
  const row = state.db.prepare('select profile_id as owner from lessons where id = ?').get(id) as
    | { owner: number | null }
    | undefined
  return row?.owner ?? null
}

describe('banco v1 sobrevive às migrações da v2', () => {
  it('as colunas novas chegaram sem apagar nada', () => {
    expect(columns('profiles')).toEqual(expect.arrayContaining(['name', 'color', 'last_used_at']))
    expect(columns('lessons')).toContain('profile_id')
    expect((state.db.prepare('select count(*) as n from lessons').get() as { n: number }).n).toBe(4)
    expect((state.db.prepare('select count(*) as n from exercises').get() as { n: number }).n).toBe(1)
    expect((state.db.prepare('select count(*) as n from reviews').get() as { n: number }).n).toBe(1)
  })

  it('backfill: lição de unidade herda da unidade, de trilha herda da trilha', () => {
    expect(ownerOf(11)).toBe(1)
    expect(ownerOf(12)).toBe(1)
    expect(ownerOf(13)).toBe(1)
  })

  it('lição realmente órfã continua sem dono (o import é que a recusa)', () => {
    expect(ownerOf(14)).toBeNull()
  })

  it('perfil antigo ganha last_used_at = created_at, então o seletor ordena', () => {
    const row = state.db.prepare('select last_used_at as t from profiles where id = 1').get() as { t: number | null }
    expect(row.t).toBe(V1_NOW)
    expect(columns('profiles')).toContain('name')
    // Nome continua null: o rótulo é derivado do idioma na UI, não gravado em SQL.
    expect((state.db.prepare('select name as n from profiles where id = 1').get() as { n: string | null }).n).toBeNull()
  })

  it('índice no caminho quente de posse existe', () => {
    const indexes = (state.db.prepare('pragma index_list(lessons)').all() as Array<{ name: string }>).map(
      (entry) => entry.name
    )
    expect(indexes).toContain('lessons_profile_idx')
  })
})

describe('tabelas de voz da v2', () => {
  it('speech_runs e audio_cache entram, com FK cascade no perfil', () => {
    const tables = (state.db.prepare('select name from sqlite_master where type = ?').all('table') as Array<{
      name: string
    }>).map((entry) => entry.name)
    expect(tables).toEqual(expect.arrayContaining(['speech_runs', 'audio_cache']))

    const foreignKeys = state.db.prepare('pragma foreign_key_list(speech_runs)').all() as Array<{
      table: string
      on_delete: string
    }>
    expect(foreignKeys.some((entry) => entry.table === 'profiles' && entry.on_delete === 'CASCADE')).toBe(true)
  })

  it('fala nova entra e apagar o perfil a leva (memória morre com o aluno)', () => {
    state.db
      .prepare(
        `insert into speech_runs (profile_id, kind, target, skill, source, created_at)
         values (1, 'speak', 'I work on the backend', 'speaking', 'provider', ?)`
      )
      .run(Date.now())
    expect((state.db.prepare('select count(*) as n from speech_runs').get() as { n: number }).n).toBe(1)

    state.db.prepare('delete from profiles where id = 1').run()
    expect((state.db.prepare('select count(*) as n from speech_runs').get() as { n: number }).n).toBe(0)
    // O que não tem FK (sessões de estudo) continua dependente do app, não do SQL:
    // `main/profiles.ts::deleteProfile` cobre as tabelas sem cascade.
    expect((state.db.prepare('select count(*) as n from study_sessions').get() as { n: number }).n).toBe(1)
  })

  it('a base inteira passa em integrity_check depois de tudo', () => {
    expect(state.db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
