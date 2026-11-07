import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { closeDatabase, initDatabase } from './db'
import { emitStudentEvent } from './events'
import { registerIpcHandlers } from './ipc'
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

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    initDatabase()
    registerIpcHandlers()
    createWindow()

    // M5: monitor de disponibilidade da IA (banner offline) + fila ociosa de
    // pré-geração. Os dois são supérfluos se o app fechar — nada bloqueia o quit.
    startProviderWatch()
    startPrewarmWatch()
    emitStudentEvent('app-ready')

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    stopProviderWatch()
    stopPrewarmWatch()
    closeDatabase()
  })
}
