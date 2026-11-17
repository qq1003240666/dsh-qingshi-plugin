// 「这条是哪个 AI 工具帮我录的」——写进正文末尾的署名。
//
// 判断顺序：
//   1. 显式配置：config.clientName / QINGSHI_CLIENT_NAME（用户自己指定）
//   2. MCP 客户端在 initialize 里报的 clientInfo.name（claude-code / codex / workbuddy …）
//   3. 宿主探测：在 DSH 里跑 → DeepSeek Harness；独立跑 → AI 助手
// 名字都做人话映射，不把 claude-code 这种 id 直接写进用户的记录里。

const state = { clientName: '', host: '' }

const PRETTY = {
  'claude-code': 'Claude Code',
  'claude': 'Claude',
  'codex': 'Codex',
  'codex-cli': 'Codex',
  'workbuddy': 'WorkBuddy',
  'cursor': 'Cursor',
  'cline': 'Cline',
  'continue': 'Continue',
  'windsurf': 'Windsurf',
  'dsh': 'DeepSeek Harness',
  'deepseek-harness': 'DeepSeek Harness',
  'qingshi-mcp': 'AI 助手',
}

export function setClientInfo(name) {
  state.clientName = String(name || '').trim()
}

export function setHost(host) {
  state.host = String(host || '').trim()
}

function pretty(name) {
  const key = String(name || '').trim().toLowerCase()
  if (!key) return ''
  return PRETTY[key] || key
}

/** 返回「Claude Code」这类人话名字；拿不到就回 'AI 助手'。 */
export function resolveClientLabel(config = {}) {
  const explicit = String(config?.clientName || process.env.QINGSHI_CLIENT_NAME || '').trim()
  if (explicit) return explicit
  const fromMcp = pretty(state.clientName)
  if (fromMcp && fromMcp !== 'AI 助手') return fromMcp
  if (state.host === 'dsh') return 'DeepSeek Harness'
  if (state.clientName) return fromMcp
  return 'AI 助手'
}

/** 「—— 本条由 Claude Code 协助录入」 */
export function attributionText(label) {
  const who = String(label || 'AI 助手').trim() || 'AI 助手'
  return '—— 本条由 ' + who + ' 协助录入'
}

/**
 * 把署名接到正文末尾。已经有了就不重复加（避免「编辑一次加一行」）。
 * separator 默认两个换行，让它在青史详情页里单独成段。
 */
export function appendAttribution(content, label) {
  const body = String(content || '').trimEnd()
  const text = attributionText(label)
  if (!body) return text
  if (body.includes(text)) return body
  // 旧署名（工具名变了）也一并识别：只要末尾已经有一行「—— 本条由 … 协助录入」就替换掉
  const cleaned = body.replace(/\n*——\s*本条由[^\n]*协助录入\s*$/u, '').trimEnd()
  return cleaned + '\n\n' + text
}
