// 第 2 步：工作区。
//
// 青史是双重 token：access_token 用来请求后端，refresh_token 用来在 access_token
// 过期时换新的。两个都落在这个工作区的 auth.json 里，权限 0600。
//
// 安全底线：token 只在工作区文件和插件内部流转，绝不作为工具参数进入会话，
// 也绝不写进工具输出。
import { readFile, writeFile, mkdir, chmod, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveHomeDir } from './paths.js'

/** 默认数据目录：全平台统一，DSH / MCP / 命令行共用同一份（见 lib/paths.js）。 */
export function defaultWorkspaceDir() {
  return resolveHomeDir()
}

/**
 * 写不进去时说句人话。
 * 其他 AI 客户端（workbuddy、某些沙箱里的 Claude Code）会把用户目录锁住，
 * 这时候直接抛 EPERM/EACCES 用户根本不知道该怎么办，所以把「换个目录」的办法说清楚。
 */
function writeBlockedMessage(dir, error) {
  const code = String((error && (error.code || error.message)) || '')
  const blocked = /EPERM|EACCES|EROFS|denied|not permitted/i.test(code)
  const where = process.cwd ? `现在可以先这样：把 QINGSHI_HOME 指向项目目录，例如 QINGSHI_HOME=${join(process.cwd(), '.qingshi')}` : ''
  return blocked
    ? `这个环境不允许写 ${dir}（${code}）。${where}`
    : `保存凭证失败：${code}（目录 ${dir}）`
}

/**
 * 打开（或创建）一个工作区。
 * @param {string} dir 工作区目录
 */
export function createWorkspace(dir) {
  const authFile = join(dir, 'auth.json')

  async function read() {
    try {
      const raw = await readFile(authFile, 'utf8')
      const data = JSON.parse(raw)
      if (!data || typeof data !== 'object') return null
      if (typeof data.accessToken !== 'string' || !data.accessToken) return null
      return data
    } catch {
      return null
    }
  }

  async function write(patch) {
    try {
      await mkdir(dirname(authFile), { recursive: true })
    } catch (error) {
      throw new Error(writeBlockedMessage(dir, error))
    }
    const payload = JSON.stringify(
      {
        uid: patch.uid || '',
        accessToken: patch.accessToken,
        refreshToken: patch.refreshToken || '',
        clientPlatform: patch.clientPlatform || '',
        savedAt: new Date().toISOString(),
        // 最近一次「用 refresh_token 换过 access_token」的时间。
        // 后端每次续期会把 refresh_token 的有效期顺延 7 天，所以要定期喂它一次。
        refreshedAt: patch.refreshedAt || '',
        // 登录时后端若回了过期时间就记下来，用于「先判断再登录」
        refreshExpiresAt: patch.refreshExpiresAt || '',
      },
      null,
      2,
    )
    try {
      await writeFile(authFile, payload, { encoding: 'utf8', mode: 0o600 })
    } catch (error) {
      throw new Error(writeBlockedMessage(dir, error))
    }
    // Windows 上 chmod 对权限位基本无效，忽略失败；POSIX 上再兜一次。
    try {
      await chmod(authFile, 0o600)
    } catch {
      /* ignore */
    }
    return read()
  }

  return {
    dir,
    authFile,

    /** 读凭证；没有就返回 null。 */
    load: read,

    /** 登录成功后落盘；只覆盖传入的字段，别的保持不动。 */
    async save(auth) {
      const prev = (await read()) || {}
      return write({
        uid: auth.uid || prev.uid || '',
        // 后端刷新只回 access_token、不回 refresh_token，所以旧的要留着
        accessToken: auth.accessToken || prev.accessToken || '',
        refreshToken: auth.refreshToken || prev.refreshToken || '',
        // 登录时后端按 X-Client-Platform 隔离 refresh_token 行，这里记下实际落在哪一档
        clientPlatform: auth.clientPlatform || prev.clientPlatform || '',
        refreshedAt: auth.refreshedAt || prev.refreshedAt || '',
        refreshExpiresAt: auth.refreshExpiresAt || prev.refreshExpiresAt || '',
      })
    },

    /**
     * 复刻小程序端 setAuthStorage 的防御式写入：只有传了值才覆盖。
     * 这样 /get_token 只回 access_token 时不会把本地 refresh_token 冲掉。
     */
    async setAuthStorage(data = {}) {
      const prev = (await read()) || {}
      const next = {
        uid: data.uid || prev.uid || '',
        accessToken: data.access_token || prev.accessToken || '',
        refreshToken: data.refresh_token || prev.refreshToken || '',
        clientPlatform: data.client_platform || prev.clientPlatform || '',
        // 这次写入是因为「刚续过期」，打上时间戳
        refreshedAt: data.refreshedAt || prev.refreshedAt || '',
        refreshExpiresAt: data.refresh_expires_at || prev.refreshExpiresAt || '',
      }
      if (!next.accessToken) return prev
      return write(next)
    },

    async getAccessToken() {
      return (await read())?.accessToken || ''
    },

    async getRefreshToken() {
      return (await read())?.refreshToken || ''
    },

    async clear() {
      await rm(authFile, { force: true })
    },

    /** 给工具输出用的摘要，不含任何 token 明文。 */
    async info() {
      const data = await read()
      if (!data) return { loggedIn: false, dir, authFile }
      let savedAt = data.savedAt || ''
      if (!savedAt) {
        try {
          savedAt = (await stat(authFile)).mtime.toISOString()
        } catch {
          /* ignore */
        }
      }
      return {
        loggedIn: true,
        uid: data.uid || '',
        clientPlatform: data.clientPlatform || '',
        hasAccessToken: Boolean(data.accessToken),
        hasRefreshToken: Boolean(data.refreshToken),
        savedAt,
        refreshedAt: data.refreshedAt || '',
        refreshExpiresAt: data.refreshExpiresAt || '',
        dir,
        authFile,
      }
    },
  }
}
