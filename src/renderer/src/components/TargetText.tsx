import type { JSX, ReactNode } from 'react'
import { targetLanguage, targetOption } from '../lang'

interface TargetTextProps {
  children: ReactNode
  className?: string
  /** Bloco (div) em vez de inline (span) — para frases e respostas inteiras. */
  block?: boolean
  title?: string
}

/**
 * Texto no idioma ensinado. `dir="auto"` delega ao algoritmo bidi do navegador
 * a direção por parágrafo — árabe/hebraico alinham à direita dentro de uma UI
 * PT-BR/EN que continua LTR; `lang` escolhe a fonte certa para escrita CJK.
 */
export function TargetText({ children, className, block, title }: TargetTextProps): JSX.Element {
  const option = targetOption()
  const Tag = block ? 'div' : 'span'
  return (
    <Tag
      lang={targetLanguage()}
      dir="auto"
      title={title}
      className={className}
      style={option?.tokenization === 'cjk' ? { wordBreak: 'break-word' } : undefined}
    >
      {children}
    </Tag>
  )
}
