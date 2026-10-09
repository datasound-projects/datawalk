import { expect, test } from 'vitest'
import example from '../../../../packages/schema/generated/example-report.json'
import { decodeArray, numeric } from './decode'

// Cases are produced by plotly.py's own encoder (packages/schema/make_example.py).
test.each(example.decode)('decodes $encoded.dtype exactly', ({ encoded, values, shape }) => {
  const d = decodeArray(encoded)!
  expect(Array.from(d.values)).toEqual(values)
  expect(d.shape).toEqual(shape)
})

test('plain and nested arrays; non-numeric data is rejected for geometry', () => {
  expect(decodeArray([[1, 2], [3, 4]])).toEqual({ values: [1, 2, 3, 4], shape: [2, 2] })
  expect(Array.from(numeric([1, null, 3])!)).toEqual([1, NaN, 3])
  expect(numeric(['a', 'b'])).toBeNull()
  expect(decodeArray({ dtype: 'c16', bdata: '' })).toBeNull()
})
