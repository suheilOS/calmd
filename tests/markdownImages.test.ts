import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'bun:test'
import {
  classifyLocalImageDestination,
  formatMarkdownImageDestination,
  markdownImage,
  parseInlineImageSyntax,
} from '../src/markdownImages'

function parseImage(source: string) {
  const state = EditorState.create({ doc: source, extensions: markdown() })
  let parsed = null
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Image') return
      const children: { name: string; from: number; to: number }[] = []
      const cursor = node.node.cursor()
      if (cursor.firstChild()) {
        do {
          children.push({ name: cursor.name, from: cursor.from, to: cursor.to })
        } while (cursor.nextSibling())
      }
      parsed = parseInlineImageSyntax(source, children)
    },
  })
  return parsed
}

describe('Markdown image contract', () => {
  test('accepts supported portable vault-relative destinations', () => {
    expect(classifyLocalImageDestination('attachments/photo.PNG')).toEqual({
      destination: 'attachments/photo.PNG',
      extension: 'png',
    })
    expect(classifyLocalImageDestination('<assets/photo one.webp>')).toEqual({
      destination: 'assets/photo one.webp',
      extension: 'webp',
    })
    expect(classifyLocalImageDestination('image\\).jpg')).toEqual({
      destination: 'image).jpg',
      extension: 'jpg',
    })
  })

  test('rejects remote, absolute, traversal, ambiguous, and unsupported destinations', () => {
    for (const destination of [
      'https://example.com/image.png',
      'file:///tmp/image.png',
      '/tmp/image.png',
      'C:/image.png',
      '../image.png',
      'assets/../image.png',
      'assets\\image.png',
      'image.png?size=2',
      'image.png#fragment',
      'image.svg',
      'image',
    ]) {
      expect(classifyLocalImageDestination(destination)).toBeNull()
    }
  })

  test('extracts inline alt text, destination, and optional title from parser ranges', () => {
    expect(parseImage('![A photo](attachments/a.png)')).toEqual({
      alt: 'A photo',
      destination: 'attachments/a.png',
    })
    expect(parseImage('![A \\] photo](<attachments/a b.png> "A title")')).toEqual({
      alt: 'A ] photo',
      destination: '<attachments/a b.png>',
      title: 'A title',
    })
  })

  test('does not treat reference-style images as inline images', () => {
    expect(parseImage('![Photo][reference]')).toBeNull()
  })

  test('writes unambiguous standard Markdown image syntax', () => {
    expect(formatMarkdownImageDestination('attachments/photo.png'))
      .toBe('attachments/photo.png')
    expect(formatMarkdownImageDestination('attachments/photo one.png'))
      .toBe('<attachments/photo one.png>')
    expect(formatMarkdownImageDestination('attachments/photo <one>.png'))
      .toBe('<attachments/photo \\<one\\>.png>')
    expect(markdownImage('attachments/photo one.png', 'A ] photo'))
      .toBe('![A \\] photo](<attachments/photo one.png>)')
    expect(markdownImage('attachments/photo[.png', 'photo['))
      .toBe('![photo\\[](attachments/photo[.png)')
    expect(parseImage(markdownImage('attachments/photo[.png', 'photo['))).toEqual({
      alt: 'photo[',
      destination: 'attachments/photo[.png',
    })
  })
})
