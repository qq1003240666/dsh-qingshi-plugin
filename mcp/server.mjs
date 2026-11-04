// 青史 MCP server —— 把插件的 29 个工具暴露成标准 MCP tools，
// 让 Codex / Claude Code / Cursor / Cline / WorkBuddy 等任何 MCP 客户端都能用。
//
// 复用的就是 DSH 插件本身：这里造一个假的 ctx 接住 ctx.tools.register()，
// 工具定义、登录、请求层、族谱自动化全是同一份代码，不存在第二套实现。
import { createInterface } from 'node:readline'

import * as plugin from '../index.js'

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_NAME = 'qingshi'
const SERVER_VERSION = '0.16.0'

function envConfig() {
  const env = process.env
  const number = (value) => (value === undefined || value === '' ? undefined : Number(value))
  const bool = (value) => (value === undefined || value === '' ? undefined : /^(1|true|yes|on)$/i.test(value))
  return {
    apiBaseUrl: env.QINGSHI_API_BASE_URL || undefined,
    webBaseUrl: env.QINGSHI_WEB_BASE_URL || undefined,
    workspaceDir: env.QINGSHI_WORKSPACE || undefined,
    allowFamilyWrite: bool(env.QINGSHI_ALLOW_FAMILY_WRITE),
    autoRecord: env.QINGSHI_AUTO_RECORD || undefined,
    autoOpenBrowser: bool(env.QINGSHI_AUTO_OPEN_BROWSER),
    openLoginWindow: bool(env.QINGSHI_OPEN_LOGIN_WINDOW),
    windowMode: env.QINGSHI_WINDOW_MODE || undefined,
    requestPlatform: env.QINGSHI_REQUEST_PLATFORM || undefined,
    loginTimeoutMs: number(env.QINGSHI_LOGIN_TIMEOUT_MS),
  }
}

// 假宿主：收集工具定义与系统提示词文本
export async function loadTools(config = envConfig()) {
  const tools = new Map()
  const sections = []
  const entries = []
  const ctx = {
    tools: {
      register(spec) {
        entries.push(spec)
        if (spec && spec.name) tools.set(spec.name, spec)
        return spec
      },
      get(name) {
        return tools.get(name)
      },
      restrict() {},
      guard() {},
      schemas() {
        return []
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
      },
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    on() {},
    effect() {},
  }
  await plugin.apply(ctx, config)
  const instructions = sections.map((s) => String(s?.text || '').trim()).filter(Boolean).join('\n\n')
  return { tools, entries, instructions }
}

function toMcpTool(spec) {
  return {
    name: spec.name,
    description: String(spec.description || ''),
    inputSchema: spec.parameters || { type: 'object', properties: {} },
  }
}

function ok(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function fail(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function createServer({ tools, instructions }) {
  async function handle(message) {
    const { id, method, params } = message || {}
    // 通知（没有 id）不需要回复
    const isNotification = id === undefined || id === null

    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: instructions || undefined,
      })
    }
    if (method === 'notifications/initialized' || method === 'initialized') return null
    if (method === 'ping') return ok(id, {})
    if (method === 'tools/list' || method === 'tools/list '.trim()) {
      return ok(id, { tools: [...tools.values()].map(toMcpTool) })
    }
    if (method === 'tools/call') {
      const name = params?.name
      const args = params?.arguments || {}
      if (!name) return fail(id, -32602, 'missing tool name')
      const spec = tools.get(name)
      if (!spec) return fail(id, -32602, `unknown tool: ${name}`)
      try {
        const value = await spec.execute(args, {})
        return ok(id, { content: [{ type: 'text', text: String(value ?? '') }], isError: false })
      } catch (error) {
        const text = error?.message ? String(error.message) : String(error)
        return ok(id, { content: [{ type: 'text', text: `工具执行失败：${text}` }], isError: true })
      }
    }
    if (method === 'resources/list') return ok(id, { resources: [] })
    if (method === 'prompts/list') return ok(id, { prompts: [] })
    if (isNotification) return null
    return fail(id, -32601, `method not found: ${method}`)
  }

  return { handle }
}

// 标准 MCP stdio 传输：一行一条 JSON-RPC 消息
function serveStdio(server, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, crlfDelay: Infinity })
  rl.on('line', async (line) => {
    const text = line.trim()
    if (!text) return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      output.write(JSON.stringify(fail(null, -32700, 'parse error')) + '\n')
      return
    }
    const reply = await server.handle(message)
    if (reply) output.write(JSON.stringify(reply) + '\n')
  })
  return rl
}

const isMain = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
  } catch {
    return false
  }
})()

if (isMain || process.argv[1]?.endsWith('qingshi-mcp.mjs') || process.argv[1]?.endsWith('server.mjs')) {
  const { tools, instructions } = await loadTools()
  serveStdio(createServer({ tools, instructions }))
  process.stderr.write(`qingshi-mcp ready: ${tools.size} tools\n`)
}

export { serveStdio, envConfig }
