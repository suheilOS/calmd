import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { commonmarkLanguage, markdown } from '@codemirror/lang-markdown'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DisplayImage } from '../images'
import { MarkdownEditor } from './MarkdownEditor'
import { activateExternalLink } from './externalLinks'

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

const roots: Root[] = []
let noteSequence = 0

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

function editorProps(
  value: string,
  editorSessionId: number,
  onChange = () => {},
  noteKey = `note-${editorSessionId}.md`,
) {
  return {
    editorSessionId,
    noteKey,
    onChange,
    onPreviewCandidateEnter: () => {},
    onPreviewCandidateLeave: () => {},
    onPreviewDismiss: () => {},
    onSpellcheckEnabledChange: () => {},
    onWikiLinkActivate: () => {},
    resolveWikiLink: async () => null,
    spellcheckEnabled: true,
    suggestWikiLinks: async () => [],
  }
}

async function renderEditor(
  value: string,
  editorSessionId: number,
  onChange = () => {},
  noteKey = `test-note-${++noteSequence}.md`,
  resolveWikiLink = async () => null,
  resolveImage?: (destination: string) => Promise<DisplayImage>,
) {
  const container = document.createElement('div')
  const scrollContainer = document.createElement('div')
  scrollContainer.className = 'app-scroll-container'
  scrollContainer.append(container)
  document.body.append(scrollContainer)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <MarkdownEditor
        {...editorProps(value, editorSessionId, onChange, noteKey)}
        resolveImage={resolveImage}
        resolveWikiLink={resolveWikiLink}
        value={value}
      />,
    )
  })
  return { container, root, scrollContainer }
}

const resolvedImage: DisplayImage = {
  absolutePath: '/vault/attachments/photo.png',
  assetUrl: 'asset://localhost/photo.png?revision=abc',
  height: 200,
  mime: 'image/png',
  relativePath: 'attachments/photo.png',
  revision: 'abc',
  width: 300,
}

function pressUndo(container: HTMLElement) {
  const content = container.querySelector<HTMLElement>('.cm-content')
  if (!content) throw new Error('CodeMirror content was not mounted')
  content.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'z',
    ctrlKey: true,
  }))
}

describe('MarkdownEditor document sessions', () => {
  test('restores the caret for a reopened note without restoring its history', async () => {
    const noteA = '**first** and **second** tail'
    const { container, root } = await renderEditor(noteA, 41, () => {}, 'note-41.md')
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')

    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        content.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'ArrowLeft',
        }))
      })
    }
    expect(content.textContent).toBe('first and **second** tail')

    await act(async () => {
      root.render(
        <MarkdownEditor {...editorProps('other', 42, () => {}, 'other.md')} value="other" />,
      )
    })
    await act(async () => {
      root.render(
        <MarkdownEditor {...editorProps(noteA, 43, () => {}, 'note-41.md')} value={noteA} />,
      )
    })

    expect(content.textContent).toBe('first and **second** tail')
    await act(async () => pressUndo(container))
    expect(content.textContent).toBe('first and **second** tail')
  })

  test('preserves user undo history across canonical body updates', async () => {
    const source = 'before [[Old]] after'
    const canonical = 'edited [[New]] after'
    const { container, root } = await renderEditor(source, 51, () => {}, 'canonical.md')
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')
    const view = EditorView.findFromDOM(content)

    await act(async () => view.dispatch({
      changes: { from: 0, to: 'before'.length, insert: 'edited' },
      userEvent: 'input',
    }))
    await act(async () => {
      root.render(
        <MarkdownEditor
          {...editorProps(canonical, 51, () => {}, 'canonical.md')}
          value={canonical}
        />,
      )
    })

    await act(async () => pressUndo(container))

    expect(view.state.doc.toString()).toBe('before [[New]] after')
  })

  test('restores the outer app scroll position per note', async () => {
    const noteA = 'note A'
    const { container, root, scrollContainer } = await renderEditor(
      noteA,
      61,
      () => {},
      'scroll-a.md',
    )

    await act(async () => {
      scrollContainer.scrollTop = 240
      scrollContainer.dispatchEvent(new Event('scroll'))
    })
    await act(async () => {
      root.render(
        <MarkdownEditor {...editorProps('note B', 62, () => {}, 'scroll-b.md')} value="note B" />,
      )
    })
    expect(scrollContainer.scrollTop).toBe(0)

    await act(async () => {
      root.render(
        <MarkdownEditor
          {...editorProps(noteA, 63, () => {}, 'scroll-a.md')}
          value={noteA}
        />,
      )
    })
    expect(scrollContainer.scrollTop).toBe(240)
    expect(container.querySelector('.cm-content')).not.toBeNull()
  })

  test('ignores wiki-link resolution that completes for a previous note session', async () => {
    const resolutions: Array<(exists: boolean | null) => void> = []
    const resolveWikiLink = () => new Promise<boolean | null>((resolve) => {
      resolutions.push(resolve)
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <MarkdownEditor
          {...editorProps('[[Target]] tail', 71, () => {}, 'old.md')}
          resolveWikiLink={resolveWikiLink}
          value="[[Target]] tail"
        />,
      )
    })
    await act(async () => {
      root.render(
        <MarkdownEditor
          {...editorProps('[[Target]] tail', 72, () => {}, 'new.md')}
          resolveWikiLink={resolveWikiLink}
          value="[[Target]] tail"
        />,
      )
    })

    await act(async () => {
      resolutions[0]?.(false)
      await Promise.resolve()
    })
    expect(container.querySelector('.cm-wiki-link-missing')).toBeNull()
  })
})

