// 对应青史小程序端 utils/platform.js 与 utils/format.js 的两个纯函数。
//
// 这两份东西在插件里的作用不一样：
//   - detectClientPlatform() 决定请求头 X-Client-Platform 的值。小程序端按编译平台返回
//     mp-weixin / mp-toutiao / app-plus / h5；插件是「插件」这个第四种客户端，
//     所以默认 'plugin'，可以用 QINGSHI_REQUEST_PLATFORM 覆盖（比如拆成 plugin-a / plugin-b）。
//   - formatDate / formatDateTime / formatFileSize 是纯字符串处理，直接照搬，避免各处各写一遍。

/** 对应 utils/platform.js detectClientPlatform()：插件默认 platform，可覆盖。 */
export function detectClientPlatform(override = '') {
  const text = String(override || process.env.QINGSHI_REQUEST_PLATFORM || '').trim()
  return text || 'plugin'
}

/** 对应 utils/format.js formatDate()：取 YYYY-MM-DD。 */
export function formatDate(dateStr) {
  if (!dateStr) return ''
  return String(dateStr).slice(0, 10)
}

/** 对应 utils/format.js formatDateTime()：取 YYYY-MM-DD HH:MM。 */
export function formatDateTime(dateValue) {
  if (!dateValue) return ''
  return String(dateValue).slice(0, 16)
}

/** 对应 utils/format.js formatFileSize()：字节数转 KB / MB。 */
export function formatFileSize(size) {
  const n = Number(size) || 0
  if (!n) return '0B'
  const kb = n / 1024
  if (kb < 1024) return kb.toFixed(1) + 'KB'
  return (kb / 1024).toFixed(2) + 'MB'
}
