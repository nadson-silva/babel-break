/**
 * V2 — verificação de atualização no main.
 *
 * Lê a release mais recente do repositório e responde com honestidade:
 * "está atualizado", "existe a X.Y.Z" (com link) ou "não deu para verificar,
 * e aqui está o motivo". Não baixa nem instala nada: AppImage/.deb deste app
 * ainda não têm pipeline de assinatura/upgrade validado em três plataformas, e
 * updater silencioso seria promessa maior que o implementado.
 *
 * Rede no processo main (o renderer não tem `net`), com deadline — um request
 * pendurado não pode travar a tela de Configurações (M6/C3 vale também aqui).
 */
import { app, shell } from 'electron'
import { handle } from './ipc-contract'
import { isNewer, readRelease } from '../core/update'
import type { UpdateCheckView } from '../shared/types'

/** Onde o `package.json` aponta: `repository.url`. Manter um só lugar. */
const REPOSITORY = 'nadson-silva/babel-break'
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`

/** 6 h: abrir o app dez vezes ao dia não pode virar dez chamadas de rede. */
const TTL_MS = 6 * 60 * 60_000
const REQUEST_TIMEOUT_MS = 10_000

let cached: UpdateCheckView | null = null

function currentVersion(): string {
  return app.getVersion()
}

function unknown(): UpdateCheckView {
  return {
    state: 'unknown',
    current: currentVersion(),
    latest: null,
    url: null,
    notes: null,
    checkedAt: null,
    error: null,
    repository: REPOSITORY
  }
}

export function updateState(): UpdateCheckView {
  if (cached && Date.now() - (cached.checkedAt ?? 0) < TTL_MS) return cached
  return cached ?? unknown()
}

/** Consulta o GitHub. `force` ignora o cache (botão "verificar agora"). */
export async function checkForUpdates(options: { force?: boolean } = {}): Promise<UpdateCheckView> {
  if (!options.force && cached && Date.now() - (cached.checkedAt ?? 0) < TTL_MS) return cached

  const base = unknown()

  try {
    const response = await fetch(API_URL, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'language-teacher-desktop'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })

    if (!response.ok) {
      const view: UpdateCheckView = {
        ...base,
        state: 'error',
        error: `HTTP ${response.status}`,
        checkedAt: Date.now()
      }
      cached = view
      return view
    }

    const release = readRelease((await response.json()) as unknown)
    if (!release) {
      const view: UpdateCheckView = { ...base, state: 'error', error: 'release inválida', checkedAt: Date.now() }
      cached = view
      return view
    }

    const newer = isNewer(release.version, base.current)
    const view: UpdateCheckView = {
      ...base,
      state: newer ? 'available' : 'current',
      latest: release.version,
      // Sem versão nova, o link não serve para nada: a UI mostra só o que importa.
      url: newer ? release.url : RELEASES_URL,
      notes: newer ? release.notes || null : null,
      checkedAt: Date.now(),
      error: null
    }
    cached = view
    return view
  } catch (error) {
    const view: UpdateCheckView = {
      ...base,
      state: 'error',
      error: error instanceof Error ? error.message : String(error),
      checkedAt: Date.now()
    }
    cached = view
    return view
  }
}

/** Abre a página da release no navegador do usuário (nada de download silencioso). */
export async function openReleasePage(url?: string): Promise<boolean> {
  const target = url?.trim() || cached?.url || RELEASES_URL
  if (!/^https:\/\//.test(target)) return false
  await shell.openExternal(target)
  return true
}

export function registerUpdateIpc(): void {
  handle('update:state', () => updateState())
  handle('update:check', (_event, force?: boolean) => checkForUpdates({ force: force === true }))
  handle('update:open', (_event, url?: string) => openReleasePage(url))
}

/** Só para teste. */
export function resetUpdateCacheForTest(): void {
  cached = null
}
