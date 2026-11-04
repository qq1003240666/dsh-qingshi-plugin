// MCP 层自检：不联网、不弹窗，只验证协议与工具暴露是否正常。
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createServer, loadTools } from '../mcp/server.mjs'

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) {
    pass += 1
    console.log('  ok   ' + name)
  } else {
    fail += 1
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''))
  }
}

const workspaceDir = await mkdtemp(join(tmpdir(), 'qingshi-mcp-test-'))
const { tools, instructions } = await loadTools({
  workspaceDir,
  openLoginWindow: false,
  autoOpenBrowser: false,
  allowFamilyWrite: false,
})
const server = createServer({ tools, instructions })

console.log('— 协议')
const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
check('initialize 有 protocolVersion', init.result?.protocolVersion === '2024-11-05', init.result?.protocolVersion)
check('serverInfo 名字是 qingshi', init.result?.serverInfo?.name === 'qingshi', JSON.stringify(init.result?.serverInfo))
check('暴露 instructions', typeof init.result?.instructions === 'string' && init.result.instructions.length > 500, String(init.result?.instructions?.length))
check('capabilities 声明 tools', Boolean(init.result?.capabilities?.tools))

const notified = await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })
check('通知不回复', notified === null)

const pinged = await server.handle({ jsonrpc: '2.0', id: 99, method: 'ping' })
check('ping 有 result', pinged?.id === 99 && 'result' in (pinged || {}))

console.log('— 工具清单')
const list = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
const items = list.result?.tools || []
check('31 个工具', items.length === 31, String(items.length))
check('每个都有 name/description/inputSchema', items.every((t) => t.name && t.description && t.inputSchema))
check('inputSchema 是 object', items.every((t) => t.inputSchema?.type === 'object'))
check('qingshi_kinship 有 term 参数', Boolean(items.find((t) => t.name === 'qingshi_kinship')?.inputSchema?.properties?.term))
check('没有把 token 做成参数', items.every((t) => !('accessToken' in (t.inputSchema?.properties || {}))), '')
check('没有 uri/路由泄漏进名字', items.every((t) => !t.name.includes('/')))

console.log('— 调用')
const unknown = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } })
check('未知工具返回 -32602', unknown?.error?.code === -32602, JSON.stringify(unknown?.error))

const me = await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'qingshi_me', arguments: {} } })
const meText = me.result?.content?.[0]?.text || ''
check('qingshi_me 未登录不抛异常', me.result?.isError === false, meText.slice(0, 60))
check('qingshi_me 提示要登录', /登录/.test(meText), meText.slice(0, 60))

console.log('— 无窗口登录（短信验证码）')
const badPhone = await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'qingshi_login', arguments: { phone: '123' } } })
check('手机号格式错误会拦下来', /手机号看着不太对/.test(badPhone.result?.content?.[0]?.text || ''), (badPhone.result?.content?.[0]?.text || '').slice(0, 40))

const codeOnly = await server.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'qingshi_login', arguments: { code: '123456' } } })
check('没发码就交码会提示先发码', /先用手机号发一次验证码/.test(codeOnly.result?.content?.[0]?.text || ''), (codeOnly.result?.content?.[0]?.text || '').slice(0, 40))

const noArgs = await server.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'qingshi_login', arguments: {} } })
const noArgsText = noArgs.result?.content?.[0]?.text || ''
check('无窗口时不弹窗、改说短信流程', /没有可用的窗口/.test(noArgsText) && /phone/.test(noArgsText), noArgsText.slice(0, 60))

const bad = await server.handle({ jsonrpc: '2.0', id: 5, method: 'nope/nope' })
check('未知方法返回 -32601', bad?.error?.code === -32601, JSON.stringify(bad?.error))

console.log('— inputSchema 必须是合法 JSON Schema（客户端会严格校验）')
const badType = items.filter((t) => t.inputSchema?.type !== 'object')
check('每个工具 inputSchema.type 都显式是 object', badType.length === 0, badType.map((t) => t.name + ':' + JSON.stringify(t.inputSchema?.type)).join(','))
const badProps = items.filter((t) => !t.inputSchema?.properties || typeof t.inputSchema.properties !== 'object' || Array.isArray(t.inputSchema.properties))
check('每个工具都有 properties 对象', badProps.length === 0, badProps.map((t) => t.name).join(','))
const badReq = items.filter((t) => t.inputSchema?.required !== undefined && (!Array.isArray(t.inputSchema.required) || t.inputSchema.required.some((n) => !t.inputSchema.properties[n])))
check('required 是数组且都在 properties 里', badReq.length === 0, badReq.map((t) => t.name).join(','))
const evTool = items.find((t) => t.name === 'qingshi_event')
check('qingshi_event 把 eventId 标成必填', Array.isArray(evTool?.inputSchema?.required) && evTool.inputSchema.required.includes('eventId'), JSON.stringify(evTool?.inputSchema?.required))
const loginTool = items.find((t) => t.name === 'qingshi_login')
check('qingshi_login 的 phone/code 都在 properties 里',
  Boolean(loginTool?.inputSchema?.properties?.phone) && Boolean(loginTool?.inputSchema?.properties?.code),
  Object.keys(loginTool?.inputSchema?.properties || {}).join(','))
check('qingshi_login 的 phone 声明成 string', loginTool?.inputSchema?.properties?.phone?.type === 'string')
const arrTool = items.filter((t) => Object.values(t.inputSchema?.properties || {}).some((p) => p?.type === 'array'))
check('数组参数带 items', arrTool.every((t) => Object.values(t.inputSchema.properties).every((p) => p?.type !== 'array' || p.items !== undefined)), String(arrTool.length))

console.log('— 工具元信息')
check('工具名都以 qingshi_ 开头', items.every((t) => t.name.startsWith('qingshi_')))
// 描述里可以出现「别把 uid 说给用户」这种话，但不能出现真实的 id / 事件号
check('描述里没有真实 uid 数字', items.every((t) => !/[0-9]{10,}/.test(t.description)), '')
check('描述里没有 event_id', items.every((t) => !/event_[0-9]/.test(t.description)), '')
check('描述里没有 JWT', items.every((t) => !/eyJ[A-Za-z0-9_-]{10,}/.test(t.description)), '')

console.log('')
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
