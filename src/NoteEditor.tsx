import { Button } from '@base-ui/react/button'
import { lazy, Suspense } from 'react'
import { BacklinksPopover } from './BacklinksPopover'
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
  backlinksOpen: boolean
  onDraftChange: (draft: NoteDraft) => void
  onBacklinksOpenChange: (open: boolean) => void
  onReturn: () => void
  saveMessage: string | null
}

function ArrowLeftIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 20 20">
      <path d="m11.5 4.5-5.5 5.5 5.5 5.5M6.5 10h9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  )
}

export function NoteEditor({
  draft,
  backlinksOpen,
  onDraftChange,
  onBacklinksOpenChange,
  onReturn,
  saveMessage,
}: NoteEditorProps) {
  return (
    <main className="app min-h-screen bg-canvas text-ink">
      <Button
        aria-label="Return to composer"
        className="fixed left-5 top-5 z-10 inline-flex size-9 items-center justify-center rounded-full text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.97] sm:left-8 sm:top-8"
        onClick={onReturn}
        type="button"
      >
        <ArrowLeftIcon />
      </Button>

      <article className="note-editor-page mx-auto w-full max-w-[65ch] px-6 pb-24 pt-[15vh] sm:px-8">
        <label className="sr-only" htmlFor="note-title">Note title</label>
        <textarea
          aria-label="Note title"
          autoComplete="off"
          className="block w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-large text-ink outline-none break-words placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-faint [field-sizing:content]"
          id="note-title"
          maxLength={MAX_NOTE_TITLE_LENGTH}
          name="title"
          onChange={(event) => onDraftChange({
            ...draft,
            title: constrainNoteTitle(event.target.value),
          })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault()
          }}
          rows={1}
          value={draft.title}
        />
        <div className="mt-6 sm:mt-8">
          <Suspense fallback={<div aria-hidden="true" className="min-h-[58vh]" />}>
            <MarkdownEditor
              onChange={(body) => onDraftChange({ ...draft, body })}
              value={draft.body}
            />
          </Suspense>
        </div>
      </article>

      <BacklinksPopover
        onOpenChange={onBacklinksOpenChange}
        open={backlinksOpen}
      />

      {saveMessage ? (
        <p className="fixed inset-x-16 bottom-6 text-center text-small text-secondary" role="alert">
          {saveMessage}
        </p>
      ) : null}
    </main>
  )
}
