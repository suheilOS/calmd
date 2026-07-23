import { describe, expect, test } from 'bun:test'
import { mergeConcurrentTextChanges } from '../src/threeWayTextMerge'

describe('mergeConcurrentTextChanges', () => {
  test('combines non-overlapping canonical and current edits', () => {
    expect(mergeConcurrentTextChanges(
      'Self [[Old]]\nBody',
      'Self [[New]]\nBody',
      'Self [[Old]]\nEdited body',
    )).toBe('Self [[New]]\nEdited body')
  })

  test('preserves insertions at canonical edit boundaries', () => {
    expect(mergeConcurrentTextChanges('Old', 'New', 'Old!')).toBe('New!')
    expect(mergeConcurrentTextChanges('Old', 'New', '!Old')).toBe('!New')
  })

  test('deduplicates identical edits and rejects overlapping edits', () => {
    expect(mergeConcurrentTextChanges('Old', 'New', 'New')).toBe('New')
    expect(mergeConcurrentTextChanges('Old', 'New', 'Custom')).toBeNull()
  })

  test('fails safely when reconciliation would require excessive diff work', () => {
    const base = `a${'x'.repeat(2000)}b`
    const canonical = `a${'y'.repeat(2000)}b`
    const current = `a${'z'.repeat(2000)}b`
    expect(mergeConcurrentTextChanges(base, canonical, current)).toBeNull()
  })
})
