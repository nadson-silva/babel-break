/**
 * Contrato renderer ↔ preload (M5).
 *
 * O contrato IPC (`ipc.test.ts`) garante que todo canal do main é invocado pela
 * bridge. Esta ponta fecha o outro lado: cada `window.api.<grupo>.<método>`
 * chamado por uma tela precisa existir na bridge — typo de método, que só
 * apareceria ao clicar, aparece no `npm test`.
 *
 * Mora em `src/main/` porque lê arquivos com Node (o projeto `web` do tsc não vê
 * `node:fs`); a outra metade do par é o renderer, lido de fora.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const RENDERER_DIR = path.resolve(process.cwd(), 'src/renderer/src')
const PRELOAD = readFileSync(path.resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx') ? [full] : []
  })
}

/** Chamadas `window.api.grupo.metodo(` encontradas no renderer. */
function bridgeCalls(): string[] {
  const calls = new Set<string>()
  for (const file of sourceFiles(RENDERER_DIR)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/window\.api\.([a-zA-Z]+(?:\.[a-zA-Z]+)+)/g)) {
      calls.add(match[1])
    }
  }
  return [...calls]
}

/** Corpo do objeto de um grupo (`  tutor: { … }`), com as chaves do mesmo nível. */
function groupBody(group: string): string | null {
  const pattern = new RegExp(`^  ${group}: \\{`, 'm')
  const match = pattern.exec(PRELOAD)
  if (!match) return null

  let depth = 0
  for (let index = PRELOAD.indexOf('{', match.index); index < PRELOAD.length; index += 1) {
    if (PRELOAD[index] === '{') depth += 1
    if (PRELOAD[index] === '}') {
      depth -= 1
      if (depth === 0) return PRELOAD.slice(match.index, index + 1)
    }
  }
  return null
}

function exposedInPreload(call: string): boolean {
  const [group, method] = call.split('.')
  const body = groupBody(group)
  if (!body) return false
  return new RegExp(`(^|[\\s,{])${method}\\s*[:,]`, 'm').test(body)
}

describe('bridge do preload', () => {
  it('o renderer só chama métodos que a bridge expõe', () => {
    const calls = bridgeCalls()
    // Sanidade: a suíte está lendo as telas de verdade.
    expect(calls.length).toBeGreaterThan(20)

    const missing = calls.filter((call) => !exposedInPreload(call))
    expect(missing, `ausentes na bridge: ${missing.join(', ')}`).toEqual([])
  })

  it('expõe a superfície do M5 (dashboard, reports, cache, status da IA)', () => {
    expect(groupBody('dashboard')).toContain('get:')
    const report = groupBody('report')
    for (const method of ['submit', 'undo', 'undoTarget', 'list']) {
      expect(report, method).toContain(`${method}:`)
    }
    const cache = groupBody('cache')
    for (const method of ['state', 'warm', 'stats']) {
      expect(cache, method).toContain(`${method}:`)
    }
    const provider = groupBody('provider')
    for (const method of ['test', 'status', 'probe', 'onStatus']) {
      expect(provider, method).toContain(`${method}:`)
    }
  })

  it('o evento provider:event tem listener do lado do renderer', () => {
    expect(PRELOAD).toContain("ipcRenderer.on('provider:event'")
    const screens = sourceFiles(RENDERER_DIR).map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(screens).toContain('provider.onStatus')
  })
})
