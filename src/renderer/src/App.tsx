import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type {
  DbStatusView,
  GuidedSession,
  LanguageOption,
  ProfileState,
  ProfilesView,
  ProviderStatus,
  SettingsPayload
} from '../../shared/types'
import { Sidebar, type View } from './components/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { t, setUiLanguage } from './i18n'
import { setLanguageOptions, setNativeLanguage, setTargetLanguage } from './lang'
import { GuidedScreen } from './screens/GuidedScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LessonScreen } from './screens/LessonScreen'
import { LessonsScreen } from './screens/LessonsScreen'
import { NotebookScreen } from './screens/NotebookScreen'
import { ProgressScreen } from './screens/ProgressScreen'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { DataScreen } from './screens/DataScreen'
import { ProfilesScreen } from './screens/ProfilesScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TracksScreen } from './screens/TracksScreen'
import { TutorScreen } from './screens/TutorScreen'

function Splash({ error }: { error: string | null }): JSX.Element {
  return (
    <div className="grid h-full place-items-center bg-surface">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-accent text-sm font-bold text-accent-ink">
          LT
        </div>
        <div>
          <div className="text-sm font-semibold">{t.app.name}</div>
          <div className="mt-1 text-xs text-faint">
            {error ? error : t.common.loading}
          </div>
        </div>
      </div>
    </div>
  )
}

