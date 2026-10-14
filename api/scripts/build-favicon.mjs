import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'public/favicon.svg')
const output = resolve(root, 'public/favicon.ico')
const tempDirectory = resolve(root, 'node_modules/.tmp/favicon')
const sizes = [16, 24, 32, 48, 64]

await rm(tempDirectory, { recursive: true, force: true })
await mkdir(tempDirectory, { recursive: true })

const pngFiles = await Promise.all(
  sizes.map(async (size) => {
    const path = resolve(tempDirectory, `favicon-${size}.png`)
    await sharp(source, { density: 384 }).resize(size, size).png().toFile(path)
    return path
  }),
)

await writeFile(output, await pngToIco(pngFiles))
console.log(`已生成 ${sizes.join('/')}px 多尺寸 favicon.ico`)
