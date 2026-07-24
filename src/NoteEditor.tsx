import { Button } from '@base-ui/react/button'
import { lazy, Suspense, useLayoutEffect, useRef } from 'react'
import { BacklinksPopover } from './BacklinksPopover'
import type { WikiLinkActivation } from './MarkdownEditor'
import {
  constrainNoteTitle,
  MAX_NOTE_TITLE_LENGTH,
  type NoteDraft,
} from './notes'

const MarkdownEditor = lazy(async () => {
  const module = await import('./MarkdownEditor')
  return { default: module.MarkdownEditor }
})

type NoteEditorProps = {
  draft: NoteDraft
  noteKey: string
  backlinksOpen: boolean
  onDraftChange: (draft: NoteDraft) => void
  onBacklinksOpenChange: (open: boolean) => void
  onConflictReload: (() => void) | null
  onWikiLinkActivate: (activation: WikiLinkActivation) => void
  onBacklinkSelect: (key: string) => void
  saveMessage: string | null
}

export function NoteEditor({
  draft,
  noteKey,
  backlinksOpen,
  onDraftChange,
  onBacklinksOpenChange,
  onConflictReload,
  onWikiLinkActivate,
  onBacklinkSelect,
  saveMessage,
}: NoteEditorProps) {
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const titleSelectionRef = useRef({ start: 0, end: 0 })

  useLayoutEffect(() => {
    const title = titleRef.current
    if (!title || document.activeElement !== title) return
    const { start, end } = titleSelectionRef.current
    title.setSelectionRange(
      Math.min(start, draft.title.length),
      Math.min(end, draft.title.length),
    )
  }, [draft.title])

  return (
    <main className="app bg-canvas text-ink">
      <article className="note-editor-page mx-auto w-full max-w-[65ch] px-6 pb-24 pt-[15vh] sm:px-8">
        <label className="sr-only" htmlFor="note-title">Note title</label>
        <textarea
          aria-label="Note title"
          autoComplete="off"
          className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-large text-ink outline-none break-words placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-faint [field-sizing:content]"
          id="note-title"
          maxLength={MAX_NOTE_TITLE_LENGTH}
          name="title"
          onChange={(event) => {
            titleSelectionRef.current = {
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            }
            onDraftChange({
              ...draft,
              title: constrainNoteTitle(event.target.value),
            })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault()
          }}
          onSelect={(event) => {
            titleSelectionRef.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            }
          }}
          ref={titleRef}
          rows={1}
          value={draft.title}
        />
        <div className="mt-6 sm:mt-8">
          <Suspense fallback={<div aria-hidden="true" className="min-h-[58vh]" />}>
            <MarkdownEditor
              onChange={(body) => onDraftChange({ ...draft, body })}
              onWikiLinkActivate={onWikiLinkActivate}
              value={draft.body}
            />
          </Suspense>
        </div>
      </article>

      <BacklinksPopover
        noteKey={noteKey}
        onOpenChange={onBacklinksOpenChange}
        onSelect={onBacklinkSelect}
        open={backlinksOpen}
      />

      {saveMessage ? (
        <div className="fixed inset-x-16 bottom-6 flex items-center justify-center gap-3 text-small text-secondary" role="alert">
          <span>{saveMessage}</span>
          {onConflictReload ? (
            <Button
              className="min-h-10 rounded-lg px-3 text-ink underline decoration-border underline-offset-4 transition-[background-color,transform] duration-150 ease-out hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96]"
              onClick={onConflictReload}
              type="button"
            >
              Reload from disk
            </Button>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}
