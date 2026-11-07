import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { SettingsPayload } from '../../shared/types'
import { Sidebar, type View } from './components/Sidebar'
import { t } from './i18n/pt-BR'
import { ChatScreen } from './screens/ChatScreen'
import { SettingsScreen } from './screens/SettingsScreen'

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
  const [view, setView] = useState<View>('chat')
  const [settings, setSettings] = useState<SettingsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    try {
      setSettings(await window.api.settings.get())
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!settings) {
    return <Splash error={error} />
  }

  return (
    <div className="flex h-full">
      <Sidebar view={view} onNavigate={setView} settings={settings} />
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        {view === 'chat' ? (
          <ChatScreen settings={settings} onOpenSettings={() => setView('settings')} />
        ) : (
          <SettingsScreen settings={settings} onChanged={setSettings} />
        )}
      </main>
    </div>
  )
}
