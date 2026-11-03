// 青史生涯事件的读写封装：/get_event、/edit_event、/delete_event、
// /get_career_list、/family_tree/get_family_data。
//
// 两个后端特性决定了这里的写法：
//   1) /edit_event 是**整条覆盖**（career/router.py:204 起把
//      title/content/location/start_date/end_date/is_Stage/event_tag/media_list
//      全部用请求体重建），所以必须先读原文档再合并，不能只发要改的字段；
//   2) /delete_event **没有回收站**，删掉就是真删，所以删之前把整条事件写成
//      本地快照存在 <workspace>/trash/ 下。
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const EDITABLE_KEYS = ['title', 'content', 'start_date', 'end_date', 'is_Stage', 'event_tag', 'location', 'media_list']

const FIELD_LABELS = {
  title: '标题',
  content: '正文',
  start_date: '开始时间',
  end_date: '结束时间',
  is_Stage: '阶段事件',
  event_tag: '标签',
  location: '地点',
  media_list: '图片',
}

/** 从后端返回的事件文档里抽出「可回写」的那几个字段。 */
export function editableOf(event) {
  const source = event && typeof event === 'object' ? event : {}
  const location = source.location && typeof source.location === 'object' ? source.location : {}
  const media = Array.isArray(source.media_list) ? source.media_list : []
  return {
    title: String(source.title || ''),
    content: String(source.content || ''),
    start_date: String(source.start_date || ''),
    end_date: String(source.end_date || ''),
    is_Stage: Boolean(source.is_Stage),
    event_tag: String(source.event_tag || 'record') || 'record',
    location: {
      name: String(location.name || ''),
      address: String(location.address || ''),
      latitude: Number(location.latitude) || 0,
      longitude: Number(location.longitude) || 0,
    },
    media_list: media
      .filter((item) => item && String(item.upload_file_id || '').trim() && String(item.url || '').trim())
      .map((item) => ({
        upload_file_id: String(item.upload_file_id || '').trim(),
        url: String(item.url || '').trim(),
        content_type: String(item.content_type || '').trim().toLowerCase(),
      })),
  }
}

/** 把调用方给的 patch（驼峰或下划线都认）合到基线字段上。 */
function mergePatch(base, patch = {}) {
  const next = { ...base, location: { ...base.location }, media_list: [...base.media_list] }
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined
  if (has('title')) next.title = String(patch.title || '').trim()
  if (has('content')) next.content = String(patch.content || '')
  if (has('startDate') || has('start_date')) next.start_date = String(patch.startDate ?? patch.start_date ?? '').trim()
  if (has('endDate') || has('end_date')) next.end_date = String(patch.endDate ?? patch.end_date ?? '').trim()
  if (has('isStage') || has('is_Stage')) next.is_Stage = Boolean(patch.isStage ?? patch.is_Stage)
  if (has('eventTag') || has('event_tag')) next.event_tag = String(patch.eventTag ?? patch.event_tag ?? 'record').trim() || 'record'
  if (has('location') && patch.location && typeof patch.location === 'object') {
    next.location = {
      name: String(patch.location.name || '').trim(),
      address: String(patch.location.address || '').trim(),
      latitude: Number(patch.location.latitude) || 0,
      longitude: Number(patch.location.longitude) || 0,
    }
  }
  if (has('mediaList') || has('media_list')) {
    const list = patch.mediaList ?? patch.media_list
    next.media_list = Array.isArray(list)
      ? list
          .filter((item) => item && String(item.upload_file_id || '').trim())
          .map((item) => ({
            upload_file_id: String(item.upload_file_id || '').trim(),
            url: String(item.url || '').trim(),
            content_type: String(item.content_type || '').trim().toLowerCase(),
          }))
      : []
  }
  // 阶段事件必须有结束时间，取消阶段就把结束时间一起清掉，避免留下脏数据
  if (!next.is_Stage) next.end_date = next.end_date || ''
  return next
}

