// 桌面外壳（Electron）：无边框窗口 + 自绘标题栏，只有关闭按钮。
// 这里只负责「找到 electron、起进程、拿到 CDP 端口」，窗口长什么样在 shell/ 里。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile, unlink, rm } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

const here = dirname(fileURLToPath(import.meta.url))
export const SHELL_DIR = join(here, '..', 'shell')

const ELECTRON_CANDIDATES = [
  join(SHELL_DIR, 'electron-dist', 'electron.exe'),
  join(SHELL_DIR, 'electron-dist', 'electron'),
  join(SHELL_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
  join(SHELL_DIR, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  join(SHELL_DIR, 'node_modules', 'electron', 'dist', 'electron'),
]

export function findElectron() {
  const custom = String(process.env.QINGSHI_ELECTRON || '').trim()
  if (custom && existsSync(custom)) return custom
  if (String(process.env.QINGSHI_ELECTRON || '').toLowerCase() === 'none') return ''
  for (const candidate of ELECTRON_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return ''
}

async function readDebugPort(userDataDir) {
  const file = join(userDataDir, 'DevToolsActivePort')
  if (!existsSync(file)) return 0
  try {
    const text = await readFile(file, 'utf8')
    const first = String(text).split(/\r?\n/)[0]
    const port = Number(String(first).trim())
    return Number.isFinite(port) && port > 0 ? port : 0
  } catch {
    return 0
  }
}

/**
 * 启动 Electron 外壳。
 * @returns {Promise<{pid:number, port:number, electron:string}>}
 */
// DSH 的受限令牌只对「会话工作区」可写：~/.dsh、%APPDATA%、%TEMP% 全被拒绝（0x5 / 0x3），
// 后果是 Chromium 建不了单实例锁、写不了 DevToolsActivePort、渲染进程反复崩，
// 于是不停弹「Error launching Crashsender.exe」。所以先真探一次能不能建子目录，
// 不行就往工作区 / 临时目录回退。
async function pickWritableProfile(preferred, logger) {
  const toWin = (dir) => (process.platform === 'win32' ? resolve(dir).replace(/\//g, '\\') : resolve(dir))
  const candidates = [
    toWin(preferred),
    toWin(join(process.env.DSH_WORKSPACE || process.cwd(), '.qingshi-electron-profile')),
    toWin(join(tmpdir(), 'qingshi-electron-profile')),
  ]
  const seen = new Set()
  for (const dir of candidates) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    try {
      await mkdir(dir, { recursive: true })
      // 关键：Chromium 要建 Network / Code Cache / GPUCache 这些子目录，
      // 只测「能写文件」不够，必须能建目录。
      const probeDir = join(dir, '.probe-' + Date.now())
      await mkdir(probeDir, { recursive: true })
      await rm(probeDir, { recursive: true, force: true })
      if (dir !== candidates[0]) logger?.('profile 目录不可写，改用 ' + dir)
      return dir
    } catch (error) {
      logger?.('profile 目录不可用（' + dir + '）：' + error.message)
    }
  }
  return candidates[0]
}

export async function launchShell({
  url,
  width = 1180,
  height = 880,
  userDataDir,
  port = 0,
  logger,
  timeoutMs = 25000,
}) {
  const electron = findElectron()
  if (!electron) {
    throw new Error(
      '没找到 Electron 运行时。在插件目录执行 `cd shell && npm install` 装上它，或用环境变量 QINGSHI_ELECTRON 指定可执行文件。',
    )
  }
  // Windows 下 userData 用正斜杠时 Electron 写 DevToolsActivePort 会报 0x3，统一转成反斜杠；
  // 顺带探一次可写性：写不进去就回退到临时目录，否则窗口根本起不来
  const profileDir = await pickWritableProfile(userDataDir, logger)
  // 自己挑一个固定端口，不去依赖 DevToolsActivePort 文件（那条路在 Windows 上翻过车）
  const chosenPort = port > 0 ? port : 9300 + Math.floor(Math.random() * 500)
  const env = {
    ...process.env,
    QINGSHI_URL: url,
    QINGSHI_WIDTH: String(width),
    QINGSHI_HEIGHT: String(height),
    QINGSHI_DEBUG_PORT: String(chosenPort),
    QINGSHI_USER_DATA: profileDir,
    QINGSHI_PARENT_PID: String(process.pid),
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  }
  delete env.ELECTRON_RUN_AS_NODE

  // --no-sandbox：这台机器上 Electron 的沙箱初始化会被 ACL 拦（报 cache 0x5 后直接崩），关掉才稳
  const child = spawn(electron, ['--no-sandbox', SHELL_DIR], {
    detached: true,
    stdio: 'ignore',
    env,
  })
  child.unref()
  logger?.('已启动青史桌面外壳 pid=' + child.pid)

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${chosenPort}/json/version`)
      if (res.ok) {
        logger?.('外壳调试端口 ' + chosenPort)
        return { pid: child.pid, port: chosenPort, electron, userDataDir: profileDir }
      }
    } catch {}
    const recorded = await readDebugPort(profileDir)
    if (recorded && recorded !== chosenPort) {
      try {
        const res = await fetch(`http://127.0.0.1:${recorded}/json/version`)
        if (res.ok) {
          logger?.('外壳调试端口 ' + recorded)
          return { pid: child.pid, port: recorded, electron, userDataDir: profileDir }
        }
      } catch {}
    }
    await delay(300)
  }
  throw new Error('外壳起来了但调试端口没就绪（userData: ' + profileDir + '）')
}
