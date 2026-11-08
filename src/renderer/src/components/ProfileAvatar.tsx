import type { JSX } from 'react'
import { profileColor, profileInitials } from '../lib/palette'

interface ProfileAvatarProps {
  name: string | null | undefined
  color: string | null | undefined
  targetLang: string
  size?: 'sm' | 'md'
  /** Anel de destaque para o perfil ativo. */
  active?: boolean
}

/**
 * V2: avatar de perfil. Cor vem do banco como chave (`profiles.color`), o hex
 * mora em `lib/palette.ts` — nada de classe dinâmica do Tailwind, que o build
 * não enxerga.
 */
export function ProfileAvatar({
  name,
  color,
  targetLang,
  size = 'md',
  active = false
}: ProfileAvatarProps): JSX.Element {
  const box = size === 'sm' ? 'size-7 text-[10px]' : 'size-10 text-xs'

  return (
    <span
      className={`grid ${box} shrink-0 place-items-center rounded-xl font-bold text-surface ${
        active ? 'ring-2 ring-accent/70 ring-offset-2 ring-offset-panel' : ''
      }`}
      style={{ backgroundColor: profileColor(color) }}
      aria-hidden="true"
    >
      {profileInitials(name, targetLang)}
    </span>
  )
}
