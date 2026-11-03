#!/usr/bin/env node
// 独立启动器：不依赖插件是否被 DSH 装载，直接用自带 Electron 外壳打开青史窗口。
// 用法：node bin/open.mjs [route]
//   route 形如 /pages/career/career（默认生涯页）
import { launchShell } from '../lib/electron-shell.js'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '..')
// route 可能被 MSYS/Git-Bash 的路径转换搞坏（/pages/x → C:/.../pages/x），
// 所以只从里面截出 /pages/... 这一段。
const rawRoute = process.env.QINGSHI_ROUTE || process.argv[2] || ''
const at = rawRoute.indexOf('/pages/')
const route = at >= 0 ? rawRoute.slice(at) : rawRoute || '/pages/career/career'
const webBase = process.env.QINGSHI_WEB_BASE || 'https://qingshi.iyouwc.cn'
const url = `${webBase}/#${route}`

// profile 必须落在「可写」的地方：优先会话工作区
const workspace = process.env.DSH_WORKSPACE || resolve(pluginRoot, '..', '..')
const profileDir = process.env.QINGSHI_PROFILE || join(workspace, '.qingshi-electron-profile')

const res = await launchShell({
  url,
  width: 1180,
  height: 880,
  userDataDir: profileDir,
  logger: (m) => console.log('[qingshi]', m),
})
console.log(JSON.stringify({ ok: true, url, profileDir, ...res }))
process.exit(0)
