// 插件自带的登录服务（方案 B）：只监听 127.0.0.1，页面在 lib/login-page.js。
// 登录请求从这里发出，所以能带 X-Client-Platform: plugin；凭证写盘也在这里完成，
// 用户登完不需要回对话里再点一次确认。

import { createServer } from 'node:http'
import { renderLoginPage } from './login-page.js'

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/**
 * 起一个只服务本机登录页的 http 服务。
 * @param {object} options
 * @param {(phone:string)=>Promise<object>} options.sendCode  发验证码（失败要抛错或返回 code!==200）
 * @param {(phone:string, code:string)=>Promise<object>} options.submitLogin 登录并落盘，返回 {uid}
 * @param {()=>Promise<boolean>} [options.isLoggedIn]
 * @param {number} [options.timeoutMs] 0 = 一直等
 */
export async function startLoginServer({ sendCode, submitLogin, isLoggedIn, logger, timeoutMs = 0 } = {}) {
  if (typeof sendCode !== 'function' || typeof submitLogin !== 'function') {
    throw new Error('startLoginServer 需要 sendCode 和 submitLogin')
  }

  let settled = false
  let resolveDone
  const done = new Promise((resolve) => {
    resolveDone = resolve
  })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname

    try {
      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        const html = renderLoginPage({ port: server.address()?.port || 0 })
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(html),
          'Cache-Control': 'no-store',
        })
        res.end(html)
        return
      }

      if (req.method === 'GET' && path === '/api/state') {
        let loggedIn = false
        try {
          loggedIn = typeof isLoggedIn === 'function' ? Boolean(await isLoggedIn()) : false
        } catch {
          loggedIn = false
        }
        sendJson(res, 200, { loggedIn, settled })
        return
      }

      if (req.method === 'POST' && path === '/api/sms_send') {
        const body = await readBody(req)
        const phone = String(body.phone || '').trim()
        if (!/^1[3-9]\d{9}$/.test(phone)) {
          sendJson(res, 200, { code: 400, message: '手机号格式不正确' })
          return
        }
        try {
          const result = await sendCode(phone)
          sendJson(res, 200, { code: 200, message: (result && result.message) || '验证码已发送' })
        } catch (error) {
          sendJson(res, 200, { code: 400, message: error.message || '验证码发送失败' })
        }
        return
      }

      if (req.method === 'POST' && path === '/api/sms_login') {
        const body = await readBody(req)
        const phone = String(body.phone || '').trim()
        const code = String(body.code || '').trim()
        if (!/^1[3-9]\d{9}$/.test(phone)) {
          sendJson(res, 200, { code: 400, message: '手机号格式不正确' })
          return
        }
        if (!/^\d{4,6}$/.test(code)) {
          sendJson(res, 200, { code: 400, message: '验证码是 4~6 位数字' })
          return
        }
        try {
          const session = await submitLogin(phone, code)
          settled = true
          sendJson(res, 200, { code: 200, message: '登录成功', uid: session && session.uid })
          resolveDone?.({ ok: true, uid: (session && session.uid) || '' })
          setTimeout(() => close(), 1500)
        } catch (error) {
          sendJson(res, 200, { code: 400, message: error.message || '登录失败' })
        }
        return
      }

      sendJson(res, 404, { code: 404, message: 'Not Found' })
    } catch (error) {
      logger?.('登录服务出错：' + (error && error.message))
      sendJson(res, 500, { code: 500, message: error.message || '服务出错' })
    }
  })

  let closed = false
  let timer = null
  function close() {
    if (closed) return
    closed = true
    if (timer) clearTimeout(timer)
    try {
      server.close()
    } catch {
      /* 已经关了 */
    }
    if (!settled) resolveDone?.({ ok: false, reason: 'closed' })
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const port = server.address().port
  const url = `http://127.0.0.1:${port}/`

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      logger?.('登录等待超时，关掉本地登录页')
      if (!settled) resolveDone?.({ ok: false, reason: 'timeout' })
      close()
    }, timeoutMs)
    timer.unref?.()
  }

  logger?.('本地登录页已就绪 ' + url)
  return { port, url, done, close, status: () => ({ settled, closed }) }
}
