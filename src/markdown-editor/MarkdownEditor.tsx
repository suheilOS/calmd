import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  type Ref,
} from 'react'
import type {
  FormattingToolbarSnapshot,
  MarkdownEditorCommands,
  MarkdownEditorInput,
} from './contracts'
import { FormattingToolbar } from './FormattingToolbar'
import {
  initialFormattingToolbarState,
  reduceFormattingToolbarState,
} from './formattingToolbarState'
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
  const [formattingToolbar, dispatchFormattingToolbar] = useReducer(
    reduceFormattingToolbarState,
    initialFormattingToolbarState,
  )

  const handleFormattingChange = useCallback((snapshot: FormattingToolbarSnapshot | null) => {
    dispatchFormattingToolbar({ type: 'snapshot', snapshot })
  }, [])

  const requestToolbarFocus = useCallback((snapshot: FormattingToolbarSnapshot) => {
    dispatchFormattingToolbar({ type: 'request-focus', snapshot })
  }, [])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const session = createMarkdownEditorSession(container, {
      ...initialInputRef.current,
      onFormattingToolbarChange: handleFormattingChange,
      onFormattingToolbarFocusRequest: requestToolbarFocus,
    })
    sessionRef.current = session
    return () => {
      session.destroy()
      sessionRef.current = null
    }
  }, [handleFormattingChange, requestToolbarFocus])

  useLayoutEffect(() => {
    sessionRef.current?.update(input)
  })

  useImperativeHandle(ref, (): MarkdownEditorCommands => ({
    applyBlock: (kind) => sessionRef.current?.commands.applyBlock(kind),
    focus: () => sessionRef.current?.commands.focus(),
    focusAtEnd: () => sessionRef.current?.commands.focusAtEnd(),
    insertImage: () => sessionRef.current?.commands.insertImage(),
    toggleInline: (format) => sessionRef.current?.commands.toggleInline(format),
  }), [])

  return (
    <>
      <div className="markdown-editor" ref={containerRef} />
      {formattingToolbar.kind === 'visible' ? (
        <FormattingToolbar
          focusRequested={formattingToolbar.focusRequested}
          onBlockChange={(kind) => sessionRef.current?.commands.applyBlock(kind)}
          onDismiss={() => dispatchFormattingToolbar({ type: 'dismiss' })}
          onFocusHandled={() => dispatchFormattingToolbar({ type: 'focus-handled' })}
          onInlineChange={(format) => sessionRef.current?.commands.toggleInline(format)}
          onReturnFocus={() => sessionRef.current?.commands.focus()}
          snapshot={formattingToolbar.snapshot}
        />
      ) : null}
    </>
  )
}

export type {
  MarkdownEditorCommands,
  WikiLinkActivation,
} from './contracts'
