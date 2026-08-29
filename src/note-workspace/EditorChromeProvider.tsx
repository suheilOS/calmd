import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  EditorChromeContext,
  type InsertImageAction,
} from './editorChromeContext'

export function EditorChromeProvider({ children }: { children: ReactNode }) {
  const [insertImage, setInsertImage] = useState<InsertImageAction>(null)
  const registerInsertImage = useCallback((action: InsertImageAction) => {
    setInsertImage(() => action)
  }, [])
  const value = useMemo(() => ({ insertImage, registerInsertImage }), [
    insertImage,
    registerInsertImage,
  ])

  return <EditorChromeContext value={value}>{children}</EditorChromeContext>
}
