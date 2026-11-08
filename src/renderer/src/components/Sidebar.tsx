import type { JSX } from 'react'
import { useState } from 'react'
import type { ProfilesView, ProviderStatus, SettingsPayload } from '../../../shared/types'
import { t } from '../i18n'
import { targetLabel } from '../lang'
import { ProfileAvatar } from './ProfileAvatar'
import { AiStatusChip } from './AiStatus'

export type View =
  | 'home'
  | 'lessons'
  | 'tracks'
  | 'tutor'
  | 'review'
  | 'notebook'
  | 'progress'
  | 'voice'
  | 'profiles'
  | 'data'
  | 'settings'

interface SidebarProps {
  view: View
  onNavigate: (view: View) => void
  settings: SettingsPayload
  dueCount?: number
  /** M5: disponibilidade da IA (chip no rodapé) — null até a primeira sonda. */
  aiStatus?: ProviderStatus | null
  /** V2: perfis do aparelho + troca rápida pelo cabeçalho da sidebar. */
  profiles?: ProfilesView | null
  onSwitchProfile?: (profileId: number) => void
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

function VoiceIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <path d="M12 4.5a2.6 2.6 0 0 1 2.6 2.6v4a2.6 2.6 0 0 1-5.2 0v-4A2.6 2.6 0 0 1 12 4.5Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function ProfilesIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <circle cx="9" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5S13.9 16 14.5 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 6.2a2.6 2.6 0 0 1 0 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M17.6 14.9c2.1.4 3.3 1.9 3.7 4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * V2: cabeçalho de perfil. Um clique abre a lista; trocar derruba stream dos
 * outros perfis no main e recarrega as telas no renderer.
 */
function ProfileSwitcher({
  profiles,
  onSwitchProfile,
  onOpenProfiles
}: {
  profiles: ProfilesView | null
  onSwitchProfile: (profileId: number) => void
  onOpenProfiles: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const active = profiles?.profiles.find((entry) => entry.active) ?? null

  return (
    <div className="relative mt-4">
      <button
        type="button"
        data-profile-switcher
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-panel-2 px-2.5 py-2 text-left transition-colors hover:border-accent/40"
      >
        {active ? (
          <ProfileAvatar
            name={active.name}
            color={active.color}
            targetLang={active.targetLang}
            size="sm"
            active
          />
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-panel-2 text-[10px] font-bold text-faint">
            ?
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold leading-tight">
            {active?.name?.trim() || (active ? targetLabel(active.targetLang) : t.profiles.title)}
          </span>
          <span className="block truncate text-[10px] leading-tight text-faint">
            {active ? targetLabel(active.targetLang) : t.profiles.empty}
          </span>
        </span>
        <svg viewBox="0 0 24 24" fill="none" className="size-3.5 shrink-0 text-faint" aria-hidden="true">
          <path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-xl border border-line bg-panel shadow-xl"
        >
          <ul className="max-h-64 overflow-y-auto">
            {(profiles?.profiles ?? []).map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    if (!entry.active) onSwitchProfile(entry.id)
                  }}
                  aria-current={entry.active ? 'page' : undefined}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-panel-2 ${
                    entry.active ? 'bg-accent-soft' : ''
                  }`}
                >
                  <ProfileAvatar
                    name={entry.name}
                    color={entry.color}
                    targetLang={entry.targetLang}
                    size="sm"
                    active={entry.active}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {entry.name?.trim() || targetLabel(entry.targetLang)}
                    </span>
                    <span className="block truncate text-[10px] text-faint">
                      {targetLabel(entry.targetLang)} · {t.profiles.dueCards}: {entry.dueCards}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onOpenProfiles()
            }}
            className="w-full border-t border-line px-3 py-2 text-left text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {t.profiles.manage}
          </button>
        </div>
      )}
    </div>
  )
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  badge,
  target
}: {
  active: boolean
  onClick: () => void
  icon: JSX.Element
  label: string
  badge?: number
  /** Roteiro do botão — vira aria-current quando ativo (M6/E3). */
  target: View
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-view={target}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active ? 'bg-panel-2 text-ink' : 'text-muted hover:bg-panel-2/60 hover:text-ink'
      }`}
    >
      <span className={active ? 'text-accent' : 'text-faint'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span
          aria-live="polite"
          className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent"
        >
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

export function Sidebar({
  view,
  onNavigate,
  settings,
  dueCount = 0,
  aiStatus = null,
  profiles = null,
  onSwitchProfile = () => undefined
}: SidebarProps): JSX.Element {
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

      {/* V2: quem está estudando neste aparelho, com troca rápida. */}
      <div className="px-3">
        <ProfileSwitcher
          profiles={profiles}
          onSwitchProfile={onSwitchProfile}
          onOpenProfiles={() => onNavigate('profiles')}
        />
      </div>

      <nav className="mt-3 space-y-1 px-3">
        <NavButton
          active={view === 'home'}
          target="home"
          onClick={() => onNavigate('home')}
          icon={<HomeIcon />}
          label={t.nav.home}
        />
        <NavButton
          active={view === 'lessons'}
          target="lessons"
          onClick={() => onNavigate('lessons')}
          icon={<LessonsIcon />}
          label={t.nav.lessons}
        />
        <NavButton
          active={view === 'tracks'}
          target="tracks"
          onClick={() => onNavigate('tracks')}
          icon={<TrackIcon />}
          label={t.nav.tracks}
        />
        <NavButton
          active={view === 'tutor'}
          target="tutor"
          onClick={() => onNavigate('tutor')}
          icon={<ChatIcon />}
          label={t.nav.tutor}
        />
        <NavButton
          active={view === 'voice'}
          target="voice"
          onClick={() => onNavigate('voice')}
          icon={<VoiceIcon />}
          label={t.nav.voice}
        />
        <NavButton
          active={view === 'review'}
          target="review"
          onClick={() => onNavigate('review')}
          icon={<ReviewIcon />}
          label={t.nav.review}
          badge={dueCount}
        />
        <NavButton
          active={view === 'notebook'}
          target="notebook"
          onClick={() => onNavigate('notebook')}
          icon={<NotebookIcon />}
          label={t.nav.notebook}
        />
        <NavButton
          active={view === 'progress'}
          target="progress"
          onClick={() => onNavigate('progress')}
          icon={<ProgressIcon />}
          label={t.nav.progress}
        />
        <NavButton
          active={view === 'profiles'}
          target="profiles"
          onClick={() => onNavigate('profiles')}
          icon={<ProfilesIcon />}
          label={t.nav.profiles}
        />
        <NavButton
          active={view === 'settings'}
          target="settings"
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
