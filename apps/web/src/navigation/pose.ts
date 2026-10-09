// Player pose shared outside React (the map reads it every frame) and teleport requests.
export const pose = { x: 0, z: 0, yaw: 0 }

export interface Target {
  x: number
  z: number
  yaw: number // 0 faces north (-z)
}

let pending: Target | null = null
export const requestTeleport = (t: Target) => void (pending = t)
export function takeTeleport(): Target | null {
  const t = pending
  pending = null
  return t
}

/** Stand `distance` meters in front of a wall display or exhibit, facing it. */
export function standInFront(position: [number, number, number], rotationY: number, distance: number): Target {
  return {
    x: position[0] + Math.sin(rotationY) * distance,
    z: position[2] + Math.cos(rotationY) * distance,
    yaw: rotationY,
  }
}
