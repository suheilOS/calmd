import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FormattingToolbarSnapshot } from './contracts'

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

const snapshot: FormattingToolbarSnapshot = {
  anchor: { height: 20, width: 0, x: 160, y: 120 },
  blockKind: 'paragraph',
  formats: {
    bold: 'active',
    code: 'inactive',
    highlight: 'mixed',
    italic: 'inactive',
    link: 'unavailable',
    strikethrough: 'inactive',
  },
  selectionRevision: 1,
}

describe('FormattingToolbar', () => {
  test('renders selection state and runs available inline actions', async () => {
    const { FormattingToolbar } = await import('./FormattingToolbar')
    const formats: string[] = []
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => root.render(
      <FormattingToolbar
        focusRequested={false}
        onBlockChange={() => {}}
        onDismiss={() => {}}
        onFocusHandled={() => {}}
        onInlineChange={(format) => formats.push(format)}
        onReturnFocus={() => {}}
        snapshot={snapshot}
      />,
    ))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

    const toolbar = document.querySelector('[role="toolbar"]')
    const bold = document.querySelector<HTMLButtonElement>('button[aria-label="Bold"]')
    const highlight = document.querySelector<HTMLButtonElement>('button[aria-label="Highlight"]')
    const link = document.querySelector<HTMLButtonElement>('button[aria-label="Link"]')
    expect(toolbar).not.toBeNull()
    expect(bold?.getAttribute('aria-pressed')).toBe('true')
    expect(highlight?.getAttribute('aria-pressed')).toBe('mixed')
    expect(link?.getAttribute('aria-disabled')).toBe('true')

    await act(async () => bold?.click())
    expect(formats).toEqual(['bold'])
  })
})
