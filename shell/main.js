// 青史桌面外壳：无边框窗口 + 自绘标题栏（只有关闭按钮）
// 由 DSH 插件以子进程方式启动：electron <shell 目录>，通过环境变量传参数。
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')

const TARGET_URL = process.env.QINGSHI_URL || 'https://qingshi.iyouwc.cn/#/pages/career/career'
const WIDTH = Number(process.env.QINGSHI_WIDTH || 1180)
const HEIGHT = Number(process.env.QINGSHI_HEIGHT || 880)
const DEBUG_PORT = String(process.env.QINGSHI_DEBUG_PORT || '0')
const USER_DATA = String(process.env.QINGSHI_USER_DATA || '').trim()

if (USER_DATA) {
  app.setPath('userData', USER_DATA)
}
// CDP 端口由插件指定（0 = 让 Electron 自己挑，插件读 DevToolsActivePort）
app.commandLine.appendSwitch('remote-debugging-port', DEBUG_PORT)
app.commandLine.appendSwitch('disable-features', 'Translate')
// 关掉崩溃上报：DSH 的受限令牌下 crashpad 拉不起 CrashSender.exe，
// 每当渲染进程死一次就会弹一个「Error launching Crashsender.exe」对话框。
app.commandLine.appendSwitch('disable-breakpad')
app.commandLine.appendSwitch('noerrdialogs')
app.disableHardwareAcceleration()
if (process.env.QINGSHI_DEBUG_PORT && process.env.QINGSHI_DEBUG_PORT !== '0') {
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

let win = null

// 同一个 profile 只允许一个实例：第二个直接退出，避免多个进程抢同一份 userData
// 导致渲染进程崩溃、进而触发 crashpad 弹窗。
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 锁建不起来经常是环境问题（受限令牌 / profile 只读），不代表真有第二个窗口；
  // 这种情况下继续开窗，总比「什么都没发生」好。
  console.error('[qingshi-shell] 单实例锁不可用，继续启动')
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#f6f0e4',
    title: '青史',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.loadURL(TARGET_URL)

  // 外链一律走系统浏览器，别在应用窗口里跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('shell:sync-title')
  })

  // 渲染进程如果崩了：先自动重载一次，再崩就安静退出（不弹任何对话框）
  let reloaded = 0
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[qingshi-shell] render-process-gone:', details && details.reason)
    if (reloaded < 1 && win && !win.isDestroyed()) {
      reloaded += 1
      win.reload()
      return
    }
    app.exit(0)
  })
}

ipcMain.on('shell:close', () => {
  if (win && !win.isDestroyed()) win.close()
})

ipcMain.on('shell:title', (_event, title) => {
  if (!win || win.isDestroyed() || typeof title !== 'string') return
  // 登录页登完后把标题改成这个暗号，外壳收到就自己关掉（登录窗不留在桌面上）
  if (title.trim() === 'QINGSHI_LOGIN_DONE') {
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.close()
    }, 300)
    return
  }
  if (title.trim()) win.setTitle('青史 · ' + title.trim())
})

// 跟着 DSH 一起活、一起死：插件把 Harness 的进程号传进来，父进程没了就自己退出。
// （不这样做的话，DSH 关了窗口还挂着，变成没人管的孤儿进程。）
const PARENT_PID = Number(process.env.QINGSHI_PARENT_PID || 0)
function parentAlive() {
  if (!PARENT_PID || PARENT_PID <= 0) return true
  try {
    process.kill(PARENT_PID, 0)
    return true
  } catch (error) {
    // EPERM 说明进程还在，只是没权限发信号
    return Boolean(error && error.code === 'EPERM')
  }
}

let parentWatchdog = null
function startParentWatchdog() {
  if (!PARENT_PID || PARENT_PID <= 0) return
  parentWatchdog = setInterval(() => {
    if (!parentAlive()) {
      clearInterval(parentWatchdog)
      parentWatchdog = null
      console.log('[qingshi-shell] Harness 已退出，跟着关窗口')
      app.quit()
    }
  }, 2000)
  if (parentWatchdog.unref) parentWatchdog.unref()
}

app.whenReady().then(() => {
  createWindow()
  startParentWatchdog()
})

app.on('will-quit', () => {
  if (parentWatchdog) clearInterval(parentWatchdog)
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
