/**
 * V2: paleta do avatar de perfil. A **chave** de cor mora no banco
 * (`profiles.color`), o valor hexadecimal mora aqui — assim trocar de perfil não
 * depende de string de interface nem de classe utilitária do Tailwind.
 */
export const PROFILE_PALETTE = {
  teal: '#4cc2a0',
  amber: '#e0a458',
  violet: '#a78bfa',
  rose: '#f2789f',
  sky: '#63b3ed',
  lime: '#a3d977'
} as const

export type PaletteColor = keyof typeof PROFILE_PALETTE

export const PALETTE_COLORS = Object.keys(PROFILE_PALETTE) as PaletteColor[]

export function profileColor(color: string | null | undefined): string {
  const key = (color ?? 'teal') as PaletteColor
  return PROFILE_PALETTE[key] ?? PROFILE_PALETTE.teal
}

/** Iniciais do avatar: nome escolhido, senão o idioma-alvo ('EN', 'JA'…). */
export function profileInitials(name: string | null | undefined, targetLang: string): string {
  const trimmed = (name ?? '').trim()
  if (trimmed) {
    const parts = trimmed.split(/\s+/)
    const first = parts[0]?.charAt(0) ?? ''
    const second = parts.length > 1 ? (parts[1]?.charAt(0) ?? '') : ''
    return (first + second).toUpperCase()
  }
  return targetLang.slice(0, 2).toUpperCase()
}
