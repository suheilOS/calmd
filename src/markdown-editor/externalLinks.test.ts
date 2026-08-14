import { markdown, commonmarkLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { describe, expect, test } from 'bun:test'
import {
  activateExternalLink,
  externalUrlAt,
  supportedExternalUrl,
} from './externalLinks'

function markdownState(doc: string) {
  return EditorState.create({
    doc,
    extensions: markdown({ base: commonmarkLanguage, extensions: [GFM] }),
  })
}

function positionOf(doc: string, text: string) {
  const position = doc.indexOf(text)
  if (position < 0) throw new Error(`Expected ${text} in ${doc}`)
  return position + Math.min(1, text.length)
}

describe('external link syntax', () => {
  test('resolves a bare URL at its clicked position', () => {
    const doc = 'Read https://example.com/docs first'
    expect(externalUrlAt(markdownState(doc), positionOf(doc, 'https://')))
      .toBe('https://example.com/docs')
  })

  test('resolves the destination when clicking a Markdown link label', () => {
    const doc = '[Example](https://example.com/docs)'
    expect(externalUrlAt(markdownState(doc), positionOf(doc, 'Example')))
      .toBe('https://example.com/docs')
  })

  test('resolves an autolink destination', () => {
    const doc = '<https://example.com/docs>'
    expect(externalUrlAt(markdownState(doc), positionOf(doc, 'https://')))
      .toBe('https://example.com/docs')
  })

  test('does not resolve URLs inside inline or fenced code', () => {
    const inline = '`https://example.com`'
    expect(externalUrlAt(markdownState(inline), positionOf(inline, 'https://'))).toBeNull()

    const fenced = '```text\nhttps://example.com\n```'
    expect(externalUrlAt(markdownState(fenced), positionOf(fenced, 'https://'))).toBeNull()
  })
})

describe('supported external URLs', () => {
  test('accepts and normalizes absolute HTTP(S) URLs', () => {
    expect(supportedExternalUrl('http://example.com')).toBe('http://example.com/')
    expect(supportedExternalUrl('https://example.com/docs?q=one two'))
      .toBe('https://example.com/docs?q=one%20two')
  })

  test('decodes Markdown escapes and character references before opening', () => {
    expect(supportedExternalUrl('https://example.com/a\\(b\\)'))
      .toBe('https://example.com/a(b)')
    expect(supportedExternalUrl('https://example.com/?a=one&amp;b=two'))
      .toBe('https://example.com/?a=one&b=two')
  })

  test('rejects unsupported and invalid URL schemes', () => {
    expect(supportedExternalUrl('ftp://example.com')).toBeNull()
    expect(supportedExternalUrl('javascript:alert(1)')).toBeNull()
    expect(supportedExternalUrl('not a URL')).toBeNull()
  })
})

describe('external link activation', () => {
  test('reports failures from the platform opener', async () => {
    const view = markdownState('https://example.com')
    const failure = new Error('opener unavailable')
    let reported: unknown

    const event = {
      altKey: false,
      button: 0,
      ctrlKey: true,
      metaKey: false,
      preventDefault: () => {},
      shiftKey: false,
    } as MouseEvent

    expect(activateExternalLink(
      view,
      0,
      event,
      () => {},
      async () => { throw failure },
      (error) => { reported = error },
    )).toBe(true)

    await Promise.resolve()
    expect(reported).toBe(failure)
  })
})