/** 只比较可回写字段，用来告诉用户「到底改了什么」。 */
function diffOf(before, after) {
  const changed = []
  for (const key of EDITABLE_KEYS) {
    const a = JSON.stringify(before[key])
    const b = JSON.stringify(after[key])
    if (a !== b) changed.push(key)
  }
  return changed
}

const isEmptyValue = (key, value) => {
  if (key === 'location') return !value || (!value.name && !value.address)
  if (key === 'media_list') return !Array.isArray(value) || value.length === 0
  if (key === 'is_Stage') return !value
  return !String(value ?? '').trim()
}

const showValue = (key, value) => {
  if (key === 'location') {
    if (!value || (!value.name && !value.address)) return '（无）'
    const coords = value.latitude || value.longitude ? ` ${value.latitude},${value.longitude}` : ''
    return `${value.name || ''}${value.address && value.address !== value.name ? `（${value.address}）` : ''}${coords}`.trim()
  }
  if (key === 'media_list') return value?.length ? `${value.length} 张图` : '（无图）'
  if (key === 'is_Stage') return value ? '是' : '否'
  return String(value ?? '').trim() || '（空）'
}

// 生涯事件的可见性：存在 career_timeline.event_list[i].privacy_setting
// all = 所有人可见；private = 仅自己可见；selected = 指定人可见（designated_uid 存名单）
export const PRIVACY_VALUES = { all: '所有人可见', private: '仅自己可见', selected: '指定人可见' }

