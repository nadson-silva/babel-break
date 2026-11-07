import type { JSX } from 'react'
import type { ProviderStatus, SettingsPayload } from '../../../shared/types'
import { t } from '../i18n'
import { AiStatusChip } from './AiStatus'

export type View = 'home' | 'lessons' | 'tracks' | 'tutor' | 'review' | 'notebook' | 'progress' | 'settings'

interface SidebarProps {
  view: View
  onNavigate: (view: View) => void
  settings: SettingsPayload
  dueCount?: number
  /** M5: disponibilidade da IA (chip no rodapé) — null até a primeira sonda. */
  aiStatus?: ProviderStatus | null
}

function HomeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <path
        d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LessonsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <path
        d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14.5H6.5A1.5 1.5 0 0 0 5 20V5.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M5 17.5h14M9 8.5h6M9 11.8h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
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
  label,
  badge
}: {
  active: boolean
  onClick: () => void
  icon: JSX.Element
  label: string
  badge?: number
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
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

function NotebookIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <path
        d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 8.5h6M9 12h6M9 15.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function ReviewIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <path
        d="M20 11a8 8 0 1 1-3-6.2M20 4v4h-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8.2 6H14a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h5.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ProgressIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <path d="M4 19h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6.5 15.5v3M11 11v7.5M15.5 7.5V18M20 12.5V18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Sidebar({ view, onNavigate, settings, dueCount = 0, aiStatus = null }: SidebarProps): JSX.Element {
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
          active={view === 'home'}
          onClick={() => onNavigate('home')}
          icon={<HomeIcon />}
          label={t.nav.home}
        />
        <NavButton
          active={view === 'lessons'}
          onClick={() => onNavigate('lessons')}
          icon={<LessonsIcon />}
          label={t.nav.lessons}
        />
        <NavButton
          active={view === 'tracks'}
          onClick={() => onNavigate('tracks')}
          icon={<TrackIcon />}
          label={t.nav.tracks}
        />
        <NavButton
          active={view === 'tutor'}
          onClick={() => onNavigate('tutor')}
          icon={<ChatIcon />}
          label={t.nav.tutor}
        />
        <NavButton
          active={view === 'review'}
          onClick={() => onNavigate('review')}
          icon={<ReviewIcon />}
          label={t.nav.review}
          badge={dueCount}
        />
        <NavButton
          active={view === 'notebook'}
          onClick={() => onNavigate('notebook')}
          icon={<NotebookIcon />}
          label={t.nav.notebook}
        />
        <NavButton
          active={view === 'progress'}
          onClick={() => onNavigate('progress')}
          icon={<ProgressIcon />}
          label={t.nav.progress}
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
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-faint">{t.settings.providerTitle}</span>
            <AiStatusChip status={aiStatus} />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{providerLabel}</span>
            <span
              className={`size-2 rounded-full ${
                settings.provider === 'ollama' ? 'bg-accent' : 'bg-[#7aa2ff]'
              }`}
            />
          </div>
          <div className="mt-1 truncate text-xs text-muted" title={model}>
            {model || t.offline.chipNoModel}
          </div>
        </div>

        <div className="flex items-center gap-2 px-1 text-[11px] text-faint">
          <span className={`size-1.5 rounded-full ${secure ? 'bg-accent' : 'bg-warn'}`} />
          {secure ? t.settings.securityOk : settings.secureStorage.available ? t.settings.securityBasic : t.settings.securityUnavailable}
        </div>
      </div>
    </aside>
  )
}
