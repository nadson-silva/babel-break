import type { JSX } from 'react'
import type { Correction } from '../../../shared/types'
import { t } from '../i18n/pt-BR'

interface CorrectionListProps {
  corrections: Correction[]
  recast?: string
  /** 'inline' embaixo da mensagem do aluno; 'block' na recapitulação. */
  variant?: 'inline' | 'block'
}

function sourceLabel(correction: Correction): string | null {
  if (correction.source === 'bank') return 'PT-BR'
  if (correction.source === 'local') return 'local'
  return null
}

/** Correções inline: o aluno vê a troca exata, no ponto da frase. */
export function CorrectionList({ corrections, recast, variant = 'inline' }: CorrectionListProps): JSX.Element | null {
  if (corrections.length === 0) {
    if (variant === 'inline') return null
    return (
      <p className="text-xs text-muted">{t.tutor.noCorrections}</p>
    )
  }

  return (
    <div className={`space-y-1.5 ${variant === 'inline' ? 'border-t border-line-soft pt-2' : ''}`}>
      {corrections.map((correction, index) => (
        <div key={`${correction.original}-${index}`} className="text-xs leading-relaxed">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-danger/90 line-through decoration-danger/40">{correction.original}</span>
            <span className="text-faint">→</span>
            <span className="font-medium text-accent">{correction.corrected}</span>
            <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-faint">
              {correction.tag}
            </span>
            {sourceLabel(correction) && (
              <span className="text-[10px] uppercase tracking-wider text-faint">
                {sourceLabel(correction)}
              </span>
            )}
          </div>
          {correction.note && <div className="text-[11px] text-muted">{correction.note}</div>}
        </div>
      ))}

      {recast && recast.trim().length > 0 && (
        <div className="pt-1 text-xs text-muted">
          <span className="text-[10px] uppercase tracking-wider text-faint">{t.tutor.recast}: </span>
          <span className="italic text-ink/90">{recast}</span>
        </div>
      )}
    </div>
  )
}
