// 打开一个本地页面。
//   openInWindow  → 优先用 Chrome/Edge 的 --app 模式，弹一个没有地址栏和标签页的独立窗口，
//                   看起来就像青史自己的一个程序窗口；找不到浏览器就退回默认浏览器。
//   openInBrowser → 默认浏览器里开一个标签页。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const detached = { detached: true, stdio: 'ignore' }

function spawnDetached(command, args) {
  const child = spawn(command, args, detached)
  child.unref()
}

function windowsBrowsers() {
  const roots = [
    process.env.LOCALAPPDATA || '',
    process.env.PROGRAMFILES || 'C:\\Program Files',
    process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
  ].filter(Boolean)
  const candidates = []
  for (const root of roots) {
    candidates.push(`${root}\\Google\\Chrome\\Application\\chrome.exe`)
    candidates.push(`${root}\\Microsoft\\Edge\\Application\\msedge.exe`)
  }
  candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  candidates.push('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
  return candidates.filter((file, index, list) => list.indexOf(file) === index && existsSync(file))
}

export function openInWindow(url, { width = 1180, height = 880, title = '' } = {}) {
  try {
    if (process.platform === 'win32') {
      const browser = windowsBrowsers()[0]
      if (browser) {
        const args = [
          `--app=${url}`,
          `--window-size=${width},${height}`,
          '--window-position=120,60',
          '--no-first-run',
          '--no-default-browser-check',
        ]
        // 有标题时给窗口一个名字（任务栏提示里能看出是哪扇窗）
        if (title) args.push(`--app-name=${title}`)
        spawnDetached(browser, args)
        return { opened: true, mode: 'app-window', browser }
      }
      spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url])
      return { opened: true, mode: 'default-browser' }
    }
    if (process.platform === 'darwin') {
      spawnDetached('open', ['-na', 'Google Chrome', '--args', `--app=${url}`, `--window-size=${width},${height}`])
      return { opened: true, mode: 'app-window' }
    }
    spawnDetached('xdg-open', [url])
    return { opened: true, mode: 'default-browser' }
  } catch (error) {
    return { opened: false, mode: 'none', error: String(error?.message || error) }
  }
}

export function openInBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // rundll32 直接按参数吃 URL，不经过 shell，带 & 的地址也不会被截断
      spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url])
      return true
    }
    if (process.platform === 'darwin') {
      spawnDetached('open', [url])
      return true
    }
    spawnDetached('xdg-open', [url])
    return true
  } catch {
    return false
  }
}
