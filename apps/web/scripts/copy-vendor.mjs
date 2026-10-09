// Copies the KTX2 (Basis Universal) transcoder that matches the installed three.js into
// assets/vendor/basis, where the viewer loads it. Runs before dev and build.
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(web, 'node_modules/three/examples/jsm/libs/basis')
const dest = path.join(web, '../../assets/vendor/basis')
await mkdir(dest, { recursive: true })
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) await copyFile(path.join(src, f), path.join(dest, f))
