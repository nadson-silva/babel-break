/**
 * Stub do `electron` para testes de integração do processo main.
 * Substitui o módulo via alias no vitest.config.mts — nada aqui roda no app.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'language-teacher-test-'))

export const app = {
  getPath(name: string): string {
    if (name === 'userData') return userData
    return userData
  },
  getName: (): string => 'language-teacher-test',
  getVersion: (): string => '0.0.0-test',
  getAppPath: (): string => process.cwd(),
  isPackaged: false,
  on: (): void => undefined,
  whenReady: (): Promise<void> => Promise.resolve()
}

type Handler = (...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

export const ipcMain = {
  handle(channel: string, handler: Handler): void {
    handlers.set(channel, handler)
  },
  removeHandler(channel: string): void {
    handlers.delete(channel)
  }
}

export function testHandler(channel: string): Handler | undefined {
  return handlers.get(channel)
}

export const BrowserWindow = class {}
export const shell = { openExternal: (): void => undefined }
export const safeStorage = { isEncryptionAvailable: (): boolean => false }

/**
 * V2: o lembrete usa Notification do desktop. Nos testes nada é mostrado — o
 * stub se comporta como um sistema sem notificação, que é o caminho que o
 * reminder tem que tolerar.
 */
export class Notification {
  static isSupported(): boolean {
    return false
  }

  on(): this {
    return this
  }

  show(): void {
    // nada
  }
}

/**
 * V2: o processo main usa os diálogos de salvar/abrir arquivo (export/import).
 * Nos testes nada abre janela — os caminhos são passados explicitamente, e o
 * stub só precisa existir para o import nomeado não quebrar.
 */
export const dialog = {
  showSaveDialog: (): Promise<{ canceled: boolean; filePath?: string }> =>
    Promise.resolve({ canceled: true, filePath: undefined }),
  showOpenDialog: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    Promise.resolve({ canceled: true, filePaths: [] })
}
