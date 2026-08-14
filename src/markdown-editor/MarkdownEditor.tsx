import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import type {
  MarkdownEditorCommands,
  MarkdownEditorInput,
} from './contracts'
import {
  createMarkdownEditorSession,
  type MarkdownEditorSession,
} from './session'

export type MarkdownEditorProps = MarkdownEditorInput & {
  ref?: Ref<MarkdownEditorCommands>
}

/** React mount adapter for the framework-neutral CodeMirror document session. */
export function MarkdownEditor({ ref, ...input }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<MarkdownEditorSession>(null)
  const initialInputRef = useRef<MarkdownEditorInput>(input)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const session = createMarkdownEditorSession(container, initialInputRef.current)
    sessionRef.current = session
    return () => {
      session.destroy()
      sessionRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    sessionRef.current?.update(input)
  })

  useImperativeHandle(ref, (): MarkdownEditorCommands => ({
    applyBlock: (kind) => sessionRef.current?.commands.applyBlock(kind),
    focusAtEnd: () => sessionRef.current?.commands.focusAtEnd(),
    insertImage: () => sessionRef.current?.commands.insertImage(),
  }), [])

  return <div className="markdown-editor" ref={containerRef} />
}

export type {
  MarkdownEditorCommands,
  WikiLinkActivation,
} from './contracts'
