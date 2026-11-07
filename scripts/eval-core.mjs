/**
 * Núcleo real do eval (M6/F1): em vez de uma cópia à mão dos prompts/schemas,
 * o harness compila `src/core/` em memória e usa O MESMO contrato que o app
 * envia ao provedor. Se o schema mudar e o eval não souber, o eval quebra —
 * que é exatamente o objetivo de um gate.
 *
 * `esbuild` vem do toolchain do próprio projeto (dependência do vite); `zod`
 * fica external e é resolvido do node_modules.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let cached = null

export async function loadEvalCore() {
  if (cached) return cached

  const esbuild = require_('esbuild')
  const entry = `
import * as schemas from './src/core/schemas'
import * as interference from './src/core/interference'
import * as correction from './src/core/correction'
import * as prompts from './src/core/prompts'
import { z } from 'zod'
module.exports = { schemas, interference, correction, prompts, z }
`

  const result = esbuild.buildSync({
    stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['zod'],
    write: false
  })

  const code = result.outputFiles[0].text
  const module = { exports: {} }
  // O bundle CJS roda no processo do harness — nada de eval() de string viva.
  new Function('module', 'exports', 'require', code)(module, module.exports, require_)

  cached = module.exports
  return cached
}

/**
 * Goldens derivados do banco de interferência real: cada regra vira
 *  • um caso de erro (texto errado → tag + forma correta), e
 *  • um caso LIMPO (a forma correta do banco, que deve voltar SEM correção).
 * É o que impede o harness de premiar alucinação (M6/F2).
 */
export function goldensFromBank(core, bank, limit = 6) {
  const rules = bank.slice(0, limit)
  const dirty = rules.map((rule) => ({
    text: rule.wrong,
    tag: rule.tag,
    expect: rule.right
  }))
  const clean = rules.slice(0, Math.max(2, Math.floor(limit / 3))).map((rule) => ({
    text: rule.right,
    tag: 'correct',
    expect: ''
  }))
  return [...dirty, ...clean]
}
