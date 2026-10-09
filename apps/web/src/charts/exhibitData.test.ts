import { expect, test } from 'vitest'
import { buildExhibit, EXHIBIT_SIZE as S, parseColor } from './exhibitData'

const labels: [string, string, string] = ['a', 'b', 'c']

test('scatter3d: exact readout, normalized geometry, z is up', () => {
  const fig = {
    data: [
      { type: 'scatter3d', name: 'one', x: [0, 10], y: [5, 5], z: [-1, 1], marker: { color: '#ff0000' } },
      { type: 'scatter3d', x: { dtype: 'f8', bdata: btoa(String.fromCharCode(...new Uint8Array(new Float64Array([5]).buffer))) }, y: [6], z: [0] },
    ],
  }
  const ex = buildExhibit(fig, labels)!
  expect(ex.kind).toBe('points')
  // point 0: x min -> -S/2; z min -> bottom; y min -> front (+z in the scene)
  expect(Array.from(ex.positions.slice(0, 3))).toEqual([-S / 2, -S / 2, S / 2].map(Math.fround))
  expect(ex.describe(1)).toBe('one · a = 10, b = 5, c = 1')
  expect(ex.describe(2)).toBe('Trace 2 · a = 5, b = 6, c = 0')
  expect(ex.axes.map((x) => [x.min, x.max])).toEqual([[0, 10], [5, 6], [-1, 1]])
  expect(Array.from(ex.colors.slice(0, 3))).toEqual([1, 0, 0])
})

test('log axes keep original units in the readout and range', () => {
  const fig = {
    data: [{ type: 'scatter3d', name: 'yes', x: [1, 100], y: [1, 1], z: [1, 1] }],
    layout: { scene: { xaxis: { type: 'log' } }, legend: { title: { text: '<b>up</b>' } } },
  }
  const ex = buildExhibit(fig, labels)!
  expect(ex.describe(1)).toBe('up = yes · a = 100, b = 1, c = 1')
  expect(ex.axes[0]).toEqual({ label: 'a', min: 1, max: 100, log: true })
  expect(ex.positions[0]).toBeCloseTo(-S / 2)
})

test('surface: grid triangles, NaN cells are gaps', () => {
  const ex = buildExhibit({ data: [{ type: 'surface', z: [[1, 2, 3], [4, NaN, 6]] }] }, labels)!
  expect(ex.kind).toBe('surface')
  expect(ex.index!.length).toBe(0) // both cells touch the NaN vertex
  const ok = buildExhibit({ data: [{ type: 'surface', z: [[1, 2], [3, 4]], x: [10, 20], y: [0, 1] }] }, labels)!
  expect(ok.index!.length).toBe(6)
  expect(ok.describe(1)).toBe('a = 20, b = 0, c = 2')
})

test('unsupported content is refused, not approximated', () => {
  expect(buildExhibit({ data: [{ type: 'scatter3d', x: ['p', 'q'], y: [1, 2], z: [1, 2] }] }, labels)).toBeNull()
  expect(buildExhibit({ data: [{ type: 'scatter3d', x: [1], y: [1], z: [1] }, { type: 'mesh3d' }] }, labels)).toBeNull()
  expect(parseColor('rgb(255, 0, 0)')).toEqual([1, 0, 0])
})
