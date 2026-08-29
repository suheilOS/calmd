import { createContext, use } from 'react'

export type InsertImageAction = (() => void) | null

export type EditorChromeContextValue = {
  insertImage: InsertImageAction
  registerInsertImage: (action: InsertImageAction) => void
}

export const EditorChromeContext = createContext<EditorChromeContextValue | null>(null)

export function useEditorChrome() {
  const editorChrome = use(EditorChromeContext)
  if (!editorChrome) throw new Error('Editor chrome requires an EditorChromeProvider.')
  return editorChrome
}
