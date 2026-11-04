// 数据目录必须「一台机器一份」，且和宿主无关。
// 这组断言守住三件事：默认位置按平台固定、显式配置能覆盖、老数据会搬过来且不覆盖新数据。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, platform } from 'node:os'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  ← ' + detail))
}

const { defaultHomeDir, resolveHomeDir, legacyDirs, migrateLegacy, APP_DIR_NAME } = await import('../lib/paths.js')

console.log('— 默认位置')
const home = defaultHomeDir()
check('目录名是 qingshi', home.endsWith(APP_DIR_NAME), home)
if (platform() === 'win32') {
  check('Windows 落在 %APPDATA% 下', /AppData[\\/]Roaming[\\/]qingshi$/i.test(home), home)
} else if (platform() === 'darwin') {
  check('macOS 落在 Application Support', home.includes('Library/Application Support'), home)
} else {
  check('Linux 落在 XDG 配置目录', home.includes('.config') || home.includes(process.env.XDG_CONFIG_HOME || '\u0000'), home)
}
check('默认目录是绝对路径', /^([a-zA-Z]:[\\/]|\/)/.test(home), home)

console.log('— 覆盖顺序')
check('显式 workspaceDir 优先', resolveHomeDir({ workspaceDir: join(tmpdir(), 'qh-x') }) === join(tmpdir(), 'qh-x'))
const prev = process.env.QINGSHI_HOME
process.env.QINGSHI_HOME = join(tmpdir(), 'qh-env')
check('QINGSHI_HOME 次之', resolveHomeDir({}) === join(tmpdir(), 'qh-env'))
check('显式仍高于 QINGSHI_HOME', resolveHomeDir({ workspaceDir: join(tmpdir(), 'qh-y') }) !== join(tmpdir(), 'qh-env'))
if (prev === undefined) delete process.env.QINGSHI_HOME
else process.env.QINGSHI_HOME = prev

console.log('— 迁移老数据')
const sandbox = mkdtempSync(join(tmpdir(), 'qh-mig-'))
const legacy = join(sandbox, 'legacy')
const target = join(sandbox, 'target')
mkdirSync(join(legacy, 'media', 'd1'), { recursive: true })
writeFileSync(join(legacy, 'auth.json'), JSON.stringify({ uid: 'u1', accessToken: 'at' }))
writeFileSync(join(legacy, 'drafts.json'), '[]')
writeFileSync(join(legacy, 'media', 'd1', 'a.txt'), 'hi')
mkdirSync(join(legacy, 'shots'), { recursive: true })
writeFileSync(join(legacy, 'shots', 'x.png'), 'png')

const prevDsh = process.env.DSH_HOME
process.env.DSH_HOME = sandbox
// legacyDirs 里第一项就是 $DSH_HOME/qingshi-workspace
mkdirSync(join(sandbox, 'qingshi-workspace'), { recursive: true })
for (const f of ['auth.json', 'drafts.json']) {
  writeFileSync(join(sandbox, 'qingshi-workspace', f), readFileSync(join(legacy, f)))
}
mkdirSync(join(sandbox, 'qingshi-workspace', 'media', 'd1'), { recursive: true })
writeFileSync(join(sandbox, 'qingshi-workspace', 'media', 'd1', 'a.txt'), 'hi')

const moved = migrateLegacy(target)
check('搬来了 auth.json', existsSync(join(target, 'auth.json')), moved.join(','))
check('搬来了 drafts.json', existsSync(join(target, 'drafts.json')))
check('搬来了 media/', existsSync(join(target, 'media', 'd1', 'a.txt')))
check('没搬体积大的 shots/', !existsSync(join(target, 'shots')), 'shots 不该被搬')
check('内容一致', JSON.parse(readFileSync(join(target, 'auth.json'), 'utf8')).uid === 'u1')

writeFileSync(join(target, 'auth.json'), JSON.stringify({ uid: 'newer' }))
migrateLegacy(target)
check('已有文件不会被老数据覆盖', JSON.parse(readFileSync(join(target, 'auth.json'), 'utf8')).uid === 'newer')

// ---- 目录不可写时的回退（其他 AI 客户端常把用户目录锁住）----
{
  const { pickHomeDir, isWritableDir, cwdFallbackDir } = await import('../lib/paths.js')
  const prevAppData = process.env.APPDATA
  const prevHome = process.env.QINGSHI_HOME
  const prevWs = process.env.QINGSHI_WORKSPACE
  delete process.env.QINGSHI_HOME
  delete process.env.QINGSHI_WORKSPACE

  // 把 APPDATA 指到一个「父级是文件」的路径，mkdir 必然失败 → 应该退到当前目录
  process.env.APPDATA = 'C:/Windows/System32/drivers/etc/hosts'
  const blocked = pickHomeDir({})
  check('平台目录写不进去时退到当前目录', blocked.source === 'cwd', JSON.stringify(blocked))
  check('退到的目录确实可写', isWritableDir(blocked.dir), blocked.dir)
  check('退到的目录就是 .qingshi', blocked.dir === cwdFallbackDir(), blocked.dir)

  // 显式指定优先，不受可写性探测影响
  const forced = pickHomeDir({ workspaceDir: join(sandbox, 'forced') })
  check('显式配置优先', forced.source === 'config' && forced.dir === join(sandbox, 'forced'), JSON.stringify(forced))

  if (prevAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = prevAppData
  if (prevHome !== undefined) process.env.QINGSHI_HOME = prevHome
  if (prevWs !== undefined) process.env.QINGSHI_WORKSPACE = prevWs
}

if (prevDsh === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = prevDsh
rmSync(sandbox, { recursive: true, force: true })

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) process.exit(1)
