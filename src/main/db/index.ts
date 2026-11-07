import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { DbStatusView } from '../../shared/types'
import { languageSeedRows } from '../../core/languages'
import * as schema from './schema'

let sqlite: Database.Database | null = null
let db: BetterSQLite3Database<typeof schema> | null = null

/**
 * M6 (C4): estado do último boot para a UI. `recovered` = o banco anterior
 * estava corrompido (ou a migração falhou) e foi posto de lado com backup;
 * o app abriu um banco novo em vez de ficar sem janela.
 */
let lastStatus: DbStatusView = { ok: true, recovered: false, backupPath: null, error: null }

export function getDbStatus(): DbStatusView {
  return lastStatus
}

function migrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.join(app.getAppPath(), 'drizzle')
}

const DB_FILE = 'language-teacher.db'

function dbFiles(dir: string): string[] {
  return [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]
    .map((name) => path.join(dir, name))
    .filter((file) => fs.existsSync(file))
}

function stampForNow(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Snapshot `.db`+WAL antes de qualquer migração — migração falha não come o banco. */
function backupDatabase(dir: string): void {
  const target = path.join(dir, 'backups', stampForNow())
  fs.mkdirSync(target, { recursive: true })
  for (const file of dbFiles(dir)) {
    fs.copyFileSync(file, path.join(target, path.basename(file)))
  }
  // Guarda os 5 snapshots mais recentes.
  const backupsRoot = path.join(dir, 'backups')
  const entries = fs.readdirSync(backupsRoot).sort()
  for (const stale of entries.slice(0, Math.max(0, entries.length - 5))) {
    fs.rmSync(path.join(backupsRoot, stale), { recursive: true, force: true })
  }
}

/**
 * Recuperação: move os arquivos `.db*` para `recovery/<ts>/` e devolve o
 * caminho — o chamador reabre um banco vazio. Corrupção deixa de significar
 * "app sem janela".
 */
function quarantineDatabase(dir: string, reason: Error | null): string {
  const target = path.join(dir, 'recovery', stampForNow())
  fs.mkdirSync(target, { recursive: true })
  for (const file of dbFiles(dir)) {
    fs.renameSync(file, path.join(target, path.basename(file)))
  }
  fs.writeFileSync(path.join(target, 'recovery-reason.txt'), reason ? `${reason.message}\n${reason.stack ?? ''}` : 'unknown', 'utf8')
  return target
}

function openAndMigrate(dir: string): BetterSQLite3Database<typeof schema> {
  const handle = new Database(path.join(dir, DB_FILE))
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')

  // M6 (C4): integridade antes de migrar — SQLite corrompido não deve nem
  // chegar ao migrator.
  const integrity = handle.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') {
    handle.close()
    throw new Error(`integrity_check: ${String(integrity)}`)
  }

  const database = drizzle(handle, { schema })

  try {
    backupDatabase(dir)
    migrate(database, { migrationsFolder: migrationsFolder() })
  } catch (error) {
    handle.close()
    throw error instanceof Error ? error : new Error(String(error))
  }

  sqlite = handle
  db = database
  seedLanguages(database)
  return database
}

export function initDatabase(): BetterSQLite3Database<typeof schema> {
  if (db) return db

  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })

  try {
    return openAndMigrate(dir)
  } catch (firstError) {
    // Última linha de defesa: banco corrompido/migração quebrada → quarentena
    // com backup e boot limpo. A UI conta o que aconteceu via `db:status`.
    const error = firstError instanceof Error ? firstError : new Error(String(firstError))
    let backupPath: string | null
    try {
      backupPath = quarantineDatabase(dir, error)
    } catch (quarantineError) {
      console.error('[db] falha ao isolar banco corrompido:', quarantineError)
      lastStatus = { ok: false, recovered: false, backupPath: null, error: error.message }
      throw error
    }
    console.error('[db] banco recuperado de falha de inicialização:', error.message, '→', backupPath)
    try {
      const fresh = openAndMigrate(dir)
      lastStatus = { ok: true, recovered: true, backupPath, error: error.message }
      return fresh
    } catch (secondError) {
      const detail = secondError instanceof Error ? secondError.message : String(secondError)
      lastStatus = { ok: false, recovered: false, backupPath, error: `${error.message}; rebuild: ${detail}` }
      throw secondError
    }
  }
}

/**
 * M4: o registro de idiomas de `core/languages.ts` é a fonte da verdade; a
 * tabela `languages` é a projeção consultável no SQLite (direção de escrita,
 * tokenização, notas de prompt). Idempotente — roda em toda inicialização.
 */
function seedLanguages(database: BetterSQLite3Database<typeof schema>): void {
  for (const row of languageSeedRows()) {
    database
      .insert(schema.languages)
      .values(row)
      .onConflictDoUpdate({
        target: schema.languages.code,
        set: {
          name: row.name,
          scriptDirection: row.scriptDirection,
          tokenization: row.tokenization,
          promptNotes: row.promptNotes
        }
      })
      .run()
  }
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) throw new Error('Banco de dados não inicializado.')
  return db
}

export function closeDatabase(): void {
  sqlite?.close()
  sqlite = null
  db = null
}

export function getDefaultProfile(): schema.Profile {
  const database = getDb()
  const existing = database.select().from(schema.profiles).limit(1).get()
  if (existing) return existing

  const created = database
    .insert(schema.profiles)
    .values({
      targetLang: 'en',
      nativeLang: 'pt-BR',
      goal: null,
      cefr: null,
      focusMix: 0.3,
      prefs: null,
      createdAt: Date.now()
    })
    .returning()
    .get()

  return created
}

export { schema }
