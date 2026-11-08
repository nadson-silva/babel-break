import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ProfileSummary, ProfilesView } from '../../../shared/types'
import { t } from '../i18n'
import { nativeLabel, targetLabel } from '../lang'
import { PALETTE_COLORS, profileColor } from '../lib/palette'
import { ProfileAvatar } from '../components/ProfileAvatar'

interface ProfilesScreenProps {
  profiles: ProfilesView | null
  onChanged: () => void
  /** Perfil novo entra pelo onboarding (gate do App), então devolve o estado. */
  onCreate: () => void
  /** V2 (exportação): omitido até a tela de Dados existir. */
  onOpenData?: () => void
}

/**
 * V2: a tela de perfis. Cada linha é um aluno com caderno, SRS, currículo e
 * conversas próprios — inclusive idiomas diferentes entre si.
 */
export function ProfilesScreen({
  profiles,
  onChanged,
  onCreate,
  onOpenData
}: ProfilesScreenProps): JSX.Element {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<ProfileSummary | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [colorDraft, setColorDraft] = useState('teal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const act = useCallback(
    async (run: () => Promise<unknown>, after?: () => void): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        await run()
        if (!alive.current) return
        onChanged()
        after?.()
      } catch (loadError) {
        if (alive.current) setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [onChanged]
  )

  function startEdit(profile: ProfileSummary): void {
    setEditingId(profile.id)
    setDeleting(null)
    setNameDraft(profile.name ?? '')
    setColorDraft(profile.color ?? 'teal')
  }

  const list = profiles?.profiles ?? []

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-4">
        <div>
          <h1 className="text-base font-semibold">{t.profiles.title}</h1>
          <p className="mt-0.5 text-xs text-muted">{t.profiles.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenData && (
            <button
              type="button"
              onClick={onOpenData}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
            >
              {t.data.title}
            </button>
          )}
          <button
            type="button"
            onClick={onCreate}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {t.profiles.newProfile}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-8 py-6">
        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger">
            {error}
          </p>
        )}

        {list.length === 0 && <p className="text-xs text-faint">{t.profiles.empty}</p>}

        {list.map((profile) => {
          const isEditing = editingId === profile.id
          const isDeleting = deleting?.id === profile.id

          return (
            <section
              key={profile.id}
              className={`rounded-2xl border p-5 transition-colors ${
                profile.active ? 'border-accent/50 bg-panel' : 'border-line bg-panel'
              }`}
            >
              <div className="flex items-start gap-4">
                <ProfileAvatar
                  name={profile.name}
                  color={profile.color}
                  targetLang={profile.targetLang}
                  active={profile.active}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">
                      {/* Sem nome, o rótulo é o idioma — "Inglês", não "Perfil 1". */}
                      {profile.name?.trim() || targetLabel(profile.targetLang)}
                    </h2>
                    {profile.active && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {t.profiles.active}
                      </span>
                    )}
                    {!profile.onboardingComplete && (
                      <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-faint">
                        {t.profiles.notOnboarded}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-muted">
                    {t.profiles.pair
                      .replace('{target}', targetLabel(profile.targetLang))
                      .replace('{native}', nativeLabel(profile.nativeLang))}
                    {profile.cefr ? ` · ${profile.cefr}` : ''}
                  </p>

                  {profile.goal && <p className="mt-1 line-clamp-2 text-xs text-faint">{profile.goal}</p>}

                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-faint">{t.profiles.lessons}</dt>
                      <dd className="font-semibold">{profile.completedLessons}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-faint">{t.profiles.dueCards}</dt>
                      <dd className="font-semibold">{profile.dueCards}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-faint">{t.profiles.openErrors}</dt>
                      <dd className="font-semibold">{profile.openErrors}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-faint">{t.profiles.tracks}</dt>
                      <dd className="font-semibold">{profile.activeTracks}</dd>
                    </div>
                  </dl>

                  {isEditing && (
                    <div className="mt-4 space-y-3 rounded-xl border border-line bg-panel-2 p-4">
                      <label className="block">
                        <span className="text-[10px] uppercase tracking-wider text-faint">{t.profiles.name}</span>
                        <input
                          value={nameDraft}
                          onChange={(event) => setNameDraft(event.target.value)}
                          maxLength={80}
                          placeholder={targetLabel(profile.targetLang)}
                          className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50"
                        />
                      </label>
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-faint">{t.profiles.color}</span>
                        <div className="mt-1 flex gap-2">
                          {PALETTE_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setColorDraft(color)}
                              aria-label={color}
                              aria-pressed={colorDraft === color}
                              className={`size-7 rounded-lg transition-transform hover:scale-105 ${
                                colorDraft === color ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel-2' : ''
                              }`}
                              style={{ backgroundColor: profileColor(color) }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () =>
                                window.api.profiles.update({
                                  profileId: profile.id,
                                  name: nameDraft.trim() || null,
                                  color: colorDraft
                                }),
                              () => setEditingId(null)
                            )
                          }
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
                        >
                          {busy ? t.common.saving : t.profiles.saveProfile}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
                        >
                          {t.common.cancel}
                        </button>
                      </div>
                    </div>
                  )}

                  {isDeleting && (
                    <div className="mt-4 space-y-3 rounded-xl border border-danger/40 bg-danger-soft p-4">
                      <p className="text-xs text-ink">{t.profiles.deleteWarning}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => window.api.profiles.remove({ profileId: profile.id, acknowledged: true }),
                              () => setDeleting(null)
                            )
                          }
                          className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-surface transition-colors hover:bg-danger/90 disabled:opacity-50"
                        >
                          {t.profiles.confirmDelete}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(null)}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
                        >
                          {t.common.cancel}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {!profile.active && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void act(() => window.api.profiles.switch(profile.id))}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-50"
                      >
                        {t.profiles.useProfile}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => (isEditing ? setEditingId(null) : startEdit(profile))}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-ink"
                    >
                      {isEditing ? t.common.cancel : t.profiles.rename}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null)
                        setDeleting(isDeleting ? null : profile)
                      }}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                    >
                      {t.profiles.delete}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )
        })}

        <p className="text-[11px] leading-relaxed text-faint">{t.profiles.help}</p>
      </div>
    </div>
  )
}
