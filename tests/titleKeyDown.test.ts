import { describe, expect, test } from 'bun:test'
import type { MarkdownEditorCommands } from '../src/markdown-editor/contracts'
import { handleTitleKeyDown } from '../src/titleKeyDown'

function titleKeyEvent(key: string, isComposing = false) {
  let prevented = false
  return {
    event: {
      key,
      isComposing,
      preventDefault: () => { prevented = true },
    },
    wasPrevented: () => prevented,
  }
}

describe('handleTitleKeyDown', () => {
  test('prevents Enter and focuses the body at its end', () => {
    const keyEvent = titleKeyEvent('Enter')
    let focusAtEndCalls = 0
    const bodyEditor: MarkdownEditorCommands = {
      applyBlock: () => {},
      focusAtEnd: () => { focusAtEndCalls += 1 },
    }

    handleTitleKeyDown(keyEvent.event, bodyEditor)

    expect(keyEvent.wasPrevented()).toBe(true)
    expect(focusAtEndCalls).toBe(1)
  })

  test('leaves composing Enter and other keys untouched', () => {
    const composingEnter = titleKeyEvent('Enter', true)
    const otherKey = titleKeyEvent('ArrowDown')
    let focusAtEndCalls = 0
    const bodyEditor: MarkdownEditorCommands = {
      applyBlock: () => {},
      focusAtEnd: () => { focusAtEndCalls += 1 },
    }

    handleTitleKeyDown(composingEnter.event, bodyEditor)
    handleTitleKeyDown(otherKey.event, bodyEditor)

    expect(composingEnter.wasPrevented()).toBe(false)
    expect(otherKey.wasPrevented()).toBe(false)
    expect(focusAtEndCalls).toBe(0)
  })
})
