// 第 3 步：复刻小程序端 utils/request.js 的 httpRequest。
//
// 对照原实现（E:/Desktop/项目/青史重构版本2/青史2/utils/request.js）保留的语义：
//   1. DEFAULT_HEADERS = {'Content-Type': 'application/json'}
//   2. buildRequestUrl(api) = apiBaseUrl + api
//   3. buildResult(code, message, data = null)
//   4. needAccessToken 时自动带 Authorization: Bearer <at>
//   5. code === 401 && autoRefreshAccessToken → refreshToken() → 重试一次
//      （重试那次 autoRefreshAccessToken = false，避免死循环）
//   6. code === 403 → 清凭证 + 要求重新登录（小程序端是 redirectToLogin）
//   7. refreshToken() 用 Authorization: Bearer <refresh_token> 打 POST /get_token
//
// 差别只是运行时：uni.request 换成 Node 的 fetch，超时用 AbortController。
import { buildResult } from './result.js'

const DEFAULT_HEADERS = { 'Content-Type': 'application/json' }
const DEFAULT_TIMEOUT_MS = 15000

/** 后端 normalize_client_platform 的规则（service.py:235）：小写、web* 归 h5、空归 unknown */
export function normalizeClientPlatform(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return 'unknown'
  if (text === 'web' || text === 'web-pc' || text === 'web-mobile') return 'h5'
  return text
}

