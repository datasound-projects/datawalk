// Theme asset pipeline: download CC0 assets from Poly Haven, optimize them, record provenance.
//
//   node scripts/assets.mjs            fetch and build everything in assets/sources.json
//   node scripts/assets.mjs sofa_02    only these ids
//
// Raw downloads go to .asset-cache/ (not committed). Optimized files go to assets/library/.
// assets/manifest.json records source, license, authors, checksums and optimization per asset.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, getBounds, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { encodeToKTX2 } from 'ktx2-encoder'
import { ktx2 } from 'ktx2-encoder/gltf-transform'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const ASSETS = path.join(ROOT, 'assets')
const LIB = path.join(ASSETS, 'library')
const CACHE = path.join(ROOT, '.asset-cache')
const UA = 'DataWalk-AssetPipeline/0.1 (build-time fetch; https://github.com/datawalk)'
const API = 'https://api.polyhaven.com'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const rel = (p) => path.relative(ASSETS, p).split(path.sep).join('/')

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Download once into the cache; return bytes and provenance. */
async function cached(url, file) {
  const dest = path.join(CACHE, file)
  let buf
  if (existsSync(dest)) buf = await readFile(dest)
  else {
    buf = await get(url)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, buf)
  }
  return { buf, record: { url, sha256: sha256(buf), bytes: buf.length } }
}

async function output(file, buf) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, buf)
  return { path: rel(file), sha256: sha256(buf), bytes: buf.length }
}

const decode = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), width: info.width, height: info.height }
}

// Color data: ETC1S, sRGB. Normal maps: UASTC + normal-map tuning, linear. Packed AO/roughness/metal: UASTC, linear.
// Sizes were tuned on sofa_02 and herringbone_parquet: UASTC normals keep surface detail;
// ETC1S suits color and the smooth AO/roughness/metal channels at a fraction of the size.
const COLOR = { isUASTC: false, qualityLevel: 230, compressionLevel: 4, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, generateMipmap: true, imageDecoder: decode }
const NORMAL = { isUASTC: true, isNormalMap: true, isPerceptual: false, needSupercompression: true, enableRDO: true, rdoQualityLevel: 4, generateMipmap: true, imageDecoder: decode }
const NORMAL_SIZE = 512
const DATA = { isUASTC: false, qualityLevel: 200, compressionLevel: 4, isPerceptual: false, generateMipmap: true, imageDecoder: decode }

