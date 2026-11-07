import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { SecureStorageInfo } from '../shared/types'

interface SecretsFile {
  v: 1
  encrypted: boolean
  geminiApiKey?: string
}

function secretsPath(): string {
  return path.join(app.getPath('userData'), 'secrets.json')
}

function read(): SecretsFile {
  try {
    const raw = fs.readFileSync(secretsPath(), 'utf8')
    const parsed = JSON.parse(raw) as SecretsFile
    if (parsed && parsed.v === 1) return parsed
  } catch {
    // Arquivo ausente ou inválido: começa vazio.
  }
  return { v: 1, encrypted: false }
}

function write(data: SecretsFile): void {
  const file = secretsPath()
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // Alguns filesystems não suportam chmod; o arquivo continua local.
  }
}

export async function getSecureStorageInfo(): Promise<SecureStorageInfo> {
  let available: boolean
  try {
    available = await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    available = false
  }

  let backend: string | undefined
  if (process.platform === 'linux') {
    try {
      backend = String(safeStorage.getSelectedStorageBackend())
    } catch {
      backend = undefined
    }
  }

  return { available, backend }
}

export async function setGeminiApiKey(rawKey: string): Promise<void> {
  const key = rawKey.trim()
  if (!key) {
    clearGeminiApiKey()
    return
  }

  const current = read()
  let available: boolean
  try {
    available = await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    available = false
  }

  if (available) {
    const encrypted = await safeStorage.encryptStringAsync(key)
    write({
      ...current,
      encrypted: true,
      geminiApiKey: encrypted.toString('base64')
    })
    return
  }

  write({
    ...current,
    encrypted: false,
    geminiApiKey: Buffer.from(key, 'utf8').toString('base64')
  })
}

export async function getGeminiApiKey(): Promise<string | null> {
  const data = read()
  if (!data.geminiApiKey) return null

  const buffer = Buffer.from(data.geminiApiKey, 'base64')

  if (!data.encrypted) {
    return buffer.toString('utf8')
  }

  try {
    const available = await safeStorage.isAsyncEncryptionAvailable()
    if (!available) return null

    const result = await safeStorage.decryptStringAsync(buffer)
    if (!result.result) return null

    if (result.shouldReEncrypt) {
      const encrypted = await safeStorage.encryptStringAsync(result.result)
      write({ ...data, encrypted: true, geminiApiKey: encrypted.toString('base64') })
    }

    return result.result
  } catch {
    return null
  }
}

export async function hasGeminiApiKey(): Promise<boolean> {
  return Boolean(await getGeminiApiKey())
}

export function clearGeminiApiKey(): void {
  write({ v: 1, encrypted: false })
  try {
    fs.chmodSync(secretsPath(), 0o600)
  } catch {
    // best effort
  }
}
