import { Component } from 'react'
import type { ErrorInfo, JSX, ReactNode } from 'react'
import { t } from '../i18n'

interface Props {
  children: ReactNode
  /** Chamado quando o aluno escolhe voltar — normalmente reseta a navegação. */
  onReset: () => void
}

interface State {
  error: Error | null
}

/**
 * M6 (E1): a janela única do app não pode ficar branca. Uma tela que joga
 * (assertions não-nulas vivas, dados inesperados do cache) derruba só a área
 * de telas, com saída visível — e o erro vai para o console, que o log
 * rotativo do main (C10) captura quando o renderer o reproduz.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] ErrorBoundary:', error.message, info.componentStack)
  }

  render(): JSX.Element {
    if (this.state.error) {
      return (
        <div className="grid h-full place-items-center p-8">
          <div className="max-w-lg rounded-2xl border border-danger/40 bg-danger-soft p-6 text-center">
            <h2 className="text-sm font-semibold text-danger">{t.app.crashTitle}</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink">{t.app.crashBody}</p>
            <pre className="mt-3 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-panel-2 p-2 text-left text-[10px] text-muted">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null })
                this.props.onReset()
              }}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90"
            >
              {t.app.crashReload}
            </button>
          </div>
        </div>
      )
    }

    return <>{this.props.children}</>
  }
}