export function createRequest({
  apiBaseUrl,
  workspace,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  clientPlatform = 'plugin',
  logger,
}) {
  const platform = normalizeClientPlatform(clientPlatform)
  const buildRequestUrl = (api) => `${apiBaseUrl}${api}`
  // 跟小程序端一样：DEFAULT_HEADERS 里就带 X-Client-Platform，所有请求（含刷新、含登录）都有
  const baseHeaders = () => ({ ...DEFAULT_HEADERS, 'X-Client-Platform': platform })

  async function rawRequest({ url, method = 'POST', header = {}, data, timeout = timeoutMs }) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await fetch(url, {
        method,
        headers: header,
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: controller.signal,
      })
      const text = await response.text()
      let body = {}
      if (text) {
        try {
          body = JSON.parse(text)
        } catch {
          throw new Error(`返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 120)}`)
        }
      }
      return { statusCode: response.status, data: body }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 读出 JWT 的过期时间（秒）。解不开就返回 0。
   * 只用来判断「是不是快到期了」，不做任何校验。
   */
  function expOf(token) {
    try {
      const part = String(token || '').split('.')[1]
      if (!part) return 0
      const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
      const data = JSON.parse(json)
      return Number(data?.exp) || 0
    } catch {
      return 0
    }
  }

  /**
   * refresh_token 太久没喂过了吗（> 5 天）。
   * 后端每调一次 /get_token 就把 RT 的 7 天有效期顺延，超过 7 天完全没调就会过期。
   */
  async function refreshTokenStale(days = 5) {
    const info = await workspace.info().catch(() => ({}))
    const last = Date.parse(info.refreshedAt || info.savedAt || '')
    if (!last) return false
    return Date.now() - last > days * 24 * 60 * 60 * 1000
  }

  /**
   * access_token 还够用吗？
   * 后端 AT 是 2 小时，这里留 10 分钟余量：快到期就提前续，
   * 免得「刚好在过期那一刻」打请求、白吃一次 401。
   */
  function accessTokenFresh(token, marginMs = 10 * 60 * 1000) {
    const exp = expOf(token)
    if (!exp) return true // 解不开就别自作聪明，按原来的 401 逻辑走
    return exp * 1000 - Date.now() > marginMs
  }

  /** 对应 utils/request.js 的 refreshToken() */
  async function refreshToken() {
    const refresh = await workspace.getRefreshToken()
    if (!refresh) return buildResult(403, '缺少 refresh_token，需要重新登录', null)

    let response
    try {
      response = await rawRequest({
        url: buildRequestUrl('/get_token'),
        method: 'POST',
        header: { ...baseHeaders(), Authorization: `Bearer ${refresh}` },
        data: {},
      })
    } catch (err) {
      logger?.(`refreshToken 网络失败：${err?.message || err}`)
      return buildResult(500, '刷新登录状态失败，请检查网络', null)
    }

    const body = response.data || {}
    if (body.code === 200) {
      // 后端只回 access_token；工作区里 refresh_token 保持不动
      // 记下这次续期时间：后端每次续期会把 refresh_token 顺延 7 天
      await workspace.setAuthStorage({
        ...(body.data || {}),
        refreshedAt: new Date().toISOString(),
      })
      return buildResult(200, '刷新成功', body.data || {})
    }
    if (body.code === 403) {
      return buildResult(403, body.message || '登录已失效，请重新登录', null)
    }
    return buildResult(body.code || response.statusCode || 500, body.message || '刷新失败', body.data || null)
  }

  /**
   * 复刻 httpRequest(api, data, options)。
   * options: { method, needAccessToken, autoRefreshAccessToken, timeout, header }
   * 返回 buildResult(code, message, data)；不抛异常。
   */
  /** 对应 utils/request.js:44 normalizeRequestOptions() */
  function normalizeRequestOptions(options = {}) {
    const o = options || {}
    return {
      method: o.method || 'POST',
      // 小程序端默认 true：业务接口一律带 Authorization
      needAccessToken: o.needAccessToken ?? o.needToken ?? true,
      autoRefreshAccessToken: o.autoRefreshAccessToken ?? o.autoRefresh ?? true,
      showErrorToast: o.showErrorToast ?? true,
      showServerErrorMessage: o.showServerErrorMessage ?? true,
      timeout: Number(o.timeout) > 0 ? Number(o.timeout) : timeoutMs,
      header: o.header || {},
    }
  }

  async function httpRequest(api, data = {}, options = {}) {
    const opts = normalizeRequestOptions(options)

    const header = { ...baseHeaders(), ...(opts.header || {}) }

    if (opts.needAccessToken) {
      let access = await workspace.getAccessToken()
      if (!access) return buildResult(401, '还没登录青史，请先调用 qingshi_save_login', null)
      // ① AT 快到期 → 先续（别等 401）
      // ② 超过 5 天没续过 → 也喂一次，把 refresh_token 的 7 天窗口顺延住
      if (opts.autoRefreshAccessToken) {
        const due = !accessTokenFresh(access) || (await refreshTokenStale())
        if (due) {
          const early = await refreshToken()
          if (early.code === 200) {
            access = (await workspace.getAccessToken()) || access
          }
        }
      }
      header.Authorization = `Bearer ${access}`
    }

    let response
    try {
      response = await rawRequest({
        url: buildRequestUrl(api),
        method: opts.method,
        header,
        data,
        timeout: opts.timeout,
      })
    } catch (err) {
      const message = err?.name === 'AbortError' ? `请求超时（${opts.timeout}ms）` : `请求失败：${err?.message || err}`
      logger?.(`httpRequest ${api} ${message}`)
      return buildResult(500, message, null)
    }

    if (response.statusCode !== 200) {
      return buildResult(response.statusCode, `HTTP ${response.statusCode}`, null)
    }

    const body = response.data || {}

    // 401：access_token 过期 → 换新的，然后重试一次
    if (body.code === 401 && opts.autoRefreshAccessToken) {
      const refreshed = await refreshToken()
      if (refreshed.code === 200) {
        // 重试那次关掉自动续期，避免死循环（对应 utils/request.js:193）
        return httpRequest(api, data, {
          ...opts,
          autoRefreshAccessToken: false,
          autoRefresh: false,
        })
      }
      return refreshed
    }

    // 403：refresh_token 也失效了 → 要求重新登录
    if (body.code === 403) {
      return buildResult(403, body.message || '登录已失效，请重新调用 qingshi_login', null)
    }

    // 其余照原样透传后端返回（青史的接口有的返回 {code,message,data}，
    // 有的直接把业务字段放顶层，比如 /get_career_list 的 career_list / event_list）
    if (Object.prototype.hasOwnProperty.call(body, 'data') || Object.prototype.hasOwnProperty.call(body, 'code')) {
      return {
        ...body,
        code: body.code ?? 200,
        message: body.message ?? '',
        data: Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : null,
      }
    }
    return buildResult(200, '', body)
  }

  /** 对应 utils/request.js:235 getCurrentUid() */
  async function getCurrentUid() {
    const info = await workspace.info().catch(() => ({}))
    return String(info.uid || '').trim()
  }

  /** 对应 utils/request.js:18 clearAuthStorage() */
  async function clearAuthStorage() {
    await workspace.clear().catch(() => {})
  }

  return {
    httpRequest,
    refreshToken,
    rawRequest,
    expOf,
    accessTokenFresh,
    normalizeRequestOptions,
    getCurrentUid,
    clearAuthStorage,
  }
}
