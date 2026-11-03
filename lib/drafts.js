// 本地草稿箱：先落在自己机器上，之后再挑几条发到云端。
//
//   <workspaceDir>/drafts.json          草稿本身（数组）
//   <workspaceDir>/media/<draftId>/…    草稿带的图片（原始文件，发布时才上传 OSS）
//
// 草稿永远是本地的一份拷贝：发布成功后只多记一个 eventId 和 publishedAt，不删草稿。
import { mkdir, readFile, writeFile, rm, stat, copyFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'

const DRAFT_FILE = 'drafts.json'
const MEDIA_DIR = 'media'

const IMAGE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
}

export const guessContentType = (fileName) =>
  IMAGE_TYPES[extname(String(fileName || '')).toLowerCase()] || ''

const pad = (n) => String(n).padStart(2, '0')

// 只保留年月日时分：青史后端 start_date 是 'YYYY-MM-DD' 或带时间的文本，够用即可
export function normalizeDateTime(value, fallback = '') {
  const text = String(value || '').trim()
  if (!text) return fallback
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return fallback
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function todayText() {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function normalizeDraft(input = {}, previous = null) {
  const now = new Date().toISOString()
  const location = input.location && typeof input.location === 'object' ? input.location : {}
  const lat = Number(location.latitude) || 0
  const lng = Number(location.longitude) || 0
  const name = String(location.name || '').trim()
  const address = String(location.address || '').trim()

  return {
    id: previous?.id || String(input.id || '').trim() || `d_${randomUUID().slice(0, 8)}`,
    title: String(input.title ?? previous?.title ?? '').trim(),
    content: String(input.content ?? previous?.content ?? '').trim(),
    startDate: normalizeDateTime(input.startDate ?? previous?.startDate, todayText()),
    endDate: normalizeDateTime(input.endDate ?? previous?.endDate, ''),
    isStage: Boolean(input.isStage ?? previous?.isStage ?? false),
    eventTag: String(input.eventTag ?? previous?.eventTag ?? 'record').trim() || 'record',
    location: name || address ? { name, address, latitude: lat, longitude: lng } : {},
    media: Array.isArray(input.media ?? previous?.media) ? (input.media ?? previous?.media) : [],
    targetUid: String(input.targetUid ?? previous?.targetUid ?? '').trim(),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    status: previous?.status === 'published' ? 'published' : 'draft',
    eventId: previous?.eventId || '',
    publishedAt: previous?.publishedAt || '',
  }
}

export function createDraftStore(workspaceDir) {
  const file = join(workspaceDir, DRAFT_FILE)
  const mediaRoot = join(workspaceDir, MEDIA_DIR)

  async function readAll() {
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  async function writeAll(list) {
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(file, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 })
    return list
  }

  return {
    file,
    mediaRoot,

    async list() {
      const all = await readAll()
      // 新的在前
      return all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    },

    async get(id) {
      const all = await readAll()
      return all.find((item) => item.id === id) || null
    },

    async save(input) {
      const all = await readAll()
      const index = input?.id ? all.findIndex((item) => item.id === input.id) : -1
      const previous = index >= 0 ? all[index] : null
      const draft = normalizeDraft(input, previous)
      // 已发布的草稿不允许被改回 draft，避免重复发布
      if (previous?.status === 'published') {
        draft.status = 'published'
        draft.eventId = previous.eventId
        draft.publishedAt = previous.publishedAt
      }
      if (index >= 0) all[index] = draft
      else all.push(draft)
      await writeAll(all)
      return draft
    },

    async remove(id) {
      const all = await readAll()
      const next = all.filter((item) => item.id !== id)
      await writeAll(next)
      await rm(join(mediaRoot, id), { recursive: true, force: true })
      return all.length !== next.length
    },

    async markPublished(id, eventId) {
      const all = await readAll()
      const index = all.findIndex((item) => item.id === id)
      if (index < 0) return null
      all[index] = {
        ...all[index],
        status: 'published',
        eventId,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await writeAll(all)
      return all[index]
    },

    // 图片先落在本地草稿目录，发布时再上传到 OSS
    async addMedia(draftId, fileName, buffer) {
      const safeName = basename(String(fileName || 'image')).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
      const dir = join(mediaRoot, draftId)
      await mkdir(dir, { recursive: true })
      const stamped = `${Date.now()}_${safeName}`
      const target = join(dir, stamped)
      await writeFile(target, buffer)
      return {
        file: target,
        name: safeName,
        storedName: stamped,
        contentType: guessContentType(safeName),
        size: buffer.length,
      }
    },

    async mediaPath(draftId, storedName) {
      const target = join(mediaRoot, draftId, basename(String(storedName || '')))
      const info = await stat(target).catch(() => null)
      return info?.isFile() ? target : null
    },

    async importMedia(draftId, sourcePath) {
      const dir = join(mediaRoot, draftId)
      await mkdir(dir, { recursive: true })
      const safeName = basename(String(sourcePath || 'image'))
      const target = join(dir, `${Date.now()}_${safeName}`)
      await copyFile(sourcePath, target)
      return { file: target, name: safeName, storedName: basename(target), contentType: guessContentType(safeName), size: 0 }
    },
  }
}

