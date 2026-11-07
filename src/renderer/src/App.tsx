import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { GuidedSession, LanguageOption, ProfileState, ProviderStatus, SettingsPayload } from '../../shared/types'
import { Sidebar, type View } from './components/Sidebar'
import { t, setUiLanguage } from './i18n'
import { setLanguageOptions, setNativeLanguage, setTargetLanguage } from './lang'
import { GuidedScreen } from './screens/GuidedScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LessonScreen } from './screens/LessonScreen'
import { LessonsScreen } from './screens/LessonsScreen'
import { NotebookScreen } from './screens/NotebookScreen'
import { ProgressScreen } from './screens/ProgressScreen'
import { OnboardingScreen } from './screens/OnboardingScreen'
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

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('home')
  const [settings, setSettings] = useState<SettingsPayload | null>(null)
  const [profileState, setProfileState] = useState<ProfileState | null>(null)
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

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [nextSettings, nextProfile, review, languageList] = await Promise.all([
        window.api.settings.get(),
        window.api.learning.profile.get(),
        window.api.review.state(1),
        window.api.languages.list().catch(() => [] as LanguageOption[])
      ])
      setSettings(nextSettings)
      setProfileState(nextProfile)
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
      />
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
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
      </main>
    </div>
  )
}
