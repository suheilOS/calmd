import { describe, expect, test } from 'bun:test'
import type { FormattingToolbarSnapshot } from './contracts'
import {
  initialFormattingToolbarState,
  reduceFormattingToolbarState,
} from './formattingToolbarState'

function snapshot(selectionRevision: number): FormattingToolbarSnapshot {
  return {
    anchor: { height: 20, width: 0, x: 10, y: 10 },
    blockKind: 'paragraph',
    formats: {
      bold: 'inactive',
      code: 'inactive',
      highlight: 'inactive',
      italic: 'inactive',
      link: 'inactive',
      strikethrough: 'inactive',
    },
    selectionRevision,
  }
}

describe('formatting toolbar state', () => {
  test('focuses the toolbar when its snapshot arrives after the keyboard request', () => {
    const pending = reduceFormattingToolbarState(initialFormattingToolbarState, {
      type: 'request-focus',
    })
    expect(reduceFormattingToolbarState(pending, {
      type: 'snapshot',
      snapshot: snapshot(1),
    })).toEqual({
      kind: 'visible',
      focusRequested: true,
      snapshot: snapshot(1),
    })
  })

  test('keeps one selection dismissed across geometry updates', () => {
    const visible = reduceFormattingToolbarState(initialFormattingToolbarState, {
      type: 'snapshot',
      snapshot: snapshot(2),
    })
    const dismissed = reduceFormattingToolbarState(visible, { type: 'dismiss' })

    expect(reduceFormattingToolbarState(dismissed, {
      type: 'snapshot',
      snapshot: { ...snapshot(2), anchor: { height: 20, width: 0, x: 40, y: 60 } },
    })).toBe(dismissed)
  })

  test('shows the toolbar again after the document or selection revision changes', () => {
    const visible = reduceFormattingToolbarState(initialFormattingToolbarState, {
      type: 'snapshot',
      snapshot: snapshot(2),
    })
    const dismissed = reduceFormattingToolbarState(visible, { type: 'dismiss' })

    expect(reduceFormattingToolbarState(dismissed, {
      type: 'snapshot',
      snapshot: snapshot(3),
    }).kind).toBe('visible')
  })

  test('reopens a dismissed toolbar for the keyboard focus command', () => {
    const visible = reduceFormattingToolbarState(initialFormattingToolbarState, {
      type: 'snapshot',
      snapshot: snapshot(4),
    })
    const dismissed = reduceFormattingToolbarState(visible, { type: 'dismiss' })

    expect(reduceFormattingToolbarState(dismissed, { type: 'request-focus' })).toEqual({
      kind: 'visible',
      focusRequested: true,
      snapshot: snapshot(4),
    })
  })
})
