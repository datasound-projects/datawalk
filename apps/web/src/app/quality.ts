// Rendering quality presets and GPU tier detection. No benchmark downloads: the
// renderer string decides, so it works offline and on locked-down machines.
export type Quality = 'low' | 'medium' | 'high'

export interface QualitySettings {
  dpr: [number, number]
  shadows: boolean
  shadowMapSize: number
  ao: boolean
  maxLights: number
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: { dpr: [1, 1], shadows: false, shadowMapSize: 512, ao: false, maxLights: 0 },
  medium: { dpr: [1, 1.5], shadows: true, shadowMapSize: 1024, ao: true, maxLights: 4 },
  high: { dpr: [1, 2], shadows: true, shadowMapSize: 2048, ao: true, maxLights: 8 },
}

export interface GpuInfo {
  renderer: string
  tier: Quality
  software: boolean // software rendering or a virtual desktop: suggest flat mode
  webgl: boolean
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|microsoft basic render|vmware|virtualbox|citrix|parallels display/i
// Safari reports only "Apple GPU": that falls through to Medium.
const INTEGRATED = /intel|iris|uhd|hd graphics|mali|adreno|powervr|videocore/i
const DISCRETE = /nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|amd radeon|apple m\d/i

export function detectGpu(): GpuInfo {
  const gl = (() => {
    try {
      const canvas = document.createElement('canvas')
      return canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    } catch {
      return null
    }
  })()
  if (!gl) return { renderer: 'none', tier: 'low', software: true, webgl: false }
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  const software = SOFTWARE.test(renderer)
  // Integrated GPUs and virtual desktops start on Low (Apple M-series counts as discrete-class).
  const tier: Quality = software ? 'low' : DISCRETE.test(renderer) ? 'high' : INTEGRATED.test(renderer) ? 'low' : 'medium'
  return { renderer, tier, software, webgl: true }
}