export function createCareerApi({ authed, workspaceDir, logger }) {
  const trashDir = join(workspaceDir, 'trash')

  async function getEvent(eventId) {
    const id = String(eventId || '').trim()
    if (!id) return { ok: false, code: 400, message: '缺少 eventId' }
    const result = await authed('/get_event', { event_id: id })
    if (result.code !== 200) return { ok: false, code: result.code, message: result.message || '查询事件失败' }
    const event = result.event_data || result.data?.event_data || result.data || null
    if (!event || !event.event_id) return { ok: false, code: 404, message: '事件不存在' }
    return { ok: true, code: 200, event }
  }

  async function listEvents(targetUid, { previewLimit = 200 } = {}) {
    const uid = String(targetUid || '').trim()
    if (!uid) return { ok: false, code: 400, message: '缺少 uid' }
    const result = await authed('/get_career_list', {
      of_type: 'user',
      of_id: uid,
      content_preview_limit: previewLimit,
    })
    if (result.code !== 200) return { ok: false, code: result.code, message: result.message || '查询生涯列表失败' }
    const raw = result.event_list || result.career_list || []
    return {
      ok: true,
      code: 200,
      events: Array.isArray(raw) ? raw : [],
      access: result.career_access || 'owner',
      message: result.message || '',
    }
  }

  async function updateEvent(eventId, patch = {}, { dryRun = false } = {}) {
    const found = await getEvent(eventId)
    if (!found.ok) return found
    const before = editableOf(found.event)
    const after = mergePatch(before, patch)
    const changed = diffOf(before, after)
    if (changed.length === 0) {
      return { ok: false, code: 0, message: '没有要改的字段（patch 与现有内容一致）', before, after, changed }
    }
    const missing = ['title', 'start_date'].filter((key) => isEmptyValue(key, after[key]))
    if (missing.length) {
      return {
        ok: false,
        code: 400,
        message: '改完之后「' + missing.map((key) => FIELD_LABELS[key]).join('、') + '」会变成空，后端不允许',
        before,
        after,
        changed,
      }
    }
    if (dryRun) return { ok: true, code: 200, dryRun: true, before, after, changed, eventId }

    const payload = { event_id: String(eventId).trim(), ...after }
    const result = await authed('/edit_event', payload)
    if (result.code !== 200) {
      return { ok: false, code: result.code, message: result.message || '修改事件失败', before, after, changed }
    }
    const latest = result.event_data || result.data?.event_data || after
    logger?.('edit_event ok ' + eventId + ' changed=' + changed.join(','))
    return { ok: true, code: 200, before, after, event: latest, changed, eventId }
  }

  async function snapshotEvent(event) {
    await mkdir(trashDir, { recursive: true })
    const safeId = String(event.event_id || 'event').replace(/[^\w.-]/g, '_')
    const file = join(trashDir, safeId + '.json')
    await writeFile(
      file,
      JSON.stringify({ deletedAt: new Date().toISOString(), event }, null, 2),
      'utf8',
    )
    return file
  }

  async function deleteEvent(eventId) {
    const found = await getEvent(eventId)
    if (!found.ok) return found
    const file = await snapshotEvent(found.event)
    const result = await authed('/delete_event', { event_id: String(eventId).trim() })
    if (result.code !== 200) {
      return { ok: false, code: result.code, message: result.message || '删除事件失败', snapshot: file }
    }
    logger?.('delete_event ok ' + eventId + ' snapshot=' + file)
    return { ok: true, code: 200, event: found.event, snapshot: file }
  }

  async function listTrash() {
    try {
      const names = await readdir(trashDir)
      const rows = []
      for (const name of names.filter((item) => item.endsWith('.json'))) {
        try {
          const text = await readFile(join(trashDir, name), 'utf8')
          const parsed = JSON.parse(text)
          rows.push({ file: join(trashDir, name), deletedAt: parsed.deletedAt, event: parsed.event || {} })
        } catch {
          // 坏文件跳过，不影响其它快照
        }
      }
      rows.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
      return { ok: true, rows, dir: trashDir }
    } catch {
      return { ok: true, rows: [], dir: trashDir }
    }
  }

  async function dropTrashFile(file) {
    try {
      await unlink(file)
      return true
    } catch {
      return false
    }
  }

  async function familyLayer({ uid, type = 'parent', displaySiblings = true }) {
    const result = await authed('/family_tree/get_family_data', {
      select_uid: String(uid || '').trim(),
      select_family_type: type === 'child' ? 'child' : 'parent',
      display_siblings: Boolean(displaySiblings),
    })
    if (result.code !== 200) {
      return { ok: false, code: result.code, message: result.message || '查询族谱失败' }
    }
    // 真实结构是 { code, message, data: { family_data: { man, woman, childs }, child_family_count } }
    // 节点上只有 { uid, appellation, current_distance, relation_chain, of_direction }，昵称要另查。
    const payload = result.data && typeof result.data === 'object' ? result.data : {}
    const layer = payload.family_data && typeof payload.family_data === 'object' ? payload.family_data : payload
    return {
      ok: true,
      code: 200,
      layer,
      childFamilyCount: Number(payload.child_family_count || 0) || 0,
      message: result.message || '',
    }
  }

  /**
   * 改某条生涯事件的可见性。
   * 后端只提供了单独的接口：POST /edit_career_event_privacy_setting
   * （/add_event 与 /edit_event 都不带这个字段）
   */
  async function setPrivacy(eventId, privacy, { designatedUids = [] } = {}) {
    const id = String(eventId || '').trim()
    if (!id) return { ok: false, code: 400, message: '缺少 eventId' }
    const value = String(privacy || '').trim()
    if (!PRIVACY_VALUES[value]) {
      return { ok: false, code: 400, message: 'privacy 只能是 all / private / selected' }
    }
    if (value === 'selected') {
      const list = (Array.isArray(designatedUids) ? designatedUids : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      if (list.length === 0) return { ok: false, code: 400, message: '指定人可见需要给 designatedUids' }
    }
    const body = { event_id: id, privacy_setting: value }
    if (value === 'selected') {
      body.designated_uid = (designatedUids || []).map((item) => String(item).trim()).filter(Boolean)
    }
    const result = await authed('/edit_career_event_privacy_setting', body)
    if (result.code !== 200) {
      return { ok: false, code: result.code, message: result.message || '设置可见性失败' }
    }
    return { ok: true, code: 200, eventId: id, privacy: value, label: PRIVACY_VALUES[value] }
  }

  return {
    getEvent,
    setPrivacy,
    listEvents,
    updateEvent,
    deleteEvent,
    listTrash,
    dropTrashFile,
    familyLayer,
    trashDir,
  }
}
