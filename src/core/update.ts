/**
 * V2 — verificação de versão (auto-update honesto, sem dependência nova).
 *
 * O plano pedia "auto-update com o repositório correto" (F5). Empacotar um
 * instalador silencioso é outra decisão: este app é distribuído como AppImage/.deb
 * e o updater do electron-builder ainda não foi validado em Windows/macOS. O que dá
 * para fazer bem feito hoje é **dizer ao aluno que existe versão nova**, com o link
 * da release — sem instalar nada pelas costas dele.
 *
 * A comparação de versão mora aqui (pura): o resto lê o GitHub API.
 */

export interface Semver {
  major: number
  minor: number
  patch: number
  /** Rótulo de prerelease ('rc.1'); vazio = estável. */
  pre: string
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export function parseSemver(value: string | null | undefined): Semver | null {
  const match = SEMVER_RE.exec((value ?? '').trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? ''
  }
}

/** -1 | 0 | 1. Prerelease é *anterior* ao lançamento estável do mesmo número. */
export function compareSemver(a: Semver, b: Semver): -1 | 0 | 1 {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.pre === b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  return a.pre < b.pre ? -1 : 1
}

/** `latest` é versão nova em relação a `current`? (string podre = não sabe, não assume) */
export function isNewer(latest: string | null | undefined, current: string | null | undefined): boolean {
  const next = parseSemver(latest)
  const now = parseSemver(current)
  if (!next || !now) return false
  return compareSemver(next, now) > 0
}

export interface ReleaseInfo {
  tag: string
  version: string
  url: string
  notes: string
  publishedAt: string | null
}

/**
 * Reduz a resposta do GitHub Releases ao que a UI usa. Defensivo de propósito:
 * qualquer campo ausente derruba a interpretação, e o chamador mostra
 * "não foi possível verificar" em vez de inventar versão.
 */
export function readRelease(payload: unknown): ReleaseInfo | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const tag = typeof record.tag_name === 'string' ? record.tag_name.trim() : ''
  const url = typeof record.html_url === 'string' ? record.html_url.trim() : ''
  if (!tag || !url) return null

  return {
    tag,
    version: tag.replace(/^v/, ''),
    url,
    notes: typeof record.body === 'string' ? record.body.slice(0, 4_000) : '',
    publishedAt: typeof record.published_at === 'string' ? record.published_at : null
  }
}
