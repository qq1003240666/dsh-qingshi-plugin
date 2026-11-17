// 从 assets/plugin-icon.png 生成 assets/icon.ico（Windows 窗口图标）
// 做法：以用户给的 240×240 PNG 为源 → ffmpeg 缩放出各尺寸 → 手工拼 ICO
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const assets = join(pkgDir, 'assets')
const work = join(pkgDir, '.pack', 'icon-render')
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

const src = [
  join(assets, 'plugin-icon.png'),
  join(assets, 'icon-256.png'),
].find((p) => existsSync(p))
if (!src) {
  console.error('NO_SOURCE_ICON')
  process.exit(1)
}

const ffmpeg = existsSync('D:/ffmpeg/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe')
  ? 'D:/ffmpeg/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe'
  : 'ffmpeg'

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = []
for (const s of sizes) {
  const out = join(work, `icon-${s}.png`)
  const rr = spawnSync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', `scale=${s}:${s}:flags=lanczos`, '-pix_fmt', 'rgba', out],
    { stdio: 'ignore', timeout: 60000 },
  )
  if (!existsSync(out)) {
    console.error(`SCALE_FAILED size=${s} status=${rr.status}`)
    process.exit(1)
  }
  pngs.push({ size: s, buf: readFileSync(out) })
}

// ICO：每张图以 PNG 形式内嵌（Vista+ 支持）
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(pngs.length, 4)

const entries = []
let offset = 6 + pngs.length * 16
for (const { size, buf } of pngs) {
  const e = Buffer.alloc(16)
  e.writeUInt8(size >= 256 ? 0 : size, 0)
  e.writeUInt8(size >= 256 ? 0 : size, 1)
  e.writeUInt8(0, 2) // palette
  e.writeUInt8(0, 3) // reserved
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(buf.length, 8)
  e.writeUInt32LE(offset, 12)
  entries.push(e)
  offset += buf.length
}

const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)])
writeFileSync(join(assets, 'icon.ico'), ico)
writeFileSync(join(assets, 'icon-256.png'), pngs[pngs.length - 1].buf)

console.log(
  JSON.stringify({
    ico_bytes: ico.length,
    sizes: pngs.map((p) => `${p.size}:${p.buf.length}`),
  }),
)
