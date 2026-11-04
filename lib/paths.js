// 统一的数据目录。
//
// 一个原则：**同一台机器、同一个系统用户，只有一份数据**，跟在哪个宿主里跑没关系
// （DSH 插件、MCP server、Claude Code、Codex、命令行都算）。这样登录一次，
// 换个客户端不用再登；草稿、窗口注册表、localStorage 快照也都能接着用。
//
// 位置按各平台约定放，不再塞在 ~/.dsh 或者当前目录里：
//   Windows  %APPDATA%\qingshi          → C:\Users\<你>\AppData\Roaming\qingshi
//   macOS    ~/Library/Application Support/qingshi
//   Linux    $XDG_CONFIG_HOME/qingshi   → ~/.config/qingshi
//
// 想要换地方（比如放到移动硬盘、或者测试用临时目录），两种办法：
//   1. 环境变量 QINGSHI_HOME=/some/dir
//   2. 插件配置 workspaceDir（DSH）或 QINGSHI_WORKSPACE（MCP/命令行）
// 优先级：显式配置 > QINGSHI_HOME > 平台默认。
import { existsSync, mkdirSync, copyFileSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform, tmpdir } from 'node:os'

export const APP_DIR_NAME = 'qingshi'

/** 平台默认的数据目录（纯字符串计算，不碰磁盘）。 */
export function defaultHomeDir() {
  const os = platform()
  if (os === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    return join(appData, APP_DIR_NAME)
  }
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_DIR_NAME)
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(xdg, APP_DIR_NAME)
}

/** 老版本用过、需要迁移过来的目录。 */
export function legacyDirs() {
  const dirs = []
  if (process.env.DSH_HOME) dirs.push(join(process.env.DSH_HOME, 'qingshi-workspace'))
  dirs.push(join(homedir(), '.dsh', 'qingshi-workspace'))
  if (process.env.DSH_WORKSPACE) dirs.push(join(process.env.DSH_WORKSPACE, '.qingshi-workspace'))
  dirs.push(join(process.cwd(), '.qingshi-workspace'))
  return Array.from(new Set(dirs))
}

/** 目录能不能真的写进去（建目录 + 写一个探针文件 + 删掉）。 */
export function isWritableDir(dir) {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, '.write-probe')
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/** 当前工作目录下的备选（不少 AI 客户端只允许写项目目录）。 */
export function cwdFallbackDir() {
  return join(process.cwd(), '.' + APP_DIR_NAME)
}

/** 最后兜底：系统临时目录，至少别让登录直接失败。 */
export function tmpFallbackDir() {
  return join(tmpdir(), APP_DIR_NAME)
}

/**
 * 按「可写」选目录，返回 {dir, source}。source 用来解释为什么落在这里。
 * 顺序：显式配置 → QINGSHI_HOME → 平台默认 → 当前目录/.qingshi → 临时目录。
 */
export function pickHomeDir(config = {}) {
  const explicit = String(config.workspaceDir || process.env.QINGSHI_WORKSPACE || '').trim()
  if (explicit) return { dir: explicit, source: 'config' }
  const envHome = String(process.env.QINGSHI_HOME || '').trim()
  if (envHome) return { dir: envHome, source: 'env' }
  const candidates = [
    { dir: defaultHomeDir(), source: 'platform' },
    { dir: cwdFallbackDir(), source: 'cwd' },
    { dir: tmpFallbackDir(), source: 'tmp' },
  ]
  for (const c of candidates) {
    if (isWritableDir(c.dir)) return c
  }
  // 一个都写不进去：仍旧返回平台默认，让上层报一个清楚的错误。
  return { dir: defaultHomeDir(), source: 'platform' }
}

/** 数据根目录（只要路径）。 */
export function resolveHomeDir(config = {}) {
  return pickHomeDir(config).dir
}

/** 给工具用：现在到底存在哪、能不能写、里面有什么。 */
export function describeHomeDir(config = {}) {
  const { dir, source } = pickHomeDir(config)
  const files = []
  for (const name of ['auth.json', 'drafts.json', 'users.json', 'browser-storage.json', 'browser-window.json']) {
    try {
      if (existsSync(join(dir, name))) files.push(name)
    } catch {}
  }
  return { dir, source, writable: isWritableDir(dir), files }
}

// 迁移时搬哪些东西：凭证、草稿、图片、用户缓存、窗口/页面状态。
// shots（截图）不搬——它体积最大、也没必要。
const MIGRATE_FILES = [
  'auth.json',
  'drafts.json',
  'users.json',
  'browser-window.json',
  'browser-profile.json',
  'browser-storage.json',
]
const MIGRATE_DIRS = ['media', 'trash']

/**
 * 要不要做老数据迁移？只在「用默认位置」时做。
 * 显式指定了目录（测试、临时工作区、自己选的路径）就说明他要一份干净的，别把别人的数据灌进去。
 */
export function shouldMigrate(config = {}) {
  const explicit = String(config.workspaceDir || process.env.QINGSHI_WORKSPACE || '').trim()
  if (explicit) return false
  if (String(process.env.QINGSHI_NO_MIGRATE || '').trim()) return false
  return true
}

/**
 * 第一次跑新版本时，把老目录里的数据搬到新位置（只补缺，不覆盖）。
 * 同步调用，只在插件加载时跑一次；任何失败都静默跳过，不能拖住插件。
 * @returns {string[]} 实际搬过来的东西
 */
export function migrateLegacy(home) {
  const moved = []
  try {
    if (process.env.QINGSHI_NO_MIGRATE) return moved
    if (!existsSync(home)) mkdirSync(home, { recursive: true })
    for (const old of legacyDirs()) {
      if (old === home || !existsSync(old)) continue
      for (const name of MIGRATE_FILES) {
        const src = join(old, name)
        const dest = join(home, name)
        if (existsSync(src) && !existsSync(dest)) {
          try {
            copyFileSync(src, dest)
            moved.push(name)
          } catch {}
        }
      }
      for (const name of MIGRATE_DIRS) {
        const src = join(old, name)
        const dest = join(home, name)
        if (existsSync(src) && !existsSync(dest)) {
          try {
            cpSync(src, dest, { recursive: true })
            moved.push(name + '/')
          } catch {}
        }
      }
    }
  } catch {}
  return moved
}
