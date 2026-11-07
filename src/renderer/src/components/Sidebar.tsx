import type { JSX } from 'react'
import type { SettingsPayload } from '../../../shared/types'
import { t } from '../i18n/pt-BR'

export type View = 'chat' | 'settings'

interface SidebarProps {
  view: View
  onNavigate: (view: View) => void
  settings: SettingsPayload
}

function ChatIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <path
        d="M4 5.5h16v10.2H9.1L4 19.3V5.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 9h8M8 12.3h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M19 12c0-.5.4-1 .9-1.1l.6-.1-.7-2.6-.6.2c-.5.2-1.1 0-1.4-.4l-.2-.4c-.2-.4-.2-1 .1-1.4l.4-.5-2-1.8-.4.5c-.3.4-.9.6-1.4.4l-.4-.2c-.5-.2-.8-.8-.7-1.3l.1-.6-2.6-.7-.1.6c-.1.5-.6.9-1.1.9h-.4c-.5 0-1-.4-1.1-.9l-.1-.6-2.6.7.1.6c.1.5-.2 1.1-.7 1.3l-.4.2c-.5.2-1.1 0-1.4-.4l-.4-.5-2 1.8.4.5c.3.4.3 1 .1 1.4l-.2.4c-.3.4-.9.6-1.4.4l-.6-.2-.7 2.6.6.1c.5.1.9.6.9 1.1v.4c0 .5-.4 1-.9 1.1l-.6.1.7 2.6.6-.2c.5-.2 1.1 0 1.4.4l.2.4c.2.4.2 1-.1 1.4l-.4.5 2 1.8.4-.5c.3-.4.9-.6 1.4-.4l.4.2c.5.2.8.8.7 1.3l-.1.6 2.6.7.1-.6c.1-.5.6-.9 1.1-.9h.4c.5 0 1 .4 1.1.9l.1.6 2.6-.7-.1-.6c-.1-.5.2-1.1.7-1.3l.4-.2c.5-.2 1.1 0 1.4.4l.4.5 2-1.8-.4-.5c-.3-.4-.3-1-.1-1.4l.2-.4c.3-.4.9-.6 1.4-.4l.6.2.7-2.6-.6-.1c-.5-.1-.9-.6-.9-1.1V12Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NavButton({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: JSX.Element
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active ? 'bg-panel-2 text-ink' : 'text-muted hover:bg-panel-2/60 hover:text-ink'
      }`}
    >
      <span className={active ? 'text-accent' : 'text-faint'}>{icon}</span>
      {label}
    </button>
  )
}

export function Sidebar({ view, onNavigate, settings }: SidebarProps): JSX.Element {
  const model = settings.provider === 'gemini' ? settings.geminiModel : settings.ollamaModel
  const providerLabel = settings.provider === 'gemini' ? t.provider.gemini : t.provider.ollama
  const secure =
    settings.secureStorage.available && settings.secureStorage.backend !== 'basic_text'

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-sm font-bold text-accent-ink">
            LT
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{t.app.name}</div>
            <div className="truncate text-[11px] leading-tight text-faint">{t.app.tagline}</div>
          </div>
        </div>
      </div>

      <nav className="space-y-1 px-3">
        <NavButton
          active={view === 'chat'}
          onClick={() => onNavigate('chat')}
          icon={<ChatIcon />}
          label={t.nav.chat}
        />
        <NavButton
          active={view === 'settings'}
          onClick={() => onNavigate('settings')}
          icon={<SettingsIcon />}
          label={t.nav.settings}
        />
      </nav>

      <div className="mt-auto space-y-3 border-t border-line-soft p-4">
        <div className="rounded-xl border border-line-soft bg-panel-2 p-3">
          <div className="text-[10px] uppercase tracking-wider text-faint">Provedor</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{providerLabel}</span>
            <span
              className={`size-2 rounded-full ${
                settings.provider === 'ollama' ? 'bg-accent' : 'bg-[#7aa2ff]'
              }`}
            />
          </div>
          <div className="mt-1 truncate text-xs text-muted" title={model}>
            {model || 'modelo não definido'}
          </div>
        </div>

        <div className="flex items-center gap-2 px-1 text-[11px] text-faint">
          <span className={`size-1.5 rounded-full ${secure ? 'bg-accent' : 'bg-warn'}`} />
          {secure
            ? 'Keyring ativo'
            : settings.secureStorage.available
              ? 'Keyring básico'
              : 'Sem keyring'}
        </div>
      </div>
    </aside>
  )
}
