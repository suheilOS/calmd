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

async function waitForEditorState(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
  }
  throw new Error('Editor state did not settle')
}

function fencedLineContaining(container: HTMLElement, text: string) {
  return [...container.querySelectorAll<HTMLElement>('.cm-fenced-code-line')]
    .find((line) => line.textContent?.includes(text))
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
  test('resolves Markdown direction per line and isolates mixed-direction syntax', async () => {
    const source = [
      'فقرة عربية مع CodeMirror 6.',
      '',
      'English paragraph with العربية.',
      '',
      '# عنوان عربي',
      '',
      '- بند عربي',
      '',
      '> اقتباس عربي',
      '',
      'نص `const value = "عربي"` و[رابط عربي](https://example.com) و[[ملاحظة عربية]] وhttps://example.org.',
      '',
      '```text',
      'سطر شيفرة عربي = 42',
      '```',
    ].join('\n')
    const { container } = await renderEditor(source, 31)
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')
    const view = EditorView.findFromDOM(content)

    expect(view.state.facet(EditorView.perLineTextDirection)).toBe(true)
    const lines = [...content.querySelectorAll<HTMLElement>('.cm-line')]
    expect(lines.length).toBeGreaterThan(10)
    expect(lines.every((line) => line.dir === 'auto')).toBe(true)
    expect(lines.filter((line) => line.classList.contains('cm-fenced-code-line')).length).toBe(3)

    const inlineCode = content.querySelector<HTMLElement>('.cm-inline-code')
    const markdownLink = content.querySelector<HTMLElement>('.cm-link')
    const url = content.querySelector<HTMLElement>('.cm-url[dir="ltr"]')
    const wikiLink = content.querySelector<HTMLElement>('.cm-wiki-link')
    expect(inlineCode?.dir).toBe('ltr')
    expect(url?.dir).toBe('ltr')
    expect(markdownLink?.dir).toBe('auto')
    expect(wikiLink?.dir).toBe('auto')
  })

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
  test('keeps tables rendered during contact and retains callout source reveal', async () => {
    const source = [
      '| Name | Value |',
      '| --- | --- |',
      '| Calm | Notes |',
      '',
      '> [!note] Remember',
      '> Keep this nearby.',
      '',
      'Tail',
    ].join('\n')
    const { container } = await renderEditor(source, 1)
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')

    const table = content.querySelector('table.cm-table-preview')
    const callout = content.querySelector('aside.cm-callout-preview')
    expect(table?.textContent).toContain('Calm')
    expect(callout?.textContent).toBe('RememberKeep this nearby.')

    const calmCell = [...content.querySelectorAll<HTMLElement>('[data-table-cell]')]
      .find((cell) => cell.textContent === 'Calm')
    if (!calmCell) throw new Error('Calm table cell was not rendered')
    await act(async () => calmCell.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    })))
    expect(content.querySelector('table.cm-table-preview')).not.toBeNull()
    expect(content.querySelector('.cm-table-cell-input')).not.toBeNull()
    expect(content.textContent).not.toContain('| Name | Value |')

    const view = EditorView.findFromDOM(content)
    await act(async () => view.dispatch({ selection: { anchor: source.indexOf('Remember') } }))
    expect(content.querySelector('aside.cm-callout-preview')).toBeNull()
    expect(content.textContent).toContain('> [!note] Remember')
  })

  test('edits table cells without exposing the table source', async () => {
    const changes: string[] = []
    const source = '| Name | Value |\n| :--- | ---: |\n| Calm | Notes |'
    const { container } = await renderEditor(source, 1, (value) => changes.push(value))
    expect(container.querySelector('[data-table-cell="0:0"]')
      ?.getAttribute('data-alignment')).toBe('left')
    expect(container.querySelector('[data-table-cell="0:1"]')
      ?.getAttribute('data-alignment')).toBe('right')
    const calmCell = [...container.querySelectorAll<HTMLElement>('[data-table-cell]')]
      .find((cell) => cell.textContent === 'Calm')
    if (!calmCell) throw new Error('Calm table cell was not rendered')

    await act(async () => calmCell.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    })))
    const input = container.querySelector<HTMLInputElement>('.cm-table-cell-input')
    if (!input) throw new Error('Table cell editor was not mounted')
    expect(input.getAttribute('aria-label')).toBe('Table row 1, column 1')

    await act(async () => {
      input.value = 'Quiet'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(changes.at(-1)).toBe('| Name | Value |\n| :--- | ---: |\n| Quiet | Notes |')
    expect(container.querySelector('.cm-table-preview')).not.toBeNull()
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('| Quiet |')
  })

  test('commits IME input only after composition ends', async () => {
    const changes: string[] = []
    const source = '| A | B |\n| --- | --- |\n| C | D |'
    const { container } = await renderEditor(source, 1, (value) => changes.push(value))
    const cell = container.querySelector<HTMLElement>('[data-table-cell="1:0"]')
    if (!cell) throw new Error('Table cell was not rendered')
    await act(async () => cell.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    })))
    const input = container.querySelector<HTMLInputElement>('.cm-table-cell-input')
    if (!input) throw new Error('Table cell editor was not mounted')

    await act(async () => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.value = 'ملاحظة'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(changes).toEqual([])

    await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: 'ملاحظة',
    })))
    expect(changes.at(-1)).toBe('| A | B |\n| --- | --- |\n| ملاحظة | D |')
  })

  test('navigates table cells with Tab and appends a row from the final cell', async () => {
    const changes: string[] = []
    const source = '| A | B |\n| --- | --- |\n|  |  |'
    const { container } = await renderEditor(source, 1, (value) => changes.push(value))
    expect(container.querySelectorAll('tbody td')).toHaveLength(2)

    const firstBodyCell = container.querySelector<HTMLElement>('[data-table-cell="1:0"]')
    if (!firstBodyCell) throw new Error('First body cell was not rendered')
    await act(async () => firstBodyCell.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    })))

    let input = container.querySelector<HTMLInputElement>('.cm-table-cell-input')
    if (!input) throw new Error('Table cell editor was not mounted')
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
    })))
    input = container.querySelector<HTMLInputElement>('.cm-table-cell-input')
    expect(input?.getAttribute('aria-label')).toBe('Table row 1, column 2')

    await act(async () => input?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
    })))
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelector<HTMLInputElement>('.cm-table-cell-input')
      ?.getAttribute('aria-label')).toBe('Table row 2, column 1')
    expect(changes.at(-1)).toBe('| A | B |\n| --- | --- |\n|  |  |\n|  |  |')
  })

  test('undoes a cell edit through the outer editor history', async () => {
    const changes: string[] = []
    const source = '| A | B |\n| --- | --- |\n| C | D |'
    const { container } = await renderEditor(source, 1, (value) => changes.push(value))
    const cell = container.querySelector<HTMLElement>('[data-table-cell="1:0"]')
    if (!cell) throw new Error('Table cell was not rendered')
    await act(async () => cell.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    })))
    const input = container.querySelector<HTMLInputElement>('.cm-table-cell-input')
    if (!input) throw new Error('Table cell editor was not mounted')

    await act(async () => {
      input.value = 'Changed'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'z',
    })))

    expect(changes.at(-1)).toBe(source)
    expect(container.querySelector<HTMLInputElement>('.cm-table-cell-input')?.value).toBe('C')
  })

  test('edits the mapped table range after text is inserted before it', async () => {
    const changes: string[] = []
    const source = 'intro\n\n| A | B |\n| --- | --- |\n| C | D |'
    const { container } = await renderEditor(source, 1, (value) => changes.push(value))
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')
    const view = EditorView.findFromDOM(content)
    view.contentDOM.blur()
    await act(async () => view.dispatch({ changes: { from: 0, insert: 'prefix\n' } }))

    const cell = container.querySelector<HTMLElement>('[data-table-cell="1:1"]')
    if (!cell) throw new Error('Table cell was not rendered')
    await act(async () => cell.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    })))
    const input = container.querySelector<HTMLInputElement>('.cm-table-cell-input')
    if (!input) throw new Error('Table cell editor was not mounted')
    await act(async () => {
      input.value = 'Mapped'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(changes.at(-1)).toBe(
      'prefix\nintro\n\n| A | B |\n| --- | --- |\n| C | Mapped |',
    )
  })

  test('reveals table Markdown only through the source control', async () => {
    const source = '| A | B |\n| --- | --- |\n| C | D |'
    const { container } = await renderEditor(source, 1)
    const sourceButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit table Markdown"]',
    )
    if (!sourceButton) throw new Error('Table source control was not rendered')

    await act(async () => sourceButton.click())

    expect(container.querySelector('.cm-table-preview')).toBeNull()
    expect(container.querySelector('.cm-content')?.textContent).toContain('| A | B |')
  })

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

    const view = EditorView.findFromDOM(content)
    await act(async () => {
      editor.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
      }))
      view.contentDOM.blur()
      view.dispatch({ selection: { anchor: 0 } })
    })
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
    const source = 'Heading\n---\n\\*literal\\*\n```ts title="Example"\nconst value = 1\n```\n***\ntail'
    const { container } = await renderEditor(source, 1)
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')

    expect(content.textContent).not.toContain('---')
    expect(content.textContent).not.toContain('```')
    expect(content.textContent).not.toContain('title="Example"')
    expect(content.textContent).toContain('*literal*')
    expect(container.querySelector('.cm-code-language')?.textContent).toBe('ts')
    expect(container.querySelector('.cm-thematic-break')).not.toBeNull()
    expect(container.querySelectorAll('.cm-fenced-code-background')).toHaveLength(3)

    const view = EditorView.findFromDOM(content)
    view.contentDOM.blur()
    const codePosition = source.indexOf('const')
    await act(async () => view.dispatch({ selection: { anchor: codePosition } }))
    expect(container.querySelector('.cm-code-language')).toBeNull()
    expect(content.textContent).toContain('```ts title="Example"')
    expect(content.textContent).toContain('```')
  })

  test('highlights recognized fenced languages and aliases with semantic classes', async () => {
    const source = [
      '**prose**',
      '```ts',
      'const shortAlias = "short"',
      '```',
      '```typescript',
      'function longAlias(value: number) { return value + 1 }',
      '```',
      '```rust',
      'fn rust_example() { let value = 2; }',
      '```',
      '```json',
      '{"enabled": true, "count": 3}',
      '```',
    ].join('\n')
    const { container } = await renderEditor(source, 1)
    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')
    const view = EditorView.findFromDOM(content)
    await act(async () => view.dispatch({ selection: { anchor: 0 } }))

    await waitForEditorState(() => {
      const shortAlias = fencedLineContaining(container, 'shortAlias')
      const longAlias = fencedLineContaining(container, 'longAlias')
      const rust = fencedLineContaining(container, 'rust_example')
      const json = fencedLineContaining(container, 'enabled')
      return Boolean(
        shortAlias?.querySelector('.cm-code-keyword')
        && shortAlias.querySelector('.cm-code-string')
        && longAlias?.querySelector('.cm-code-function')
        && rust?.querySelector('.cm-code-keyword')
        && json?.querySelector('.cm-code-property')
        && json.querySelector('.cm-code-value'),
      )
    })

    expect(container.querySelector('.cm-strong')).not.toBeNull()
    expect(container.querySelector('.cm-strong')?.closest('.cm-fenced-code-line')).toBeNull()
    expect(
      [...container.querySelectorAll('.cm-code-language')].map((label) => label.textContent),
    ).toEqual(['ts', 'typescript', 'rust', 'json'])

    await act(async () => view.dispatch({
      selection: { anchor: source.indexOf('shortAlias') },
    }))

    expect(content.textContent).toContain('```ts')
    expect(container.querySelectorAll('.cm-code-language')).toHaveLength(3)
    expect(fencedLineContaining(container, 'shortAlias')?.querySelector('.cm-code-keyword'))
      .not.toBeNull()
  })

  test('leaves unknown and unlabeled fenced languages as plain code', async () => {
    const source = [
      '```unknown-language',
      'unknown_token = 1',
      '```',
      '```',
      'unlabeled_token = 2',
      '```',
    ].join('\n')
    const { container } = await renderEditor(source, 1)

    const unknown = fencedLineContaining(container, 'unknown_token')
    const unlabeled = fencedLineContaining(container, 'unlabeled_token')
    expect(unknown).not.toBeUndefined()
    expect(unlabeled).not.toBeUndefined()
    expect(container.querySelector('.cm-code-language')?.textContent).toBe('unknown-language')
    expect(unknown?.querySelector('[class*="cm-code-"]:not(.cm-code-language)')).toBeNull()
    expect(unlabeled?.querySelector('[class*="cm-code-"]')).toBeNull()
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
    const distantContent = [
      paragraphs,
      '**target** tail',
      '| Name | Value |\n| --- | --- |\n| Calm | Notes |',
      'final paragraph',
    ].join('\n\n')
    const { container } = await renderEditor(distantContent, 1)
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

    const content = container.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('CodeMirror content was not mounted')
    const view = EditorView.findFromDOM(content)
    await act(async () => view.dispatch({
      effects: EditorView.scrollIntoView(distantContent.indexOf('| Name'), { y: 'center' }),
    }))
    await waitForEditorState(() => container.querySelector('.cm-table-preview') !== null)

    expect(editor.classList.contains('cm-live-preview-pending')).toBe(false)
    expect(container.querySelector('.cm-table-preview')?.textContent).toContain('Calm')
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
