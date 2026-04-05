import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...options })
}

const repoRoot = new URL('..', import.meta.url).pathname
const input = join(repoRoot, 'images', 'logo_padded.png')
const iconsetDir = join(repoRoot, 'build', 'icon.iconset')
const icnsOut = join(repoRoot, 'build', 'icon.icns')

if (!existsSync(input)) {
  throw new Error(`Missing input image: ${input}`)
}

mkdirSync(iconsetDir, { recursive: true })

const sizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]

for (const [px, name] of sizes) {
  run('sips', ['-z', String(px), String(px), input, '--out', join(iconsetDir, name)])
}

run('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsOut])
