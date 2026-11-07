/**
 * Log rotativo do processo main (M6/C10).
 *
 * O app empacotado (AppImage) não tem console visível: os `console.warn` de
 * degradção graciosa iam para o nada. Isto tee `console.log/warn/error` para
 * `main.log` em userData, com rotação por tamanho (1 backup), e expõe o
 * caminho pelo canal `log:get-path` — bug report passa a ter o que investigar.
 */
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

const MAX_BYTES = 512 * 1024
const BACKUP_SUFFIX = '.1'

let logFile: string | null = null
let previous: Pick<typeof console, 'log' | 'warn' | 'error'> | null = null

export function logFilePath(): string | null {
  return logFile
}

function rotateIfNeeded(): void {
  if (!logFile) return
  try {
    const stat = fs.statSync(logFile)
    if (stat.size > MAX_BYTES) {
      fs.renameSync(logFile, `${logFile}${BACKUP_SUFFIX}`)
    }
  } catch {
    // arquivo ainda não existe — nada a rotacionar
  }
}

function stamp(): string {
  return new Date().toISOString()
}

function append(level: string, args: unknown[]): void {
  if (!logFile) return
  const line = `${stamp()} [${level}] ${util.format(...args)}\n`
  try {
    fs.appendFileSync(logFile, line, 'utf8')
  } catch {
    // log nunca derruba o app
  }
}

/**
 * Começa a escrever em `userData/main.log`. Idempotente. O console original
 * continua funcionando (dev vê no terminal; o arquivo fica para o bug report).
 */
export function initLogging(userDataDir: string): void {
  if (logFile) return
  fs.mkdirSync(userDataDir, { recursive: true })
  logFile = path.join(userDataDir, 'main.log')
  rotateIfNeeded()

  previous = { log: console.log, warn: console.warn, error: console.error }
  const tee =
    (level: string, original: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      original(...args)
      append(level, args)
    }
  console.log = tee('log', previous.log)
  console.warn = tee('warn', previous.warn)
  console.error = tee('error', previous.error)
}

/** Restaura o console — usado pelos testes para não vazar estado entre suítes. */
export function resetLoggingForTests(): void {
  if (previous) {
    console.log = previous.log
    console.warn = previous.warn
    console.error = previous.error
    previous = null
  }
  logFile = null
}
