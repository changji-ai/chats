import { app, BrowserWindow, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { registerHub } from './hub'
import { registerUpdater } from './updater'
import { PLATFORMS } from '../shared/platforms'
import { loadSettings } from './store'

app.setAppUserModelId('com.ultra.chathub')

let win: BrowserWindow | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
  void app.whenReady().then(main)
}

async function main(): Promise<void> {
  createWindow()
  registerHub(() => win)
  registerUpdater(() => win)
  buildMenu()
  ipcMain.handle('app:version', () => app.getVersion())
  const s = loadSettings()
  app.setLoginItemSettings({ openAtLogin: s.autoLaunch })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#101216',
    show: false,
    title: 'ChatHub · 聊天聚合',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  win.on('ready-to-show', () => win?.show())
  // 开发自检：把渲染层 console 与加载失败转发到 stdout，便于排查白屏/报错
  win.webContents.on('console-message', (e) => {
    console.log(`[renderer:${e.level}] ${e.message}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[renderer gone] ${details.reason}`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[did-fail-load] ${code} ${desc} ${url}`)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => {
    win = null
  })
}

function buildMenu(): void {
  const platformsMenu: MenuItemConstructorOptions[] = PLATFORMS.map((p, i) => ({
    label: `切换到 ${p.name}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => win?.webContents.send('ui:switch-platform', { index: i })
  }))
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu', label: '编辑' },
    { role: 'viewMenu', label: '视图' },
    { label: '平台', submenu: platformsMenu },
    {
      label: '设置',
      submenu: [
        {
          label: '打开设置',
          accelerator: 'CmdOrCtrl+Comma',
          click: () => win?.webContents.send('ui:open-settings', {})
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.on('window-all-closed', () => {
  app.quit()
})
