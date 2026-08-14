import type { MarkdownEditorCommands } from './markdown-editor/contracts'

type TitleKeyEvent = {
  key: string
  isComposing: boolean
  preventDefault: () => void
}

export function handleTitleKeyDown(
  event: TitleKeyEvent,
  bodyEditor: MarkdownEditorCommands | null,
) {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  bodyEditor?.focusAtEnd()
}
