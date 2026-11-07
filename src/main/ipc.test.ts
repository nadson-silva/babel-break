/**
 * A bridge do preload e os handlers do main precisam bater canal por canal —
 * é o contrato entre as duas metades do app, e quebrar isso só aparece na UI.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ipcMain } from 'electron'
import { registerIpcHandlers } from './ipc'

type Handler = (channel: string, listener: (...args: unknown[]) => unknown) => void

const registered = new Map<string, (...args: unknown[]) => unknown>()

const handle = ipcMain.handle as unknown as Handler
ipcMain.handle = ((channel: string, listener: (...args: unknown[]) => unknown) => {
  registered.set(channel, listener)
  handle(channel, listener)
}) as typeof ipcMain.handle

/** Canais invocados pelo renderer (`ipcRenderer.invoke('…')` no preload). */
function invokedChannels(): string[] {
  const source = readFileSync(path.resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')
  return [...source.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1])
}

function exposedChannels(): string[] {
  const source = readFileSync(path.resolve(process.cwd(), 'src/preload/index.d.ts'), 'utf8')
  const channels = new Set(invokedChannels())
  if (source.includes('onEvent')) channels.add('chat:event')
  return [...channels]
}

beforeAll(() => {
  registerIpcHandlers()
})

describe('contrato IPC', () => {
  it('registra todo canal que o preload invoca', () => {
    const missing = invokedChannels().filter((channel) => !registered.has(channel))
    expect(missing).toEqual([])
  })

  it('expõe o loop do M2 completo', () => {
    for (const channel of [
      'tutor:list',
      'tutor:latest',
      'tutor:open',
      'tutor:new',
      'tutor:send',
      'tutor:cancel',
      'tutor:close',
      'notebook:get',
      'notebook:resolve',
      'review:state',
      'review:answer',
      'review:from-errors',
      'guided:active',
      'guided:start',
      'guided:step',
      'guided:review-count',
      'guided:practice',
      'guided:tutor',
      'guided:finish',
      'guided:abandon',
      'home:get'
    ]) {
      expect(registered.has(channel), channel).toBe(true)
    }
  })

  it('não deixou canal órfão sem chamada no preload', () => {
    const invoked = new Set(invokedChannels())
    const orphans = [...registered.keys()].filter(
      (channel) => !invoked.has(channel) && !channel.startsWith('app:')
    )
    expect(orphans).toEqual([])
  })

  it('mantém o nome do canal de eventos do tutor', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/main/loop.ts'), 'utf8')
    expect(source).toContain("send('chat:event'")
    expect(exposedChannels()).toContain('chat:event')
  })
})
