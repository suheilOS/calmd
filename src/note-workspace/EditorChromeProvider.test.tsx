import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorChromeProvider } from './EditorChromeProvider'
import { useEditorChrome } from './editorChromeContext'

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

describe('EditorChromeProvider', () => {
  test('shares only the registered image action with title-bar controls', async () => {
    let calls = 0

    function Harness() {
      const { insertImage, registerInsertImage } = useEditorChrome()
      return (
        <>
          <button onClick={() => registerInsertImage(() => { calls += 1 })} type="button">
            Register
          </button>
          <button disabled={!insertImage} onClick={() => insertImage?.()} type="button">
            Insert
          </button>
        </>
      )
    }

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<EditorChromeProvider><Harness /></EditorChromeProvider>))
    const buttons = container.querySelectorAll('button')

    expect(buttons[1]?.disabled).toBe(true)
    await act(async () => buttons[0]?.click())
    expect(buttons[1]?.disabled).toBe(false)
    await act(async () => buttons[1]?.click())
    expect(calls).toBe(1)
  })
})