async function buildModel(id, opts) {
  const files = JSON.parse(await get(`${API}/files/${id}`))
  if (!files.gltf) throw new Error(`${id} has no glTF download`)
  const res = pickResolution(files.gltf, opts.resolution ?? '1k')
  const entry = files.gltf[res].gltf
  const dir = `${id}/gltf`
  const downloads = [(await cached(entry.url, `${dir}/${id}.gltf`)).record]
  for (const [name, inc] of Object.entries(entry.include))
    downloads.push((await cached(inc.url, `${dir}/${name}`)).record)

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
  })
  await MeshoptEncoder.ready
  const doc = await io.read(path.join(CACHE, dir, `${id}.gltf`))
  const steps = [dedup(), prune(), weld()]
  if (opts.simplify) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: opts.simplify, error: 0.001 }))
  steps.push(
    // Normal detail at 512 px is not visible at furniture viewing distance; it halves the size.
    textureCompress({ encoder: sharp, targetFormat: 'png', resize: [NORMAL_SIZE, NORMAL_SIZE], slots: /^normalTexture$/ }),
    ktx2({ ...COLOR, slots: /^(baseColorTexture|emissiveTexture)$/ }),
    ktx2({ ...NORMAL, slots: /^normalTexture$/ }),
    ktx2({ ...DATA, slots: /^(occlusionTexture|metallicRoughnessTexture)$/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  await doc.transform(...steps)
  // Real-world size in meters, for layout and colliders before the model loads.
  const { min, max } = getBounds(doc.getRoot().listScenes()[0])
  const r = (v) => Math.round(v * 1000) / 1000
  const bounds = { min: min.map(r), max: max.map(r) }
  const glb = await io.writeBinary(doc)
  const outputs = [await output(path.join(LIB, 'models', `${id}.glb`), Buffer.from(glb))]
  const optimization = `glTF ${res}: dedup, weld${opts.simplify ? `, simplify to ${opts.simplify}` : ''}, KTX2 (ETC1S color and ORM, UASTC+RDO normal at 512 px), meshopt`
  return { downloads, outputs, optimization, bounds }
}

async function buildMaterial(id, opts) {
  const files = JSON.parse(await get(`${API}/files/${id}`))
  const res = opts.resolution ?? '1k'
  const maps = [
    ['color', files.Diffuse, COLOR],
    ['normal', files.nor_gl, NORMAL],
    ['arm', files.arm, DATA], // AO (r), roughness (g), metalness (b)
  ]
  const downloads = []
  const outputs = []
  for (const [name, src, enc] of maps) {
    const { url } = src[res].jpg
    const { buf, record } = await cached(url, `${id}/${name}.jpg`)
    downloads.push(record)
    // GPU block formats (BC/S3TC on Windows and Linux, ETC, ASTC) need sizes in multiples of 4,
    // and some Poly Haven maps are 1024 x 1018: every map becomes a square power of two.
    const { width = 1024 } = await sharp(buf).metadata()
    const side = name === 'normal' ? NORMAL_SIZE : 2 ** Math.round(Math.log2(width))
    const img = await sharp(buf).resize(side, side).png().toBuffer()
    const ktx = await encodeToKTX2(new Uint8Array(img), enc)
    outputs.push(await output(path.join(LIB, 'materials', id, `${name}.ktx2`), Buffer.from(ktx)))
  }
  return { downloads, outputs, optimization: `${res} textures: KTX2 (ETC1S color and AO/roughness/metal, UASTC+RDO normal at 512 px)` }
}

// --- Radiance HDR: decode (flat or RLE), 2x2 box downsample, encode (flat) ----------------
function readHdr(buf) {
  let pos = 0
  const line = () => {
    let s = ''
    while (buf[pos] !== 0x0a) s += String.fromCharCode(buf[pos++])
    pos++
    return s
  }
  let l
  while ((l = line()) !== '') if (!l.startsWith('#') && !/^[A-Z]+=|^#\?/.test(l)) throw new Error(`bad header: ${l}`)
  const [, h, , w] = line().split(' ')
  const width = +w
  const height = +h
  const px = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = px.subarray(y * width * 4, (y + 1) * width * 4)
    if (buf[pos] === 2 && buf[pos + 1] === 2 && (buf[pos + 2] << 8 | buf[pos + 3]) === width) {
      pos += 4
      for (let c = 0; c < 4; c++)
        for (let x = 0; x < width; ) {
          let n = buf[pos++]
          if (n > 128) {
            n -= 128
            const v = buf[pos++]
            while (n--) row[x++ * 4 + c] = v
          } else while (n--) row[x++ * 4 + c] = buf[pos++]
        }
    } else {
      row.set(buf.subarray(pos, pos + width * 4))
      pos += width * 4
    }
  }
  return { width, height, px }
}

function writeHdr({ width, height, px }) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'ascii')
  return Buffer.concat([head, Buffer.from(px)])
}

function downsampleHdr({ width, height, px }) {
  const W = width / 2
  const H = height / 2
  const out = new Uint8Array(W * H * 4)
  const f = (i, c) => (px[i + 3] ? px[i + c] * 2 ** (px[i + 3] - 136) : 0)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const rgb = [0, 1, 2].map((c) => {
        let s = 0
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) s += f(((2 * y + dy) * width + 2 * x + dx) * 4, c)
        return s / 4
      })
      const m = Math.max(...rgb)
      const o = (y * W + x) * 4
      if (m < 1e-32) continue
      const e = Math.ceil(Math.log2(m)) + (m === 2 ** Math.ceil(Math.log2(m)) ? 1 : 0)
      const scale = 256 / 2 ** e
      for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, Math.floor(rgb[c] * scale))
      out[o + 3] = e + 128
    }
  return { width: W, height: H, px: out }
}

