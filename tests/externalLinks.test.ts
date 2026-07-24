import { commonmarkLanguage, markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { describe, expect, test } from 'bun:test'
import {
  externalUrlAtPosition,
  handleExternalLinkMouseDown,
} from '../src/externalLinkInteraction'
import {
  externalUrlFromText,
  isExternalLinkNavigationClick,
} from '../src/externalLinks'

function markdownState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: commonmarkLanguage, extensions: [GFM] })],
  })
}

describe('external links', () => {
  test('accepts browser URLs and normalizes www links', () => {
    expect(externalUrlFromText('https://example.com/docs')).toBe('https://example.com/docs')
    expect(externalUrlFromText('www.example.com/docs')).toBe('https://www.example.com/docs')
  })

  test('rejects non-browser URL schemes', () => {
    expect(externalUrlFromText('mailto:hello@example.com')).toBeNull()
    expect(externalUrlFromText('javascript:alert(1)')).toBeNull()
    expect(externalUrlFromText('not a URL')).toBeNull()
  })

  test('resolves parsed URLs but not code content', () => {
    const doc = 'See https://example.com and [site](https://tauri.app) and `https://ignored.test`'
    const state = markdownState(doc)

    expect(externalUrlAtPosition(state, doc.indexOf('https://example.com') + 5))
      .toBe('https://example.com')
    expect(externalUrlAtPosition(state, doc.indexOf('https://tauri.app') + 5))
      .toBe('https://tauri.app')
    expect(externalUrlAtPosition(state, doc.indexOf('https://ignored.test') + 5)).toBeNull()
  })

  test('opens a URL and prevents the editor click', () => {
    const doc = 'See https://example.com'
    const state = markdownState(doc)
    const opened: string[] = []
    let prevented = false

    const handled = handleExternalLinkMouseDown(
      {
        state,
        posAtDOM: () => doc.indexOf('https://example.com') + 5,
      },
      {
        button: 0,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        target: null,
        preventDefault: () => { prevented = true },
      },
      async (url) => { opened.push(url) },
      () => {},
    )

    expect(handled).toBe(true)
    expect(prevented).toBe(true)
    expect(opened).toEqual(['https://example.com'])
  })

  test('reports browser-opening failures', async () => {
    const state = markdownState('See https://example.com')
    const errors: unknown[] = []

    handleExternalLinkMouseDown(
      {
        state,
        posAtDOM: () => 8,
      },
      {
        button: 0,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        target: null,
        preventDefault: () => {},
      },
      async () => { throw new Error('browser unavailable') },
      (_url, error) => { errors.push(error) },
    )
    await Promise.resolve()

    expect(errors).toHaveLength(1)
  })

  test('requires a primary-button Ctrl-click', () => {
    const click = {
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }

    expect(isExternalLinkNavigationClick({ ...click, ctrlKey: true })).toBe(true)
    expect(isExternalLinkNavigationClick(click)).toBe(false)
    expect(isExternalLinkNavigationClick({ ...click, button: 1, ctrlKey: true })).toBe(false)
    expect(isExternalLinkNavigationClick({ ...click, altKey: true, ctrlKey: true })).toBe(false)
    expect(isExternalLinkNavigationClick({ ...click, metaKey: true, ctrlKey: true })).toBe(false)
    expect(isExternalLinkNavigationClick({ ...click, shiftKey: true, ctrlKey: true })).toBe(false)
  })
})