/** M6 (C4): banco corrompido → tela de recuperação, não app sem janela. */
function RecoveryNotice({ status, onDismiss }: { status: DbStatusView; onDismiss: () => void }): JSX.Element {
  return (
    <div className="grid h-full place-items-center bg-surface p-8">
      <div className="max-w-lg rounded-2xl border border-warn/40 bg-warn-soft p-6 text-center">
        <h1 className="text-sm font-semibold text-warn">{t.app.recoveredTitle}</h1>
        <p className="mt-2 text-xs leading-relaxed text-ink">{t.app.recoveredBody}</p>
        {status.backupPath && (
          <p className="mt-3 break-all rounded-lg bg-panel-2 px-3 py-2 text-[10px] text-muted">
            {t.app.recoveredBackup.replace('{path}', status.backupPath)}
          </p>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/90"
        >
          {t.app.recoveredDismiss}
        </button>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('home')
  const [settings, setSettings] = useState<SettingsPayload | null>(null)
  const [profileState, setProfileState] = useState<ProfileState | null>(null)
  // V2: perfis do aparelho (seletor da sidebar + tela de perfis).
  const [profiles, setProfiles] = useState<ProfilesView | null>(null)
  const [languages, setLanguages] = useState<LanguageOption[]>([])
  const [activeLessonId, setActiveLessonId] = useState<number | null>(null)
  const [guided, setGuided] = useState<GuidedSession | null>(null)
  const [tutorConversation, setTutorConversation] = useState<number | null>(null)
  const [scenarioRequest, setScenarioRequest] = useState<{ lessonId?: number; topic?: string } | null>(null)
  const [dueCount, setDueCount] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // M5: disponibilidade da IA em runtime — o banner e o chip leem daqui, e o
  // main empurra quando o estado muda (nada de polling no renderer).
  const [aiStatus, setAiStatus] = useState<ProviderStatus | null>(null)
  // M6 (C4): banco recuperado no boot → a tela de recuperação aparece uma vez.
  const [dbStatus, setDbStatus] = useState<DbStatusView | null>(null)
  const [recoveryDismissed, setRecoveryDismissed] = useState(false)

  useEffect(() => {
    void window.api.app.dbStatus().then(setDbStatus).catch(() => undefined)
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [nextSettings, nextProfile, review, languageList, nextProfiles] = await Promise.all([
        window.api.settings.get(),
        window.api.learning.profile.get(),
        window.api.review.state(1),
        window.api.languages.list().catch(() => [] as LanguageOption[]),
        window.api.profiles.list().catch(() => null)
      ])
      setSettings(nextSettings)
      setProfileState(nextProfile)
      setProfiles(nextProfiles)
      setDueCount(review.dueCount)
      setLanguages(languageList)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let alive = true
    void window.api.provider
      .status()
      .then((status) => {
        if (alive) setAiStatus(status)
      })
      .catch(() => undefined)

    const unsubscribe = window.api.provider.onStatus((status) => {
      if (alive) setAiStatus(status)
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  // M4: idioma da interface e idioma ensinado viram estado de runtime antes de
  // qualquer tela renderizar — os textos (`t`) e o `<TargetText>` leem daqui.
  if (settings) setUiLanguage(settings.uiLang)
  if (profileState) {
    setTargetLanguage(profileState.profile.targetLang)
    setNativeLanguage(profileState.profile.nativeLang)
  }
  setLanguageOptions(languages)

  if (!settings || !profileState) {
    return <Splash error={error} />
  }

  if (dbStatus?.recovered && !recoveryDismissed) {
    return <RecoveryNotice status={dbStatus} onDismiss={() => setRecoveryDismissed(true)} />
  }

  if (!profileState.profile.onboardingComplete) {
    return (
      <OnboardingScreen
        settings={settings}
        languages={languages}
        onDone={(state) => {
          setProfileState(state)
          setView('home')
          setRefreshKey((value) => value + 1)
        }}
      />
    )
  }

  /**
   * V2: troca de perfil. Além de recarregar o estado, derruba o que estava
   * aberto — lição, sessão guiada e conversa pertencem ao perfil anterior.
   */
  function switchProfile(profileId: number): void {
    void (async () => {
      try {
        const nextProfiles = await window.api.profiles.switch(profileId)
        const nextProfile = await window.api.learning.profile.get()
        setProfiles(nextProfiles)
        setProfileState(nextProfile)
        setActiveLessonId(null)
        setGuided(null)
        setScenarioRequest(null)
        setTutorConversation(null)
        setView('home')
        setRefreshKey((value) => value + 1)
        await reload()
      } catch (switchError) {
        setError(switchError instanceof Error ? switchError.message : String(switchError))
      }
    })()
  }

  /** Perfil novo: nasce sem onboarding, e o gate abaixo já mostra o passo a passo. */
  function createProfile(): void {
    void (async () => {
      try {
        const state = await window.api.profiles.create({})
        setProfileState(state)
        setRefreshKey((value) => value + 1)
        await reload()
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : String(createError))
      }
    })()
  }

  function navigate(next: View): void {
    setActiveLessonId(null)
    setGuided(null)
    setScenarioRequest(null)
    setView(next)
  }

  function refreshBadges(): void {
    void window.api.review
      .state(1)
      .then((state) => setDueCount(state.dueCount))
      .catch(() => undefined)
  }

  function openLesson(lessonId: number): void {
    setActiveLessonId(lessonId)
  }

  function completeLesson(): void {
    setActiveLessonId(null)
    setView('home')
    setRefreshKey((value) => value + 1)
    void reload()
  }

  function openTutor(conversationId?: number): void {
    setActiveLessonId(null)
    setGuided(null)
    setScenarioRequest(null)
    setTutorConversation(conversationId ?? null)
    setView('tutor')
  }

  /** Abre a tela do tutor já em modo cenário (lição de foco ou tema avulso). */
  function openScenario(input: { lessonId?: number; topic?: string }): void {
    setActiveLessonId(null)
    setGuided(null)
    setTutorConversation(null)
    setScenarioRequest(input)
    setView('tutor')
  }

  function startGuided(session: GuidedSession): void {
    setActiveLessonId(null)
    setGuided(session)
  }

  function closeGuided(): void {
    setGuided(null)
    setView('home')
    setRefreshKey((value) => value + 1)
    void reload()
  }

  return (
    <div className="flex h-full">
      <Sidebar
        view={view}
        onNavigate={navigate}
        settings={settings}
        dueCount={guided || activeLessonId != null ? 0 : dueCount}
        aiStatus={aiStatus}
        profiles={profiles}
        onSwitchProfile={switchProfile}
      />
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        {/* M6 (E1): uma tela que joga derruba só a área de telas, nunca a janela. */}
        <ErrorBoundary
          onReset={() => {
            setActiveLessonId(null)
            setGuided(null)
            setScenarioRequest(null)
            setView('home')
            setRefreshKey((value) => value + 1)
          }}
        >
        {guided ? (
          <GuidedScreen settings={settings} session={guided} onExit={closeGuided} />
        ) : activeLessonId != null ? (
          <LessonScreen
            lessonId={activeLessonId}
            onBack={() => {
              setActiveLessonId(null)
              setRefreshKey((value) => value + 1)
              refreshBadges()
            }}
            onCompleted={completeLesson}
            onOpenScenario={(lessonId) => openScenario({ lessonId })}
          />
        ) : view === 'home' ? (
          <HomeScreen
            key={`home-${refreshKey}`}
            settings={settings}
            aiStatus={aiStatus}
            onOpenLesson={openLesson}
            onOpenCatalog={() => navigate('lessons')}
            onOpenTracks={() => navigate('tracks')}
            onOpenSettings={() => navigate('settings')}
            onOpenTutor={openTutor}
            onOpenScenario={openScenario}
            onOpenReview={() => navigate('review')}
            onOpenNotebook={() => navigate('notebook')}
            onOpenProgress={() => navigate('progress')}
            onStartGuided={startGuided}
            onResumeGuided={startGuided}
          />
        ) : view === 'lessons' ? (
          <LessonsScreen
            key={`lessons-${refreshKey}`}
            settings={settings}
            onOpenLesson={openLesson}
            onOpenSettings={() => navigate('settings')}
          />
        ) : view === 'tracks' ? (
          <TracksScreen
            key={`tracks-${refreshKey}`}
            settings={settings}
            initialObjective={profileState.profile.goal}
            onOpenLesson={openLesson}
            onOpenScenario={(lessonId) => openScenario({ lessonId })}
            onOpenSettings={() => navigate('settings')}
          />
        ) : view === 'tutor' ? (
          <TutorScreen
            key={`tutor-${refreshKey}-${tutorConversation ?? 'new'}-${scenarioRequest ? 'scenario' : ''}`}
            settings={settings}
            onOpenSettings={() => navigate('settings')}
            initialConversationId={tutorConversation}
            initialScenario={scenarioRequest}
          />
        ) : view === 'review' ? (
          <ReviewScreen key={`review-${refreshKey}`} onChanged={refreshBadges} />
        ) : view === 'notebook' ? (
          <NotebookScreen key={`notebook-${refreshKey}`} />
        ) : view === 'data' ? (
          <DataScreen
            key={`data-${refreshKey}`}
            profiles={profiles}
            onImported={() => {
              void reload()
              setRefreshKey((value) => value + 1)
            }}
            onOpenProfiles={() => navigate('profiles')}
          />
        ) : view === 'profiles' ? (
          <ProfilesScreen
            key={`profiles-${refreshKey}`}
            profiles={profiles}
            onChanged={() => {
              void reload()
              setRefreshKey((value) => value + 1)
            }}
            onCreate={createProfile}
            onOpenData={() => navigate('data')}
          />
        ) : view === 'progress' ? (
          <ProgressScreen key={`progress-${refreshKey}`} onOpenSettings={() => navigate('settings')} />
        ) : (
          <SettingsScreen
            settings={settings}
            languages={languages}
            profile={profileState.profile}
            onChanged={setSettings}
            onMemoryReset={(state) => {
              // Perfil novo, onboarding do zero: limpa o que estava em aberto.
              setProfileState(state)
              setActiveLessonId(null)
              setGuided(null)
              setTutorConversation(null)
              setScenarioRequest(null)
              setDueCount(0)
              setView('home')
              setRefreshKey((value) => value + 1)
            }}
          />
        )}
        </ErrorBoundary>
      </main>
    </div>
  )
}
