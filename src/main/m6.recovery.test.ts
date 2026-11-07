/**
 * M6 (C4 / critério nº 6): corromper o `.db` de propósito deve produzir
 * recuperação com backup — não um app que não abre. Aqui cobre a metade do
 * processo main (quarentena + banco novo + `db:status`); a tela de
 * recuperação no renderer lê exatamente esse estado.
 */
import { describe, expect, it } from 'vitest'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { closeDatabase, getDb, getDbStatus, initDatabase, schema } from './db'

describe('recuperação de banco corrompido (M6/C4)', () => {
  it('isola o arquivo danificado com backup e abre um banco funcional', () => {
    initDatabase()
    closeDatabase()

    const dir = app.getPath('userData')
    const file = path.join(dir, 'language-teacher.db')
    fs.writeFileSync(file, 'isso não é um arquivo SQLite válido', 'utf8')

    initDatabase()

    const status = getDbStatus()
    expect(status.ok).toBe(true)
    expect(status.recovered).toBe(true)
    expect(status.backupPath).toBeTruthy()
    expect(fs.existsSync(path.join(status.backupPath as string, 'language-teacher.db'))).toBe(true)
    expect(fs.existsSync(path.join(status.backupPath as string, 'recovery-reason.txt'))).toBe(true)

    // O banco novo sobrevive a escrita/leitura real.
    getDb()
      .insert(schema.profiles)
      .values({ targetLang: 'en', nativeLang: 'pt-BR', goal: null, cefr: null, focusMix: 0.3, prefs: null, createdAt: Date.now() })
      .run()
    expect(getDb().select().from(schema.profiles).all().length).toBe(1)
  })
})
