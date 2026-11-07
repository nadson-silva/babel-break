import type { JSX } from 'react'
import type { ProviderStatus } from '../../../shared/types'
import { t } from '../i18n'

interface AiStatusBannerProps {
  status: ProviderStatus | null
  onOpenSettings: () => void
}

function chipLabel(status: ProviderStatus): { text: string; tone: string } {
  switch (status.state) {
    case 'ok':
      return { text: t.offline.chipOk, tone: 'text-accent' }
    case 'probing':
      return { text: t.offline.chipProbing, tone: 'text-muted' }
    case 'no-model':
      return { text: t.offline.chipNoModel, tone: 'text-warn' }
    case 'no-key':
      return { text: t.offline.chipNoKey, tone: 'text-warn' }
    default:
      return { text: t.offline.chipUnreachable, tone: 'text-warn' }
  }
}

function hintFor(status: ProviderStatus): string | null {
  if (status.state === 'no-key') return t.offline.noKeyBanner
  if (status.state === 'no-model') return t.offline.noModelBanner
  if (status.state === 'unreachable') return status.local ? t.offline.bannerOllama : t.offline.bannerGemini
  return null
}

/**
 * Chip de disponibilidade da IA (M5).
 *
 * "Offline" aqui é *IA inalcançável*, não "sem internet": com Ollama o app todo
 * funciona sem rede. O chip diz o estado e o banner diz o que ainda funciona —
 * cache, revisão e banco de correções — em vez de deixar o aluno no vácuo.
 */
export function AiStatusChip({ status }: { status: ProviderStatus | null }): JSX.Element | null {
  if (!status || status.state === 'ok') return null
  const chip = chipLabel(status)

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${chip.tone}`}>
      <span className={`size-1.5 rounded-full ${status.state === 'probing' ? 'bg-muted' : 'bg-warn'}`} />
      {chip.text}
    </span>
  )
}

export function AiStatusBanner({ status, onOpenSettings }: AiStatusBannerProps): JSX.Element | null {
  if (!status || status.state === 'ok' || status.state === 'probing') return null
  const hint = hintFor(status)

  return (
    <div className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-xs text-warn">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium">{chipLabel(status).text}</span>
        <div className="flex items-center gap-2">
          {status.local && <span className="text-[11px] text-muted">{t.offline.local}</span>}
          <button
            type="button"
            onClick={onOpenSettings}
            className="shrink-0 rounded-lg border border-warn/40 px-3 py-1.5 font-medium transition-colors hover:bg-warn/10"
          >
            {t.common.openSettings}
          </button>
        </div>
      </div>
      <p className="mt-2 leading-relaxed text-muted">{t.offline.banner}</p>
      {hint && <p className="mt-1 leading-relaxed text-muted">{hint}</p>}
      {status.detail && <p className="mt-1 text-[11px] leading-relaxed text-faint">{status.detail}</p>}
    </div>
  )
}
