#!/usr/bin/env node
// 冒烟测试：不联网、不碰用户数据，只验证插件能被加载、工具表形状正确。
// 用法：npm test（或 node test/smoke.mjs）

const TOOL_NAMES = [
  'qingshi_login', 'qingshi_save_login', 'qingshi_me', 'qingshi_search', 'qingshi_about_me', 'qingshi_where',
  'qingshi_find_experience', 'qingshi_record', 'qingshi_profile', 'qingshi_set_privacy',
  'qingshi_draft', 'qingshi_publish', 'qingshi_ui_read', 'qingshi_ui_goto',
  'qingshi_ui_click', 'qingshi_ui_type', 'qingshi_ui_tap', 'qingshi_ui_shot',
  'qingshi_pages', 'qingshi_event', 'qingshi_edit', 'qingshi_delete',
  'qingshi_restore', 'qingshi_family', 'qingshi_kinship', 'qingshi_open_event',
  'qingshi_prepare_event', 'qingshi_family_expand', 'qingshi_family_layout',
  'qingshi_logout', 'qingshi_open_h5',
]

let pass = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass += 1; return }
  fails.push(name + (detail ? ' — ' + detail : ''))
}

const registered = new Map()
const ctx = {
  tools: { register: (tool) => registered.set(tool.name, tool), get: (n) => registered.get(n) },
  systemPrompt: { section: () => {} },
  effect: () => {},
  on: () => {},
  logger: { info() {}, warn() {}, error() {} },
}

const mod = await import('../index.js')
check('导出 apply', typeof mod.apply === 'function')
check('导出 inject', Array.isArray(mod.inject) && mod.inject.includes('tools'), JSON.stringify(mod.inject))

await mod.apply(ctx, { openLoginWindow: false, autoOpenBrowser: false, workspaceDir: process.env.QINGSHI_TEST_WORKSPACE || './.tmp-test-workspace' })

check('工具数量 31', registered.size === 31, '实际 ' + registered.size)
for (const name of TOOL_NAMES) check('注册 ' + name, registered.has(name))

for (const [name, tool] of registered) {
  check(name + ' 有 description', typeof tool.description === 'string' && tool.description.length > 10, '')
  check(name + ' 有 execute', typeof tool.execute === 'function', '')
  check(name + ' 有 parameters', !!tool.parameters && typeof tool.parameters === 'object', '')
}

// 未登录时数据类工具必须给出可读提示，而不是抛异常
for (const name of ['qingshi_me', 'qingshi_search', 'qingshi_family']) {
  const tool = registered.get(name)
  let out
  try { out = await tool.execute({}, {}) } catch (e) { out = 'THREW: ' + e.message }
  check(name + ' 未登录不抛异常', !String(out).startsWith('THREW'), String(out).slice(0, 120))
  check(name + ' 未登录有可读提示', typeof out === 'string' && /登录/.test(out), String(out).slice(0, 120))
}

// 登录闸门：没凭证时只解释原因、等用户点头，不许自动弹窗
const meTool = registered.get('qingshi_me')
const meOut = await meTool.execute({}, {})
check('未登录文案说明原因', /还没有青史的登录凭证|身份认证已过期/.test(meOut), String(meOut).slice(0, 60))
check('未登录文案会征求同意', /要我现在打开登录窗吗|把手机号发我/.test(meOut), String(meOut).slice(0, 60))
check('未登录不再宣称自动弹窗', !/会弹一个小登录窗/.test(meOut), String(meOut).slice(0, 60))

if (fails.length) {
  console.error('FAILED ' + fails.length + ' / ' + (pass + fails.length))
  for (const f of fails) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('OK ' + pass + ' checks passed')
