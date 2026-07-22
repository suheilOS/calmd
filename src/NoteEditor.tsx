import { Button } from '@base-ui/react/button'
import { Input } from '@base-ui/react/input'
import { BacklinksPopover } from './BacklinksPopover'
import type { NoteDraft } from './notes'

type NoteEditorProps = {
  draft: NoteDraft
  backlinksOpen: boolean
  onDraftChange: (draft: NoteDraft) => void
  onBacklinksOpenChange: (open: boolean) => void
  onReturn: () => void
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
}: NoteEditorProps) {
  return (
    <main className="app min-h-screen bg-canvas text-ink">
      <Button
        aria-label="Return to composer"
        className="fixed left-5 top-5 z-10 inline-flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint sm:left-8 sm:top-8"
        onClick={onReturn}
        type="button"
      >
        <ArrowLeftIcon />
      </Button>

      <article className="mx-auto w-full max-w-[65ch] px-6 pb-24 pt-[15vh] sm:px-8">
        <label className="sr-only" htmlFor="note-title">Note title</label>
        <Input
          aria-label="Note title"
          className="w-full border-0 bg-transparent p-0 text-large text-ink outline-none placeholder:text-placeholder"
          id="note-title"
          onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
          value={draft.title}
        />
        <label className="sr-only" htmlFor="note-body">Note content</label>
        <textarea
          aria-label="Note content"
          className="mt-6 min-h-[58vh] w-full max-w-[65ch] resize-none border-0 bg-transparent p-0 text-base text-body text-pretty outline-none placeholder:text-placeholder sm:mt-8"
          id="note-body"
          onChange={(event) => onDraftChange({ ...draft, body: event.target.value })}
          placeholder=""
          value={draft.body}
        />
      </article>

      <BacklinksPopover
        onOpenChange={onBacklinksOpenChange}
        open={backlinksOpen}
      />
    </main>
  )
}
