// 复刻青史小程序端的 OSS 三段式上传：
//   1. POST /get_oss_upload_signature  → { host, object_key, upload_file_id, form_data }
//   2. multipart POST 到 host（form_data + file）→ 200
//   3. POST /confirm_oss_upload { upload_file_id, object_key } → { url }
// 只有第 3 步之后 upload_files 记录才会变成 active，/add_event 的 media_list 才认。
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

export function createUploader({ logger } = {}) {
  // authed 由 index.js 传进来，避免这里再碰 token
  return async function uploadMedia(authed, filePath, { uid, contentType } = {}) {
    const raw = await readFile(filePath)
    const fileName = basename(filePath) || 'image.jpg'
    const type = contentType || guessType(fileName)

    const sign = await authed('/get_oss_upload_signature', {
      biz_type: 'career_media',
      of_uid: uid,
      target_type: 'user_profile',
      file_name: fileName,
      file_size: raw.length,
      content_type: type,
    })
    if (sign.code !== 200) {
      throw new Error(`申请上传签名失败：${sign.code} ${sign.message || ''}`)
    }

    const data = sign.data || {}
    const host = String(data.host || '').replace(/\/+$/, '')
    if (!host) throw new Error('上传签名里没有 host')

    const form = new FormData()
    for (const [key, value] of Object.entries(data.form_data || {})) {
      form.append(key, String(value))
    }
    form.append('file', new Blob([raw], { type }), fileName)

    const putResponse = await fetch(host, { method: 'POST', body: form })
    if (!putResponse.ok) {
      const text = await putResponse.text().catch(() => '')
      throw new Error(`上传到 OSS 失败：${putResponse.status} ${text.slice(0, 200)}`)
    }

    const confirmed = await authed('/confirm_oss_upload', {
      upload_file_id: data.upload_file_id,
      object_key: data.object_key,
    })
    if (confirmed.code !== 200) {
      throw new Error(`确认上传失败：${confirmed.code} ${confirmed.message || ''}`)
    }

    const info = confirmed.data || {}
    logger?.(`媒体上传完成 ${data.upload_file_id} → ${info.url}`)
    return {
      upload_file_id: data.upload_file_id,
      url: String(info.url || data.public_url || ''),
      content_type: type,
    }
  }
}

function guessType(fileName) {
  const ext = String(fileName).toLowerCase().split('.').pop()
  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      heic: 'image/heic',
    }[ext] || 'application/octet-stream'
  )
}
