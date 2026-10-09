import { expect, test } from 'vitest'
import example from '../../../../packages/schema/generated/example-report.json'
import { PayloadSchema, ReportSchema } from './schema'

// tests/test_archive_server.py proves this file holds every Python field.
// Strict parsing here proves the TypeScript schema holds exactly the same fields.
test('python contract example parses strictly', () => {
  expect(ReportSchema.parse(example.report)).toEqual(example.report)
  for (const p of example.payloads) expect(PayloadSchema.parse(p)).toEqual(p)
})

test('unknown fields are rejected', () => {
  expect(() => ReportSchema.parse({ ...example.report, extra: 1 })).toThrow()
})
