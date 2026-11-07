import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { languageSeedRows } from '../../core/languages'
import * as schema from './schema'

let sqlite: Database.Database | null = null
let db: BetterSQLite3Database<typeof schema> | null = null

function migrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.join(app.getAppPath(), 'drizzle')
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

export function initDatabase(): BetterSQLite3Database<typeof schema> {
  if (db) return db

  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })

  const file = path.join(dir, 'language-teacher.db')
  sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })
  seedLanguages(db)

  return db
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
