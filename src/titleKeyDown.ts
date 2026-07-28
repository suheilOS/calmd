import type { MarkdownEditorHandle } from './MarkdownEditor'

type TitleKeyEvent = {
  key: string
  isComposing: boolean
  preventDefault: () => void
}

export function handleTitleKeyDown(
  event: TitleKeyEvent,
  bodyEditor: MarkdownEditorHandle | null,
) {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  bodyEditor?.focusAtEnd()
}
