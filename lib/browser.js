// 浏览器驱动：启动/复用带调试端口的 Chrome 或 Edge，用 CDP 操作真实的青史 H5。
// 只依赖 Node 内置能力（child_process + 全局 WebSocket），不引第三方包。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]

export function findBrowser() {
  // QINGSHI_BROWSER=none 用来在测试/无界面环境里显式关掉（不启动浏览器）
  if (String(process.env.QINGSHI_BROWSER || '').toLowerCase() === 'none') return ''
  if (process.env.QINGSHI_BROWSER && existsSync(process.env.QINGSHI_BROWSER)) return process.env.QINGSHI_BROWSER
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return ''
}

async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  return res.json()
}

async function readDevToolsPort(profileDir) {
  const file = join(profileDir, 'DevToolsActivePort')
  if (!existsSync(file)) return 0
  try {
    const text = await readFile(file, 'utf8')
    const firstLine = String(text).split(/\r?\n/)[0]
    const port = Number(firstLine.trim())
    return Number.isFinite(port) ? port : 0
  } catch {
    return 0
  }
}

/** 等 DevToolsActivePort 文件出现（Chrome 用 --remote-debugging-port=0 时自己挑端口并写这个文件）。 */
async function waitDevToolsPort(profileDir, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const port = await readDevToolsPort(profileDir)
    if (port) {
      const targets = await waitPort(port, 3000)
      if (targets) return port
    }
    await delay(250)
  }
  return 0
}

async function waitPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets(port)
      if (Array.isArray(targets)) return targets
    } catch { /* 还没起来 */ }
    await delay(250)
  }
  return null
}

function pickPage(targets, hint = '') {
  if (!Array.isArray(targets) || !targets.length) return null
  const pages = targets.filter((t) => t.type === 'page')
  return pages.find((t) => hint && String(t.url).includes(hint)) || pages[0] || null
}

/**
 * 起一个「独立应用窗口」（Chrome/Edge --app），带调试端口，profile 落在固定目录，
 * 这样登录态能跨会话保留，AI 也能随时接上这个页面。
 */
export async function launchApp({ url, port = 0, profileDir, width = 1180, height = 880, kiosk = false, logger }) {
  const browser = findBrowser()
  if (!browser) throw new Error('没找到 Chrome / Edge，装一个再来')
  await mkdir(profileDir, { recursive: true })
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    '--window-position=120,60',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    ...(kiosk ? ['--kiosk', '--kiosk-exit-on-esc'] : []),
    `--app=${url}`,
  ]
  const child = spawn(browser, args, { detached: true, stdio: 'ignore' })
  child.unref()
  logger?.('已启动浏览器 ' + browser + ' pid=' + child.pid)
  // Chrome 可能被已有实例接管（此时不会新开端口），所以统一从 DevToolsActivePort 里找真实端口
  const actual = await waitDevToolsPort(profileDir, 20000)
  if (!actual) throw new Error('浏览器起来了但调试端口没就绪（profile: ' + profileDir + '）')
  logger?.('调试端口 ' + actual)
  return { pid: child.pid, browser, port: actual }
}

