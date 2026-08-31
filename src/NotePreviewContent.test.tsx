import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import NotePreviewContent from './NotePreviewContent'

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

const roots: Root[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

describe('NotePreviewContent direction boundaries', () => {
  test('auto-directs prose blocks and keeps code isolated as LTR', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <NotePreviewContent
          excerpt={'# عنوان عربي\n\nفقرة عربية مع **Markdown**.\n\n- بند عربي\n\n1. بند مرقم\n\n> اقتباس عربي\n\n`const قيمة = 42`\n\n```text\nقيمة = 42\n```\n\n| الاسم | Value |\n| --- | --- |\n| عربي | 42 |'}
          onOpenExternalLink={() => {}}
          onOpenWikiLink={() => {}}
        />,
      )
    })

    expect(container.querySelector('h1')?.dir).toBe('auto')
    expect(container.querySelector('p')?.dir).toBe('auto')
    expect(container.querySelector('ul')?.dir).toBe('auto')
    expect(container.querySelector('ol')?.dir).toBe('auto')
    expect(container.querySelector('li')?.dir).toBe('auto')
    expect(container.querySelector('blockquote')?.dir).toBe('auto')
    expect(container.querySelector('td')?.dir).toBe('auto')
    expect(container.querySelector('pre')?.dir).toBe('ltr')
    expect(container.querySelector('p > code')?.dir).toBe('ltr')
  })

  test('renders wiki links and HTTP links as working anchors without parsing code', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    const openedWikiLinks: string[] = []
    const openedExternalLinks: string[] = []

    await act(async () => {
      root.render(
        <NotePreviewContent
          excerpt={'[[Target|Visible note]] and https://example.com/docs and `[[Code]]` and [Not internal](calmd-wiki:Secret) and ![[Image]]'}
          onOpenExternalLink={(url) => openedExternalLinks.push(url)}
          onOpenWikiLink={(target) => openedWikiLinks.push(target)}
        />,
      )
    })

    const links = container.querySelectorAll<HTMLAnchorElement>('a')
    expect(links).toHaveLength(2)
    expect(links[0]?.textContent).toBe('Visible note')
    expect(container.querySelector('code')?.textContent).toBe('[[Code]]')
    expect(container.textContent).toContain('Not internal')
    expect(container.textContent).toContain('![[Image]]')

    links[0]?.click()
    links[1]?.click()
    expect(openedWikiLinks).toEqual(['Target'])
    expect(openedExternalLinks).toEqual(['https://example.com/docs'])
  })
})
