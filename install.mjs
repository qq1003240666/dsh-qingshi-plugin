#!/usr/bin/env node
/**
 * 青史插件 · 本地安装器
 *
 * 用法（在插件根目录）：
 *   node install.mjs                     装进默认 profile（~/.dsh/profiles/desktop）
 *   node install.mjs --profile <dir>     装进指定 profile
 *   node install.mjs --name "我的青史"    改显示名（侧栏/插件列表里看到的名字）
 *   node install.mjs --id my-qingshi     改包 id（node_modules 下的目录名，别带 @ 和 /）
 *   node install.mjs --uninstall         从 profile 卸载（只删 bundle 记录和包目录）
 *   node install.mjs --dry-run           只打印将要做什么
 *
 * 做的事跟 DSH 插件管理器的 install_bundle 等价：
 *   1) 把插件**真实拷贝**到 <profile>/node_modules/<id>（不跳过 node_modules，依赖要一起走）
 *   2) profile/package.json 的 dependencies 记一条
 *   3) profile/package.json 的 dsh.profile.bundles 追加 <id>
 * 装完重启 Harness 才会装载（插件只在启动时加载）。
 */
import { readFile, writeFile, mkdir, cp, access, rm, stat, rename, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = { profile: '', name: '', id: '', uninstall: false, dryRun: false, withElectron: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--uninstall') out.uninstall = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--with-electron') out.withElectron = true
    else if (a === '--no-electron') out.withElectron = false
    else if (a === '--profile') out.profile = argv[++i] || ''
    else if (a.startsWith('--profile=')) out.profile = a.slice(10)
    else if (a === '--name') out.name = argv[++i] || ''
    else if (a.startsWith('--name=')) out.name = a.slice(7)
    else if (a === '--id') out.id = argv[++i] || ''
    else if (a.startsWith('--id=')) out.id = a.slice(5)
  }
  return out
}

const exists = (p) => access(p).then(() => true).catch(() => false)
const say = (...args) => console.log(...args)

