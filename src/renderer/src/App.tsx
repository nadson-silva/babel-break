import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { GuidedSession, ProfileState, SettingsPayload } from '../../shared/types'
import { Sidebar, type View } from './components/Sidebar'
import { t } from './i18n/pt-BR'
import { GuidedScreen } from './screens/GuidedScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LessonScreen } from './screens/LessonScreen'
import { LessonsScreen } from './screens/LessonsScreen'
import { NotebookScreen } from './screens/NotebookScreen'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
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
            {error ? error : 'Carregando banco local e configurações…'}
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
  const [activeLessonId, setActiveLessonId] = useState<number | null>(null)
  const [guided, setGuided] = useState<GuidedSession | null>(null)
  const [tutorConversation, setTutorConversation] = useState<number | null>(null)
  const [dueCount, setDueCount] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [nextSettings, nextProfile, review] = await Promise.all([
        window.api.settings.get(),
        window.api.learning.profile.get(),
        window.api.review.state(1)
      ])
      setSettings(nextSettings)
      setProfileState(nextProfile)
      setDueCount(review.dueCount)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!settings || !profileState) {
    return <Splash error={error} />
  }

  if (!profileState.profile.onboardingComplete) {
    return (
      <OnboardingScreen
        settings={settings}
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
    setTutorConversation(conversationId ?? null)
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
          />
        ) : view === 'home' ? (
          <HomeScreen
            key={`home-${refreshKey}`}
            settings={settings}
            onOpenLesson={openLesson}
            onOpenCatalog={() => navigate('lessons')}
            onOpenSettings={() => navigate('settings')}
            onOpenTutor={openTutor}
            onOpenReview={() => navigate('review')}
            onOpenNotebook={() => navigate('notebook')}
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
        ) : view === 'tutor' ? (
          <TutorScreen
            key={`tutor-${refreshKey}-${tutorConversation ?? 'new'}`}
            settings={settings}
            onOpenSettings={() => navigate('settings')}
            initialConversationId={tutorConversation}
          />
        ) : view === 'review' ? (
          <ReviewScreen key={`review-${refreshKey}`} onChanged={refreshBadges} />
        ) : view === 'notebook' ? (
          <NotebookScreen key={`notebook-${refreshKey}`} />
        ) : (
          <SettingsScreen settings={settings} onChanged={setSettings} />
        )}
      </main>
    </div>
  )
}