async function buildHdri(id, opts) {
  const files = JSON.parse(await get(`${API}/files/${id}`))
  const downloads = []
  const outputs = []
  const notes = []
  if (opts.lighting) {
    const { buf, record } = await cached(files.hdri['1k'].hdr.url, `${id}/${id}_1k.hdr`)
    downloads.push(record)
    outputs.push(await output(path.join(LIB, 'hdri', `${id}.hdr`), writeHdr(downsampleHdr(readHdr(buf)))))
    notes.push('lighting: 1k HDR downsampled to 512x256')
  }
  if (opts.view) {
    const { buf, record } = await cached(files.tonemapped.url, `${id}/${id}_tonemapped.jpg`)
    downloads.push(record)
    const jpg = await sharp(buf).resize({ width: opts.viewWidth ?? 4096 }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    outputs.push(await output(path.join(LIB, 'views', `${id}.jpg`), jpg))
    notes.push(`view: tonemapped JPG resized to ${opts.viewWidth ?? 4096} px`)
  }
  return { downloads, outputs, optimization: notes.join('; ') }
}

/** The requested resolution, else the nearest smaller one, else the smallest available. */
function pickResolution(byRes, wanted) {
  const order = ['512', '1k', '2k', '4k', '8k']
  const have = order.filter((r) => byRes[r])
  const below = have.filter((r) => order.indexOf(r) <= order.indexOf(wanted))
  return below.at(-1) ?? have[0]
}

const BUILDERS = { models: buildModel, materials: buildMaterial, hdris: buildHdri }

async function main() {
  const sources = JSON.parse(await readFile(path.join(ASSETS, 'sources.json'), 'utf8'))
  const manifestPath = path.join(ASSETS, 'manifest.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { assets: {} }
  const only = new Set(process.argv.slice(2))
  for (const [type, entries] of Object.entries(sources)) {
    if (!BUILDERS[type]) continue
    for (const [id, opts] of Object.entries(entries)) {
      if (only.size && !only.has(id)) continue
      // Resume: skip assets whose recorded outputs exist (pass ids explicitly to rebuild).
      const done = manifest.assets[id]
      if (!only.size && done?.outputs.every((o) => existsSync(path.join(ASSETS, o.path)))) continue
      process.stdout.write(`${type}/${id} ... `)
      const info = JSON.parse(await get(`${API}/info/${id}`))
      const built = await BUILDERS[type](id, opts)
      manifest.assets[id] = {
        type,
        name: info.name,
        authors: Object.keys(info.authors ?? {}),
        source: `https://polyhaven.com/a/${id}`,
        license: 'CC0-1.0',
        attribution: 'Not required (CC0). Credited as a courtesy: Poly Haven (polyhaven.com).',
        ...built,
      }
      console.log(built.outputs.map((o) => `${o.path} ${(o.bytes / 1024).toFixed(0)} KiB`).join(', '))
      await save(manifest, manifestPath, sources)
    }
  }
  await save(manifest, manifestPath, sources)
}

async function save(manifest, manifestPath, sources) {
  // Drop entries that are no longer in sources.json.
  const wanted = new Set(Object.values(sources).flatMap((e) => Object.keys(e)))
  for (const id of Object.keys(manifest.assets)) if (!wanted.has(id)) delete manifest.assets[id]
  manifest.generated = new Date().toISOString()
  manifest.totalBytes = Object.values(manifest.assets).reduce((n, a) => n + a.outputs.reduce((m, o) => m + o.bytes, 0), 0)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 1) + '\n')
  // Compact index for the viewer: model sizes, which files exist, and the credits it shows.
  const index = { models: {}, materials: [], hdris: [], views: [], credits: {} }
  for (const [id, a] of Object.entries(manifest.assets)) {
    index.credits[id] = { name: a.name, authors: a.authors, source: a.source, license: a.license }
    if (a.type === 'models') index.models[id] = a.bounds
    if (a.type === 'materials') index.materials.push(id)
    if (a.type === 'hdris')
      for (const o of a.outputs) (o.path.startsWith('library/views/') ? index.views : index.hdris).push(id)
  }
  await writeFile(path.join(LIB, 'index.json'), JSON.stringify(index, null, 1) + '\n')
  // Remove optimized files that no asset in the manifest produces any more.
  const keep = new Set(Object.values(manifest.assets).flatMap((x) => x.outputs.map((o) => path.join(ASSETS, o.path))))
  keep.add(path.join(LIB, 'index.json'))
  for (const f of await readdir(LIB, { recursive: true, withFileTypes: true }))
    if (f.isFile() && !keep.has(path.join(f.parentPath, f.name))) await rm(path.join(f.parentPath, f.name))
  console.log(`Total optimized size: ${(manifest.totalBytes / 2 ** 20).toFixed(1)} MiB`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