/** 把 package.json / cordis.patch.yml / locale 里的包名和显示名替换掉 */
async function applyRename(root, { pkgId, displayName }) {
  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const oldId = pkg.name
  pkg.name = pkgId
  if (displayName) pkg.description = pkg.description || ''
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

  const patchPath = join(root, 'cordis.patch.yml')
  let patch = await readFile(patchPath, 'utf8')
  patch = patch.replace(/(\n\s*- id:\s*)([^\n]+)/, (m, head) => `${head}qingshi`)
  patch = patch.replace(/(\n\s*name:\s*')[^']+(')/, (m, a, b) => `${a}${pkgId}${b}`)
  await writeFile(patchPath, patch)

  if (displayName) {
    for (const loc of ['locale/zh.json', 'locale/en.json']) {
      const p = join(root, loc)
      if (!(await exists(p))) continue
      const data = JSON.parse(await readFile(p, 'utf8'))
      data.meta = data.meta || {}
      data.meta.title = displayName
      await writeFile(p, JSON.stringify(data, null, 2) + '\n')
    }
  }
  return { oldId, newId: pkgId }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const profile = args.profile ? resolve(args.profile) : join(homedir(), '.dsh', 'profiles', 'desktop')
  const srcPkg = JSON.parse(await readFile(join(HERE, 'package.json'), 'utf8'))
  const pkgId = args.id || srcPkg.name
  const displayName = args.name || ''

  if (!(await exists(profile))) {
    say(`✗ profile 不存在：${profile}`)
    say('  先用 Harness 打开一次（或在 --profile 里指定正确目录）')
    process.exit(1)
  }
  const profilePkgPath = join(profile, 'package.json')
  if (!(await exists(profilePkgPath))) {
    say(`✗ ${profilePkgPath} 不存在，这不是一个 DSH profile`)
    process.exit(1)
  }

  const profilePkg = JSON.parse(await readFile(profilePkgPath, 'utf8'))
  profilePkg.dependencies = profilePkg.dependencies || {}
  profilePkg.dsh = profilePkg.dsh || {}
  profilePkg.dsh.profile = profilePkg.dsh.profile || {}
  const bundles = (profilePkg.dsh.profile.bundles = profilePkg.dsh.profile.bundles || [])

  const dest = join(profile, 'node_modules', ...pkgId.split('/'))
  const electronSrc = join(HERE, 'shell', 'node_modules', 'electron', 'dist')
  const hasElectron = await exists(join(electronSrc, 'electron.exe'))
  const wantElectron = args.withElectron === null ? hasElectron : args.withElectron

  if (args.uninstall) {
    say(`卸载 ${pkgId}`)
    say(`  profile : ${profile}`)
    if (!args.dryRun) {
      delete profilePkg.dependencies[pkgId]
      const i = bundles.indexOf(pkgId)
      if (i >= 0) bundles.splice(i, 1)
      await writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n')
      await rm(dest, { recursive: true, force: true })
    }
    say('  ✓ 已从 bundles / dependencies 移除，并删掉包目录（重启生效）')
    return
  }

  say(`安装 ${pkgId}${displayName ? `（显示名：${displayName}）` : ''}`)
  say(`  from    : ${HERE}`)
  say(`  profile : ${profile}`)
  say(`  dest    : ${dest}`)
  say(`  electron: ${wantElectron && hasElectron ? '随包安装（约 230MB）' : '不随包 —— 会退回系统 Chrome/Edge 的 --app 窗口'}`)
  if (args.dryRun) {
    say('  (--dry-run，什么都没做)')
    return
  }

  // 0) 重装会清空目标目录；如果目标里已经装过 Electron 而源里没有，
  //    先把 Electron 挪到临时目录，拷完再放回去（否则窗口会从 electron 掉成 Chrome app）
  const destElectron = join(dest, 'shell', 'node_modules', 'electron')
  let stash = ''
  if (!wantElectron && (await exists(join(destElectron, 'dist', 'electron.exe')))) {
    stash = join(tmpdir(), `qingshi-electron-${Date.now()}`)
    await cp(destElectron, stash, { recursive: true, force: true })
    say('  · 检测到目标里已有 Electron，重装后会保留')
  }

  // 1) 拷贝插件本体（跳过 shell/node_modules：单独处理）
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  await cp(HERE, dest, {
    recursive: true,
    force: true,
    filter: (src) => {
      const rel = src.slice(HERE.length).replace(/\\/g, '/')
      if (rel.startsWith('/.git') || rel.startsWith('/dist') || rel.startsWith('/.tmp')) return false
      if (rel.startsWith('/shell/node_modules')) return false
      if (rel.startsWith('/node_modules')) return false // 依赖由 profile 提供，避免 26MB 冗余
      return true
    },
  })

  // 2) Electron 运行时：有就拷，没有就留空（插件会自动退回 app 模式）
  if (stash) {
    const restoreTo = join(dest, 'shell', 'node_modules', 'electron')
    await mkdir(dirname(restoreTo), { recursive: true })
    await cp(stash, restoreTo, { recursive: true, force: true })
    await rm(stash, { recursive: true, force: true })
    say('  · Electron 运行时已保留（复用上次安装的那份）')
  }

  if (wantElectron && hasElectron) {
    const electronDest = join(dest, 'shell', 'node_modules', 'electron', 'dist')
    await mkdir(electronDest, { recursive: true })
    await cp(electronSrc, electronDest, { recursive: true, force: true })
    say('  · Electron 运行时已写入')
  }

  // 3) 改名（可选）
  const renamed = await applyRename(dest, { pkgId, displayName })

  // 4) 写 profile 清单
  profilePkg.dependencies[pkgId] = `link:${HERE}`
  if (!bundles.includes(pkgId)) bundles.push(pkgId)
  await writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n')

  // 5) 自检
  const checks = {
    'index.js': await exists(join(dest, 'index.js')),
    'cordis.patch.yml': await exists(join(dest, 'cordis.patch.yml')),
    'lib/browser.js': await exists(join(dest, 'lib', 'browser.js')),
    'bundles 里有': (JSON.parse(await readFile(profilePkgPath, 'utf8')).dsh.profile.bundles || []).includes(pkgId),
  }
  say('')
  for (const [k, v] of Object.entries(checks)) say(`  ${v ? '✓' : '✗'} ${k}`)
  const ok = Object.values(checks).every(Boolean)
  say(ok ? '\nINSTALL_OK — 重启 Harness 后生效' : '\nINSTALL_INCOMPLETE')
  if (renamed.oldId !== renamed.newId) say(`（包名 ${renamed.oldId} → ${renamed.newId}）`)
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error('安装失败：', err?.message || err)
  process.exit(1)
})