describe('MarkdownEditor external links', () => {
  function externalLinkView(doc: string) {
    const container = document.createElement('div')
    document.body.append(container)
    return new EditorView({
      doc,
      extensions: [markdown({ base: commonmarkLanguage, extensions: [GFM] })],
      parent: container,
    })
  }

  function mouseDownEvent(ctrlKey = false) {
    return new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey,
    })
  }

  test('opens bare and formatted HTTP(S) links with the primary modifier', () => {
    for (const doc of [
      'https://example.com/docs',
      '[Example](https://example.com/docs)',
      '<https://example.com/docs>',
    ]) {
      const opened: string[] = []
      const view = externalLinkView(doc)
      const event = mouseDownEvent(true)

      expect(activateExternalLink(view.state, 0, event, () => {}, async (url) => {
        opened.push(url)
      })).toBe(true)

      expect(opened).toEqual(['https://example.com/docs'])
      expect(event.defaultPrevented).toBe(true)
      view.destroy()
    }
  })

  test('does not open an external link without the primary modifier', () => {
    const opened: string[] = []
    const view = externalLinkView('https://example.com/docs')
    const event = mouseDownEvent()

    expect(activateExternalLink(view.state, 0, event, () => {}, async (url) => {
      opened.push(url)
    })).toBe(false)

    expect(opened).toEqual([])
    view.destroy()
  })

  test('does not activate unsupported schemes or URLs inside code', () => {
    for (const doc of ['ftp://example.com', '`https://example.com`']) {
      const opened: string[] = []
      const view = externalLinkView(doc)
      const event = mouseDownEvent(true)

      expect(activateExternalLink(view.state, 0, event, () => {}, async (url) => {
        opened.push(url)
      })).toBe(false)

      expect(opened).toEqual([])
      view.destroy()
    }
  })
})

