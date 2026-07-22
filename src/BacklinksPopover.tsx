import { Button } from '@base-ui/react/button'
import { Popover } from '@base-ui/react/popover'
import type { Note } from './notes'

type BacklinksPopoverProps = {
  backlinks: Note[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onNoteOpen: (note: Note) => void
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="10" cy="6.25" r=".85" fill="currentColor" />
    </svg>
  )
}

export function BacklinksPopover({
  backlinks,
  open,
  onOpenChange,
  onNoteOpen,
}: BacklinksPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label="Show backlinks"
        className="fixed bottom-5 right-5 z-10 inline-flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint sm:bottom-8 sm:right-8"
      >
        <InfoIcon />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" positionMethod="fixed" side="top" sideOffset={8}>
          <Popover.Popup className="backlinks-popover w-64 max-w-[calc(100vw-2.5rem)] rounded-xl border border-border bg-canvas p-4 text-ink shadow-lg outline-none">
            {backlinks.length > 0 ? (
              <>
                <Popover.Title className="mb-3 text-xs font-normal text-faint">Backlinks</Popover.Title>
                <div className="space-y-2">
                  {backlinks.map((note) => (
                    <Button
                      className="block w-full text-left text-sm text-secondary transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-faint"
                      key={note.id}
                      onClick={() => onNoteOpen(note)}
                      type="button"
                    >
                      {note.title}
                    </Button>
                  ))}
                </div>
              </>
            ) : <p className="text-sm text-faint">No backlinks</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
