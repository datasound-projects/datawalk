// Plotly.py (>= 6) sends numpy arrays as {dtype, bdata: base64, shape?}. Plain JSON
// arrays also occur. Both decode to a flat array plus a shape.

const TYPED = {
  i1: Int8Array,
  u1: Uint8Array,
  u1c: Uint8ClampedArray,
  i2: Int16Array,
  u2: Uint16Array,
  i4: Int32Array,
  u4: Uint32Array,
  f4: Float32Array,
  f8: Float64Array,
} as const

export interface Decoded {
  values: ArrayLike<number | string | null>
  shape: number[]
}

function base64Bytes(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export function decodeArray(v: unknown): Decoded | null {
  if (Array.isArray(v)) {
    if (v.length && Array.isArray(v[0])) {
      const rows = v as unknown[][]
      return { values: rows.flat() as (number | string | null)[], shape: [rows.length, rows[0].length] }
    }
    return { values: v as (number | string | null)[], shape: [v.length] }
  }
  if (v && typeof v === 'object' && 'bdata' in v && 'dtype' in v) {
    const { dtype, bdata, shape } = v as { dtype: string; bdata: string; shape?: string | number }
    const Ctor = TYPED[dtype as keyof typeof TYPED]
    if (!Ctor) return null
    const values = new Ctor(base64Bytes(bdata)) // numpy and browsers are little-endian
    const dims = shape === undefined ? [values.length] : String(shape).split(',').map(Number)
    return { values, shape: dims }
  }
  return null
}

/** Numeric values only; any non-number makes the array unusable for 3D geometry. */
export function numeric(v: unknown): Float64Array | null {
  const d = decodeArray(v)
  if (!d) return null
  const out = new Float64Array(d.values.length)
  for (let i = 0; i < out.length; i++) {
    const x = d.values[i]
    if (typeof x !== 'number' && x !== null) return null
    out[i] = x ?? NaN
  }
  return out
}
