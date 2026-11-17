#!/usr/bin/env node
// 冒烟测试：不联网、不碰用户数据，只验证插件能被加载、工具表形状正确。
// 用法：npm test（或 node test/smoke.mjs）

const TOOL_NAMES = [
  'qingshi_login', 'qingshi_save_login', 'qingshi_me', 'qingshi_search', 'qingshi_about_me', 'qingshi_where',
  'qingshi_find_experience', 'qingshi_record', 'qingshi_profile', 'qingshi_set_privacy', 'qingshi_tags',
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

check('工具数量 32', registered.size === 32, '实际 ' + registered.size)
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

// 标签清单：不登录也能查，必须给出 24 个 canonical 标签
const tagsTool = registered.get('qingshi_tags')
const tagsOut = await tagsTool.execute({}, {})
check('qingshi_tags 不登录也能用', typeof tagsOut === 'string' && tagsOut.length > 200, String(tagsOut).slice(0, 60))
for (const tag of ['record', 'work', 'travel', 'turning']) {
  check('标签清单含 ' + tag, tagsOut.includes('(' + tag + ')'), tag)
}
check('标签清单提到旧写法', /spending|turning_point/.test(tagsOut), '')
check('标签清单是 24 个', (tagsOut.match(/·\s/g) || []).length === 24, String((tagsOut.match(/·\s/g) || []).length))

// 写入闸门：不传 confirm 只给预览，不能真的写云端
const recordTool = registered.get('qingshi_record')
const preview = await recordTool.execute({ title: '测试标题', content: '测试正文', eventTag: 'work' }, {})
check('record 无 confirm 只给预览', /还没写进云端/.test(preview), String(preview).slice(0, 80))
check('预览里有标题', preview.includes('测试标题'), '')
check('预览里有标签中文名', /工作\(work\)/.test(preview), '')
check('预览会问图片和地址', /图片/.test(preview) && /地址/.test(preview), '')
check('预览说明默认可见性', /所有人可见/.test(preview), '')

if (fails.length) {
  console.error('FAILED ' + fails.length + ' / ' + (pass + fails.length))
  for (const f of fails) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('OK ' + pass + ' checks passed')