describe('MarkdownEditor Live Preview', () => {
  test('reveals only the formatted span touched by the caret', async () => {
    const { container } = await renderEditor('**first** and **second** tail', 1)
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')

    expect(content.textContent).toBe('first and second tail')

    await act(async () => {
      content.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Home',
      }))
    })

    expect(content.textContent).toBe('**first** and second tail')
  })

  test('reveals every formatted span overlapped by a completed selection', async () => {
    const { container } = await renderEditor('**first** and ~~second~~ tail', 1)
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')

    const view = EditorView.findFromDOM(content)
    view.contentDOM.blur()
    await act(async () => view.dispatch({
      selection: EditorSelection.range(0, view.state.doc.length),
    }))

    expect(content.textContent).toBe('**first** and ~~second~~ tail')
  })

  test('reveals every formatted span touched by multiple cursors', async () => {
    const source = '**first** and ~~second~~ tail'
    const { container } = await renderEditor(source, 1)
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')
    const view = EditorView.findFromDOM(content)
    view.contentDOM.blur()

    await act(async () => view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(source.indexOf('first') + 2),
        EditorSelection.cursor(source.indexOf('second') + 2),
      ]),
    }))

    expect(content.textContent).toBe('**first** and ~~second~~ tail')
  })

  test('freezes syntax visibility until a pointer selection is complete', async () => {
    const { container } = await renderEditor('**first** and **second** tail', 1)
    const content = container.querySelector<HTMLElement>('.cm-content')
    const editor = container.querySelector<HTMLElement>('.cm-editor')
    if (!content || !editor) throw new Error('CodeMirror content was not mounted')

    editor.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
    }))
    const view = EditorView.findFromDOM(content)
    view.contentDOM.blur()
    await act(async () => view.dispatch({ selection: { anchor: 0 } }))
    expect(content.textContent).toBe('first and second tail')

    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    })
    expect(content.textContent).toBe('**first** and second tail')
  })

  test('hides inactive prose syntax consistently', async () => {
    const { container } = await renderEditor(
      '~~gone~~, `code`, ==highlighted==, and [Calmd](https://calmd.local) tail',
      1,
    )

    expect(container.querySelector('.cm-content')?.textContent).toBe(
      'gone, code, highlighted, and Calmd tail',
    )
  })

  test('retains resolved wiki targets while they leave the active ranges', async () => {
    const resolutions: Array<(exists: boolean | null) => void> = []
    const resolveWikiLink = () => new Promise<boolean | null>((resolve) => {
      resolutions.push(resolve)
    })
    const { container, root } = await renderEditor(
      '[[Target]]',
      1,
      () => {},
      'cache.md',
      resolveWikiLink,
    )

    await act(async () => {
      resolutions[0]?.(false)
      await Promise.resolve()
    })
    await act(async () => {
      root.render(
        <MarkdownEditor
          {...editorProps('plain text', 1, () => {}, 'cache.md')}
          resolveWikiLink={resolveWikiLink}
          value="plain text"
        />,
      )
    })
    await act(async () => {
      root.render(
        <MarkdownEditor
          {...editorProps('[[Target]]', 1, () => {}, 'cache.md')}
          resolveWikiLink={resolveWikiLink}
          value="[[Target]]"
        />,
      )
    })

    expect(resolutions).toHaveLength(1)
    expect(container.querySelector('.cm-wiki-link-missing')).not.toBeNull()
  })

  test('extends blockquote styling across every quote line', async () => {
    const { container } = await renderEditor('> first line\ncontinuation', 1)

    expect(container.querySelectorAll('.cm-quote-line')).toHaveLength(2)
  })

  test('previews escapes, Setext headings, fenced code, and thematic breaks', async () => {
    const source = 'Heading\n---\n\\*literal\\*\n```ts\nconst value = 1\n```\n***\ntail'
    const { container } = await renderEditor(source, 1)
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')

    expect(content.textContent).not.toContain('---')
    expect(content.textContent).not.toContain('```')
    expect(content.textContent).not.toContain('ts')
    expect(content.textContent).toContain('*literal*')
    expect(container.querySelector('.cm-thematic-break')).not.toBeNull()
    expect(container.querySelectorAll('.cm-fenced-code-background')).toHaveLength(3)

    const view = EditorView.findFromDOM(content)
    view.contentDOM.blur()
    const codePosition = source.indexOf('const')
    await act(async () => view.dispatch({ selection: { anchor: codePosition } }))
    expect(content.textContent).toContain('```ts')
    expect(content.textContent).toContain('```')
  })

  test('renders inactive list prefixes and a source-backed task checkbox', async () => {
    const { container } = await renderEditor('- one\n1. two\n- [ ] task\ntail', 1)

    expect(
      [...container.querySelectorAll('.cm-list-marker')].map((node) => node.textContent),
    ).toEqual(['•', '1.'])
    const checkbox = container.querySelector<HTMLInputElement>('.cm-task-checkbox')
    expect(checkbox?.checked).toBe(false)
  })

  test('toggles an inactive task with one undoable source transaction', async () => {
    const changes: string[] = []
    const { container } = await renderEditor('- [ ] task\ntail', 1, (value) => {
      changes.push(value)
    })
    const checkbox = container.querySelector<HTMLInputElement>('.cm-task-checkbox')
    if (!checkbox) throw new Error('Task checkbox was not rendered')

    await act(async () => checkbox.click())
    expect(changes.at(-1)).toBe('- [x] task\ntail')

    await act(async () => pressUndo(container))
    expect(changes.at(-1)).toBe('- [ ] task\ntail')
  })

  test('toggles the current task range after text is inserted before its widget', async () => {
    const changes: string[] = []
    const source = 'intro\n- [ ] task\ntail'
    const { container } = await renderEditor(source, 1, (value) => changes.push(value))
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')
    const view = EditorView.findFromDOM(content)
    view.contentDOM.blur()

    await act(async () => view.dispatch({ changes: { from: 0, insert: 'prefix\n' } }))
    const checkbox = container.querySelector<HTMLInputElement>('.cm-task-checkbox')
    if (!checkbox) throw new Error('Task checkbox was not rendered')
    await act(async () => checkbox.click())

    expect(changes.at(-1)).toBe('prefix\nintro\n- [x] task\ntail')
  })

  test('converges Live Preview in a distant viewport of a long note', async () => {
    const paragraphs = Array.from(
      { length: 1_500 },
      (_, index) => `paragraph ${index}`,
    ).join('\n\n')
    const { container } = await renderEditor(`${paragraphs}\n\n**target** tail`, 1)
    const editor = container.querySelector<HTMLElement>('.cm-editor')
    if (!editor) throw new Error('CodeMirror was not mounted')

    const deadline = performance.now() + 1_000
    while (
      editor.classList.contains('cm-live-preview-pending')
      && performance.now() < deadline
    ) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10))
      })
    }

    const visibleText = container.querySelector('.cm-content')?.textContent
    expect(editor.classList.contains('cm-live-preview-pending')).toBe(false)
    expect(visibleText).toContain('target tail')
    expect(visibleText).not.toContain('**target**')
  })

  test('renders resolved local images and reveals their source on contact', async () => {
    const source = 'before\n\n![Photo](attachments/photo.png)\n\nafter'
    const { container } = await renderEditor(
      source,
      1,
      () => {},
      'image-note.md',
      async () => null,
      async () => resolvedImage,
    )
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')
    await act(async () => Promise.resolve())

    const image = container.querySelector<HTMLImageElement>('.cm-image img')
    expect(image?.alt).toBe('Photo')
    expect(image?.src).toContain('asset://localhost/photo.png')
    expect(content.textContent).not.toContain('![Photo]')

    await act(async () => {
      EditorView.findFromDOM(content).dispatch({
        selection: { anchor: source.indexOf('![Photo]') + 3 },
      })
    })
    expect(content.textContent).toContain('![Photo](attachments/photo.png)')
  })

  test('keeps unsupported image syntax literal and shows an accessible missing fallback', async () => {
    const source = '![Remote](https://example.com/photo.png)\n\n![Missing](missing.png)'
    const { container } = await renderEditor(
      source,
      1,
      () => {},
      'missing-image-note.md',
      async () => null,
      async () => Promise.reject(new Error('missing')),
    )
    await act(async () => Promise.resolve())

    expect(container.querySelector('.cm-content')?.textContent).toContain(
      '![Remote](https://example.com/photo.png)',
    )
    const fallback = container.querySelector('.cm-image-unavailable')
    expect(fallback?.getAttribute('aria-label')).toBe('Image unavailable: Missing')
  })

})
