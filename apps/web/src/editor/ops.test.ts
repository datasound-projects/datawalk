import { expect, test } from 'vitest'
import example from '../../../../packages/schema/generated/example-report.json'
import { type Report, ReportSchema } from '../state/schema'
import { addRoom, createDashboard, deleteRemoved, deleteRoom, moveItem, reorder, ungroup, unassigned } from './ops'

const base = () => ReportSchema.parse(structuredClone(example.report)) as Report
const A = 'a'.repeat(32) // removed chart, manually placed in "Market"
const B = 'c'.repeat(32)
const D = 'd'.repeat(32) // dashboard [A, B] in "Market"

test('every operation keeps the report valid', () => {
  const r = base()
  const room2 = addRoom(r, 'Second')
  ungroup(r, D)
  expect(r.rooms[0].items).toEqual([A, B])
  const dash = createDashboard(r, r.rooms[0].id, 'Pair', [A, B])
  expect(r.rooms[0].items).toEqual([dash])
  expect(r.rooms[0].placements).toEqual({})
  ungroup(r, dash)
  moveItem(r, B, room2)
  reorder(r, room2, B, -1) // no-op at the start
  expect(r.rooms[1].items).toEqual([B])
  deleteRoom(r, room2)
  expect(unassigned(r).map((v) => v.id)).toEqual([B])
  deleteRemoved(r, A)
  deleteRemoved(r, B) // active: refused
  expect(r.visualizations.map((v) => v.id)).toEqual([B])
  expect(() => ReportSchema.parse(r)).not.toThrow()
})

test('moving an item drops its manual placement', () => {
  const r = base()
  moveItem(r, A, null)
  expect(r.rooms[0].placements).toEqual({})
})
