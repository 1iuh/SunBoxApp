// 把 dist/ 下的 *.gz 复制到 SunBox 固件仓库的 web/ 目录（保持目录结构）。
// 之后在固件仓库运行 tools/gen_web_assets.ps1 即可内置进固件；或直接在设备 /update 页面上传 web/ 文件夹。
// 目标目录默认 ../SunBox/web，可用环境变量 SUNBOX_WEB_DIR 覆盖。
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const targetDir = resolve(process.env.SUNBOX_WEB_DIR || join(root, '..', 'SunBox', 'web'))

function listGz(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listGz(full)
    return entry.name.endsWith('.gz') ? [full] : []
  })
}

if (!existsSync(distDir)) {
  console.error('dist/ not found, run "npm run build" first.')
  process.exit(1)
}
if (!existsSync(targetDir)) {
  console.error(`Target not found: ${targetDir} (set SUNBOX_WEB_DIR)`)
  process.exit(1)
}

// 只删旧的 *.gz（带 hash 的旧资源），保留 web/README.md 等其他文件
for (const old of listGz(targetDir)) rmSync(old)

for (const file of listGz(distDir)) {
  const dest = join(targetDir, relative(distDir, file))
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(file, dest)
  console.log(`${relative(distDir, file)} -> ${dest}`)
}