/** 连上已有窗口；不启动新的。 */
export async function attach({ port, hint = '', timeoutMs = 15000 }) {
  const targets = await waitPort(port, timeoutMs)
  if (!targets) throw new Error('调试端口 ' + port + ' 没响应，先 qingshi_open_h5 打开窗口')
  // --app 窗口刚起来时 /json/list 里可能只有 about:blank，等真正的页面出现
  let target = pickPage(targets, hint)
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    const usable = target && /^https?:/.test(String(target.url)) && String(target.url) !== 'about:blank'
    if (usable) break
    await delay(300)
    try {
      target = pickPage(await listTargets(port), hint) || target
    } catch { /* 忽略 */ }
  }
  if (!target) throw new Error('端口 ' + port + ' 上没有可用的页面')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const events = []
  const eventHandlers = new Set()
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP 连接超时')), 8000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
    ws.addEventListener('error', (event) => { clearTimeout(timer); reject(new Error('CDP 连接失败: ' + String(event?.message || ''))) })
  })
  ws.addEventListener('message', (raw) => {
    let data = null
    try { data = JSON.parse(raw.data) } catch { return }
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data)
      pending.delete(data.id)
      return
    }
    if (data.method) {
      events.push(data.method)
      if (eventHandlers.size) {
        for (const handler of eventHandlers) {
          try { handler(data.method, data.params || {}) } catch { /* 单个监听出错不影响别的 */ }
        }
      }
    }
  })

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, 20000)
    pending.set(id, (data) => {
      clearTimeout(timer)
      if (data.error) reject(new Error(method + ' 失败: ' + (data.error.message || JSON.stringify(data.error))))
      else resolve(data.result)
    })
    ws.send(JSON.stringify({ id, method, params }))
  })

  await send('Runtime.enable')
  await send('Page.enable')

  const evaluate = async (expression, { awaitPromise = true } = {}) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      throw new Error('页面脚本出错: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text))
    }
    return result.result?.value
  }

  const currentUrl = () => evaluate('location.href')

  const goto = async (url) => {
    await send('Page.navigate', { url })
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      await delay(220)
      try {
        const ready = await evaluate('document.readyState')
        if (ready === 'complete') break
      } catch { /* 导航中会短暂报错 */ }
    }
    await delay(500)
    return currentUrl()
  }

  /** 读当前页面：标题、可见文本、可点元素、输入框。 */
  const readPage = async ({ maxText = 2500 } = {}) => evaluate(`(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
    }
    const textOf = (el) => String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
    const hintOf = (el) => {
      const own = String(el.placeholder || '').trim()
      if (own) return own
      const box = el.closest('uni-input, uni-textarea, .uni-input, .uni-textarea, .input, .field, label') || el.parentElement
      if (!box) return ''
      const ph = box.querySelector('.uni-input-placeholder, .uni-textarea-placeholder, [class*=placeholder]')
      return ph ? String(ph.innerText || ph.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : ''
    }
    const buttons = []
    const seen = new Set()
    const clickable = document.querySelectorAll('button, a, [role=button], .btn, .button, uni-button, uni-view[class*=btn], uni-view[class*=tab], uni-view[class*=item], uni-view[class*=card]')
    for (const el of clickable) {
      if (!visible(el)) continue
      const text = textOf(el).slice(0, 60)
      if (!text || text.length < 1) continue
      const key = text + '|' + Math.round(el.getBoundingClientRect().top)
      if (seen.has(key)) continue
      seen.add(key)
      buttons.push(text)
      if (buttons.length >= 40) break
    }
    const inputs = []
    document.querySelectorAll('input, textarea').forEach((el) => {
      if (!visible(el)) return
      inputs.push({
        placeholder: hintOf(el),
        type: String(el.type || 'text'),
        value: String(el.value || ''),
        index: inputs.length,
      })
    })
    return {
      url: location.href,
      title: document.title,
      text: textOf(document.body).slice(0, ${maxText}),
      buttons,
      inputs,
    }
  })()`)

  /** 按文字点一下（找不到再按 selector 点）。 */
  const click = async ({ text = '', selector = '' } = {}) => evaluate(`(() => {
    const textOf = (el) => String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const selector = ${JSON.stringify(selector)}
    const wanted = ${JSON.stringify(text)}
    if (selector) {
      const el = document.querySelector(selector)
      if (!el) return { ok: false, reason: 'selector 没找到: ' + selector }
      el.scrollIntoView({ block: 'center' })
      el.click()
      return { ok: true, via: 'selector', text: textOf(el).slice(0, 40) }
    }
    const candidates = [...document.querySelectorAll('button, a, [role=button], uni-button, uni-view, uni-text, span, div')]
      .filter((el) => visible(el) && textOf(el) === wanted)
    if (!candidates.length) {
      const loose = [...document.querySelectorAll('button, a, [role=button], uni-button, uni-view, span, div')]
        .filter((el) => visible(el) && textOf(el).includes(wanted) && textOf(el).length <= wanted.length + 12)
      if (!loose.length) return { ok: false, reason: '页面上没找到「' + wanted + '」' }
      loose[loose.length - 1].scrollIntoView({ block: 'center' })
      loose[loose.length - 1].click()
      return { ok: true, via: 'contains', text: textOf(loose[loose.length - 1]).slice(0, 40) }
    }
    const target = candidates[candidates.length - 1]
    target.scrollIntoView({ block: 'center' })
    target.click()
    return { ok: true, via: 'exact', text: textOf(target).slice(0, 40) }
  })()`)

  /** 填一个输入框：按 placeholder 或序号定位，写值并派发 input 事件（uni-app 的 v-model 靠它）。 */
  const type = async ({ placeholder = '', index = -1, value = '' } = {}) => evaluate(`(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
    }
    const fields = [...document.querySelectorAll('input, textarea')].filter(visible)
    const hintOf = (el) => {
      const own = String(el.placeholder || '').trim()
      if (own) return own
      const box = el.closest('uni-input, uni-textarea, .uni-input, .uni-textarea, .input, .field, label') || el.parentElement
      if (!box) return ''
      const ph = box.querySelector('.uni-input-placeholder, .uni-textarea-placeholder, [class*=placeholder]')
      return ph ? String(ph.innerText || ph.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : ''
    }
    const placeholder = ${JSON.stringify(placeholder)}
    const index = ${JSON.stringify(index)}
    const value = ${JSON.stringify(value)}
    let el = null
    if (placeholder) el = fields.find((f) => hintOf(f).includes(placeholder))
    if (!el && index >= 0) el = fields[index]
    if (!el) return { ok: false, reason: '没找到输入框', count: fields.length, hints: fields.map((f) => hintOf(f)) }
    el.focus()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: el.value, placeholder: hintOf(el) }
  })()`)

  const screenshot = async (filePath) => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, Buffer.from(result.data, 'base64'))
    return filePath
  }

  const storage = async () => evaluate(`(() => {
    const out = {}
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      out[key] = localStorage.getItem(key)
    }
    return out
  })()`)

  /**
   * 在页面坐标上点一下。
   * 族谱是无限画布，节点和菜单不一定有稳定的文字/选择器，坐标点击最稳。
   */
  async function tap({ x, y } = {}) {
    const px = Math.round(Number(x))
    const py = Math.round(Number(y))
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      throw new Error('tap 需要 x、y 两个数字坐标')
    }
    const point = { x: px, y: py, button: 'left', clickCount: 1 }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point })
    return { ok: true, x: px, y: py }
  }

  /** 把一份 localStorage 快照写回页面（换新 profile 时用来恢复页面状态）。 */
  async function restoreStorage(snapshot) {
    const entries = snapshot && typeof snapshot === 'object' ? snapshot : {}
    const keys = Object.keys(entries)
    if (!keys.length) return { ok: true, written: 0 }
    const literal = JSON.stringify(entries)
    await evaluate(`(() => {
      const data = ${literal}
      for (const key of Object.keys(data)) localStorage.setItem(key, data[key])
      return Object.keys(data).length
    })()`)
    return { ok: true, written: keys.length }
  }

  /** 把窗口固定成指定宽高（复用已开窗口时启动参数不生效，靠这个兜住）。 */
  async function setWindowSize({ width, height, left, top } = {}) {
    try {
      const info = await send('Browser.getWindowForTarget', {})
      const windowId = info?.windowId
      if (!windowId) return { ok: false, reason: 'no-window-id' }
      const bounds = {}
      if (Number.isFinite(width) && width > 0) bounds.width = Math.round(width)
      if (Number.isFinite(height) && height > 0) bounds.height = Math.round(height)
      if (Number.isFinite(left)) bounds.left = Math.round(left)
      if (Number.isFinite(top)) bounds.top = Math.round(top)
      await send('Browser.setWindowBounds', { windowId, bounds })
      return { ok: true, windowId }
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) }
    }
  }

  /** 订阅 CDP 事件（拿得到 params）。返回取消订阅的函数。 */
  function onEvent(handler) {
    eventHandlers.add(handler)
    return () => eventHandlers.delete(handler)
  }

  /*
   * 给窗口里的登录请求加一个 X-Client-Platform 头。
   *
   * 为什么需要：后端按 (uid, client_platform) 存 refresh_token，
   * 但登录请求是 H5 页面自己发的（login.vue 只传 phone/code），
   * 后端只能记成 h5/unknown。这里在请求出网前把平台头补上，
   * 顺带把 CORS 预检的 Access-Control-Request-Headers 也带上这个头，
   * 否则浏览器会因为这根新头不在预检允许列表里而拦掉响应。
   */
  const PLATFORM_HEADER = 'x-client-platform'
  let requestPlatform = ''
  let fetchHookOff = null

  function rewriteHeaders(request) {
    const source = request.headers || {}
    const headers = {}
    for (const [key, value] of Object.entries(source)) {
      if (key.toLowerCase() === PLATFORM_HEADER) continue
      headers[key] = value
    }
    if (String(request.method || '').toUpperCase() === 'OPTIONS') {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== 'access-control-request-headers') continue
        const list = String(value || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
        if (!list.some((item) => item.toLowerCase() === PLATFORM_HEADER)) list.push(PLATFORM_HEADER)
        headers[key] = list.join(', ')
      }
    } else {
      headers['X-Client-Platform'] = requestPlatform
    }
    return headers
  }

  async function handlePaused(method, params) {
    if (method !== 'Fetch.requestPaused') return
    const { requestId, request } = params
    if (!requestId) return
    try {
      await send('Fetch.continueRequest', { requestId, headers: rewriteHeaders(request) })
    } catch {
      // 继续失败就用原来的请求走，别把登录卡死
      try { await send('Fetch.continueRequest', { requestId }) } catch { /* ignore */ }
    }
  }

  async function setRequestPlatform(platform, { urlPatterns = ['*/login/sms_*'] } = {}) {
    const next = String(platform || '').trim()
    if (!next) {
      requestPlatform = ''
      if (fetchHookOff) {
        fetchHookOff()
        fetchHookOff = null
        await send('Fetch.disable').catch(() => {})
      }
      return { enabled: false }
    }
    requestPlatform = next
    if (!fetchHookOff) {
      fetchHookOff = onEvent((method, params) => { handlePaused(method, params).catch(() => {}) })
      try {
        await send('Fetch.enable', {
          patterns: urlPatterns.map((urlPattern) => ({ urlPattern, requestStage: 'Request' })),
        })
      } catch (error) {
        fetchHookOff()
        fetchHookOff = null
        return { enabled: false, reason: String(error?.message || error) }
      }
    }
    return { enabled: true, platform: requestPlatform, patterns: urlPatterns }
  }

  /** 每次新文档加载前注入（页面刷新/跳转后自绘标题条不会丢） */
  async function addInitScript(source) {
    return send('Page.addScriptToEvaluateOnNewDocument', { source })
  }

  return {
    port,
    send,
    setWindowSize,
    addInitScript,
    evaluate,
    currentUrl,
    goto,
    readPage,
    click,
    type,
    screenshot,
    storage,
    tap,
    restoreStorage,
    onEvent,
    setRequestPlatform,
    close: () => {
      try { if (fetchHookOff) { fetchHookOff(); fetchHookOff = null } } catch { /* ignore */ }
      try { ws.close() } catch { /* ignore */ }
    },
  }
}
