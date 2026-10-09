// Soft contact shadows under furniture: render the scene's depth from above once, blur it,
// and lay it on the floor. Adapted from @react-three/drei ContactShadows (MIT), which does not
// dispose its render targets and geometry on unmount and so leaks on every room change.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Color,
  Mesh,
  MeshDepthMaterial,
  type OrthographicCamera,
  PlaneGeometry,
  type Scene,
  ShaderMaterial,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js'
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js'

interface Props {
  width: number
  depth: number
  far?: number // height above the floor that casts shadows
  blur?: number
  opacity?: number
  resolution?: number
}

type Resources = {
  target: WebGLRenderTarget
  targetBlur: WebGLRenderTarget
  blurPlane: Mesh
  depthMaterial: MeshDepthMaterial
  hBlur: ShaderMaterial
  vBlur: ShaderMaterial
}

function renderShadow(gl: WebGLRenderer, scene: Scene, cam: OrthographicCamera, r: Resources, blur: number) {
  const pass = (amount: number) => {
    r.blurPlane.visible = true
    r.blurPlane.material = r.hBlur
    r.hBlur.uniforms.tDiffuse.value = r.target.texture
    r.hBlur.uniforms.h.value = amount / 256
    gl.setRenderTarget(r.targetBlur)
    gl.render(r.blurPlane, cam)
    r.blurPlane.material = r.vBlur
    r.vBlur.uniforms.tDiffuse.value = r.targetBlur.texture
    r.vBlur.uniforms.v.value = amount / 256
    gl.setRenderTarget(r.target)
    gl.render(r.blurPlane, cam)
    r.blurPlane.visible = false
  }
  const [background, override] = [scene.background, scene.overrideMaterial]
  scene.background = null
  scene.overrideMaterial = r.depthMaterial
  gl.setRenderTarget(r.target)
  gl.render(scene, cam)
  pass(blur)
  pass(blur * 0.4)
  gl.setRenderTarget(null)
  scene.background = background
  scene.overrideMaterial = override
}

export function ContactShadows({ width, depth, far = 2.2, blur = 2.4, opacity = 0.55, resolution = 1024 }: Props) {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const camera = useRef<OrthographicCamera>(null)
  const done = useRef(false)

  const r = useMemo(() => {
    const target = new WebGLRenderTarget(resolution, resolution)
    const targetBlur = new WebGLRenderTarget(resolution, resolution)
    target.texture.generateMipmaps = targetBlur.texture.generateMipmaps = false
    const plane = new PlaneGeometry(width, depth).rotateX(Math.PI / 2)
    const blurPlane = new Mesh(plane)
    const depthMaterial = new MeshDepthMaterial()
    depthMaterial.depthTest = depthMaterial.depthWrite = false
    depthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.ucolor = { value: new Color('#000000') }
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 ucolor;\nvoid main() {')
        .replace('vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );')
    }
    const hBlur = new ShaderMaterial(HorizontalBlurShader)
    const vBlur = new ShaderMaterial(VerticalBlurShader)
    hBlur.depthTest = vBlur.depthTest = false
    return { target, targetBlur, plane, blurPlane, depthMaterial, hBlur, vBlur }
  }, [width, depth, resolution])

  useEffect(
    () => () => {
      for (const x of [r.target, r.targetBlur, r.plane, r.depthMaterial, r.hBlur, r.vBlur]) x.dispose()
    },
    [r],
  )

  useFrame(() => {
    if (!camera.current || done.current) return
    done.current = true // static room: one render is enough
    renderShadow(gl, get().scene, camera.current, r, blur)
  })

  return (
    <group position={[0, 0.003, 0]} rotation-x={Math.PI / 2}>
      <mesh geometry={r.plane} scale={[1, -1, 1]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial transparent map={r.target.texture} opacity={opacity} depthWrite={false} />
      </mesh>
      <orthographicCamera ref={camera} args={[-width / 2, width / 2, depth / 2, -depth / 2, 0, far]} />
    </group>
  )
}
