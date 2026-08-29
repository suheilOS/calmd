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
        <NotePreviewContent excerpt={'# عنوان عربي\n\nفقرة عربية مع **Markdown**.\n\n- بند عربي\n\n> اقتباس عربي\n\n`const قيمة = 42`\n\n```text\nقيمة = 42\n```\n\n| الاسم | Value |\n| --- | --- |\n| عربي | 42 |'} />,
      )
    })

    expect(container.querySelector('h1')?.dir).toBe('auto')
    expect(container.querySelector('p')?.dir).toBe('auto')
    expect(container.querySelector('li')?.dir).toBe('auto')
    expect(container.querySelector('blockquote')?.dir).toBe('auto')
    expect(container.querySelector('td')?.dir).toBe('auto')
    expect(container.querySelector('pre')?.dir).toBe('ltr')
    expect(container.querySelector('p > code')?.dir).toBe('ltr')
  })
})
