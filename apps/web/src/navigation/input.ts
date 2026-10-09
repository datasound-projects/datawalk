// Central input state. Movement reads `pressed`; one-shot actions use keydown handlers.
export const pressed = new Set<string>()

// macOS sends no keyup for keys released while Cmd is down: Cmd shortcuts never walk, and
// releasing Cmd stops all walking.
addEventListener('keydown', (e) => void (!e.metaKey && pressed.add(e.code)))
addEventListener('keyup', (e) => void (e.key === 'Meta' ? pressed.clear() : pressed.delete(e.code)))
addEventListener('blur', () => pressed.clear())

export const canvas = () => document.querySelector<HTMLCanvasElement>('#scene canvas')

export function lockPointer() {
  // Pointer lock can fail (no user gesture, unsupported browser). Keyboard walking still works.
  // On a first visit the room may still be loading: wait for its canvas, within the few
  // seconds that the browser keeps the click's user activation.
  const started = performance.now()
  const attempt = () => {
    const c = canvas()
    if (c) c.requestPointerLock()?.catch(() => {})
    else if (performance.now() - started < 4500) setTimeout(attempt, 100)
  }
  attempt()
}

export function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock()
}

// A drag-to-look gesture must not also count as a click on a chart.
let dragged = false
export const markDragged = () => void (dragged = true)
export function consumeDragged() {
  const d = dragged
  dragged = false
  return d
}
