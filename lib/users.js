// uid → 用户资料（昵称 / 头像 / 标签 / 生日 / 简介）
// 复刻青史小程序端 utils/userCache.js：内存 + 落盘双缓存，24 小时过期，
// 刷新失败时先给旧的（不阻塞页面）。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const EXPIRE_MS = 24 * 60 * 60 * 1000

function normalizeUid(uid) {
  return String(uid || '').trim()
}

function pickUserinfo(result) {
  // 后端：{ code:200, data:{...userinfo} }；小程序端还兼容顶层 userinfo
  return result?.userinfo || result?.data?.userinfo || result?.data || {}
}

export function createUserCache({ workspaceDir, request, logger }) {
  const file = join(workspaceDir, 'users.json')
  let memory = null

  async function load() {
    if (memory) return memory
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'))
      memory = raw && typeof raw === 'object' ? raw : {}
    } catch {
      memory = {}
    }
    return memory
  }

  async function persist(next) {
    memory = next
    try {
      await mkdir(workspaceDir, { recursive: true })
      await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch (error) {
      logger?.(`写 users.json 失败：${error.message}`)
    }
  }

  function shape(uid, info) {
    return {
      uid,
      nickname: String(info.nickname || info.username || '').trim(),
      username: String(info.username || '').trim(),
      avatar: String(info.avatar || info.avatar_url || '').trim(),
      labels: Array.isArray(info.label) ? info.label.map((item) => String(item || '').trim()).filter(Boolean) : [],
      birthday: String(info.birthday || '').trim(),
      deathday: String(info.deathday || '').trim(),
      gender: Number(info.gender || 0) || 0,
      bio: String(info.bio || info.introduction || '').trim(),
      phone: String(info.phone || '').trim(),
    }
  }

  async function get(uid, { force = false } = {}) {
    const safeUid = normalizeUid(uid)
    if (!safeUid) return {}
    const cache = await load()
    const hit = cache[safeUid]
    if (!force && hit && Date.now() < Number(hit.expireAt || 0)) return hit.data || {}

    const request_ = request
    if (!request_) return hit?.data || {}
    try {
      const result = await request_.httpRequest(
        '/get_userinfo',
        { select_type: 'uid', select_value: safeUid },
        { needAccessToken: true },
      )
      if (result.code !== 200) {
        if (result.code === 401 || result.code === 403) return hit?.data || {}
        logger?.(`取 ${safeUid} 的资料失败：${result.message}`)
        return hit?.data || {}
      }
      const info = shape(result.data?.uid ? result.data.uid : safeUid, pickUserinfo(result))
      await persist({ ...cache, [safeUid]: { data: info, expireAt: Date.now() + EXPIRE_MS } })
      return info
    } catch (error) {
      logger?.(`取 ${safeUid} 的资料异常：${error.message}`)
      return hit?.data || {}
    }
  }

  /** 把 uid 统一显示成「昵称」；拿不到就退回 uid。 */
  async function label(uid) {
    const safeUid = normalizeUid(uid)
    if (!safeUid) return ''
    const info = await get(safeUid)
    return info.nickname || info.username || safeUid
  }

  /** 顺手把一批事件里出现的 uid 都换成昵称（事件本身不带作者时用 add_uid/target uid）。 */
  async function warm(uids) {
    const list = [...new Set((Array.isArray(uids) ? uids : []).map(normalizeUid).filter(Boolean))]
    for (const uid of list) await get(uid).catch(() => {})
  }

  return { file, get, label, warm }
}
