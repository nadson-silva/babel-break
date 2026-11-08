import { app, BrowserWindow, dialog, shell } from 'electron'
import path from 'node:path'
import { closeDatabase, initDatabase } from './db'
import { emitStudentEvent } from './events'
import { grantMediaPermissions } from './media-permissions'
import { registerIpcHandlers } from './ipc'
import { startReminderWatch, stopReminderWatch } from './reminders'
import { initLogging } from './log'
import { startPrewarmWatch, stopPrewarmWatch } from './prewarm'
import { startProviderWatch, stopProviderWatch } from './provider-status'

app.setName('language-teacher')

// Linux / Wayland (Garuda + Niri, GNOME, KDE, wlroots): deixa o Chromium escolher
// Ozone/Wayland automaticamente e habilita decoração de janela no lado do cliente.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0f14',
    title: 'Language Teacher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // V2: o microfone é a única permissão que o app pede, e só para a própria
  // janela. O handler mora em `media-permissions.ts` (com teste) porque o formato
  // do `details` muda entre versões do Electron, e negar em silêncio mata a
  // prática de voz sem nenhum diálogo do sistema.
  grantMediaPermissions(mainWindow.webContents.session)

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

/**
 * M6 (C4): um erro não capturado não derruba mais o processo em silêncio —
 * registra no `main.log` e mantém o app vivo (rejeições) ou encerra com
 * diálogo (falha de boot).
 */
function registerProcessErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    console.error('[process] unhandledRejection:', errorMessage(reason))
  })
  process.on('uncaughtException', (error) => {
    console.error('[process] uncaughtException:', errorMessage(error))
  })
}

function fatalStartup(error: unknown): void {
  console.error('[main] boot falhou:', errorMessage(error))
  dialog.showErrorBox('Language Teacher não iniciou', errorMessage(error))
  app.quit()
}

function bootstrap(): void {
  initLogging(app.getPath('userData'))
  registerProcessErrorHandlers()

  try {
    initDatabase()
  } catch (error) {
    // `initDatabase` já tenta a recuperação (quarentena + banco novo); se
    // mesmo assim falhou, o usuário precisa saber onde está o backup.
    fatalStartup(error)
    return
  }

  registerIpcHandlers()
  createWindow()

  // M5: monitor de disponibilidade da IA (banner offline) + fila ociosa de
  // pré-geração. Os dois são supérfluos se o app fechar — nada bloqueia o quit.
  startProviderWatch()
  startPrewarmWatch()
  // V2: lembrete opt-in (não dispara nada enquanto `reminderEnabled` for false).
  startReminderWatch()
  emitStudentEvent('app-ready')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // M6 (C4): nada de promessa pendurada — se o boot explodir, o usuário vê um
  // diálogo e um log em `main.log`, não um processo zombie sem janela.
  app.whenReady().then(bootstrap).catch(fatalStartup)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    stopProviderWatch()
    stopPrewarmWatch()
    stopReminderWatch()
    closeDatabase()
  })
}
