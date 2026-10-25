import { app, ipcMain, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * 自动更新：启动后检查新版本 → 自动下载（带进度）→ 就绪后一键「重启并更新」
 * （NSIS 静默安装 / macOS zip 替换 / Linux AppImage 替换），退出时也会自动安装。
 */
export function registerUpdater(getWin: () => BrowserWindow | null): void {
  const send = (st: { status: string; version?: string; percent?: number; note?: string }): void => {
    getWin()?.webContents.send('update:status', st)
  }

  autoUpdater.logger = null
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch((e: unknown) => {
      send({ status: 'error', note: (e as Error)?.message ?? String(e) })
    })
  }

  autoUpdater.on('checking-for-update', () => send({ status: 'checking' }))
  autoUpdater.on('update-available', (i) => send({ status: 'available', version: i.version }))
  autoUpdater.on('update-not-available', (i) => send({ status: 'uptodate', version: i.version }))
  autoUpdater.on('download-progress', (p) => send({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => send({ status: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => send({ status: 'error', note: (e as Error)?.message ?? String(e) }))

  ipcMain.handle('update:check', () => {
    check()
    return null
  })
  ipcMain.handle('update:install', () => {
    // isSilent=true 静默安装；isForceRun=true 安装完自动启动
    autoUpdater.quitAndInstall(true, true)
    return null
  })

  // 未打包（开发模式）不检查；打包后启动 8 秒查一次，之后每 4 小时
  if (app.isPackaged) {
    setTimeout(check, 8000)
    setInterval(check, 4 * 60 * 60 * 1000)
  }
}
