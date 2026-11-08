/**
 * M6 (D2 / critério de aceite nº 8): a fronteira IPC recusa payload inválido
 * **antes** de tocar no banco. Cobertura em duas pontas — todo canal do
 * contrato está registrado, e um invoke fora do contrato não persiste nada.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { ipcMain } from 'electron'
import { getDb, initDatabase, schema } from './db'
import { CONTRACTED_CHANNELS } from './ipc-contract'
import { registerIpcHandlers } from './ipc'

// Mesmo instrumento do `ipc.test.ts`: captura os listeners registrados pelo
// stub de electron sem importar o arquivo do stub (que o tsconfig.node não vê).
const registered = new Map<string, (...args: unknown[]) => unknown>()
const original = ipcMain.handle.bind(ipcMain)
ipcMain.handle = ((channel: string, listener: (...args: unknown[]) => unknown) => {
  registered.set(channel, listener)
  original(channel, listener)
}) as typeof ipcMain.handle

const fakeEvent = {}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = registered.get(channel)
  if (!handler) throw new Error(`canal não registrado: ${channel}`)
  // async: um throw síncrono do wrapper vira rejeição, como faz o ipcMain real.
  return handler(fakeEvent, ...args)
}

beforeAll(() => {
  initDatabase()
  registerIpcHandlers()
})

describe('contrato de entrada do IPC (M6/D2)', () => {
  it('todo canal do contrato está registrado no ipcMain', () => {
    expect(CONTRACTED_CHANNELS.length).toBeGreaterThanOrEqual(57)
    for (const channel of CONTRACTED_CHANNELS) {
      expect(registered.has(channel), channel).toBe(true)
    }
  })

  it('recusa payloads inválidos sem persistir nada', async () => {
    const reviewsBefore = getDb().select().from(schema.reviews).all().length
    const reportsBefore = getDb().select().from(schema.contentReports).all().length

    // Id não é número inteiro positivo.
    await expect(invoke('lesson:open', -3)).rejects.toThrow(/Payload inválido/)
    await expect(invoke('lesson:open', '7')).rejects.toThrow(/Payload inválido/)

    // Rating fora do enum.
    await expect(invoke('review:answer', { cardId: 1, rating: 'meh' })).rejects.toThrow(/Payload inválido/)

    // Report com motivo inexistente / kind inexistente.
    await expect(
      invoke('report:submit', { kind: 'exercise', targetId: 1, reason: 'i-did-not-like-it' })
    ).rejects.toThrow(/Payload inválido/)
    await expect(invoke('report:undo-target', 'not-a-kind', 1)).rejects.toThrow(/Payload inválido/)

    // onboarding sem nível.
    await expect(invoke('profile:onboard', { goal: 'x' })).rejects.toThrow(/Payload inválido/)

    // V2: canais de perfil também recusam payload fora do contrato.
    await expect(invoke('profile:switch', '2')).rejects.toThrow(/Payload inválido/)
    await expect(invoke('profile:switch', 0)).rejects.toThrow(/Payload inválido/)
    await expect(invoke('profile:create', { name: 'x'.repeat(200) })).rejects.toThrow(/Payload inválido/)
    await expect(invoke('profile:update', { profileId: 1, focusMix: 4 })).rejects.toThrow(/Payload inválido/)
    await expect(invoke('profile:delete', { profileId: 1, acknowledged: 'sim' })).rejects.toThrow(/Payload inválido/)

    // set-gemini-key sem string.
    await expect(invoke('settings:set-gemini-key', 42)).rejects.toThrow(/Payload inválido/)

    // Nada dos acima chegou ao banco.
    expect(getDb().select().from(schema.reviews).all().length).toBe(reviewsBefore)
    expect(getDb().select().from(schema.contentReports).all().length).toBe(reportsBefore)
  })

  it('continue aceitando o caminho feliz', async () => {
    const state = await invoke('review:state')
    expect(state).toMatchObject({ dueCount: expect.any(Number) })

    const info = await invoke('app:info')
    expect(info).toMatchObject({ name: 'language-teacher-test' })

    const log = await invoke('log:get-path')
    expect(log).toMatchObject({ path: expect.any(String) })
  })

  it('recusa args extras e shape errado em objetos (lesson:answer)', async () => {
    await expect(invoke('lesson:answer', { exerciseId: 1, response: 'x', latencyMs: -5 })).rejects.toThrow(/Payload inválido/)
    await expect(invoke('tutor:send', { requestId: '', conversationId: 1, text: 'oi' })).rejects.toThrow(/Payload inválido/)
  })
})
