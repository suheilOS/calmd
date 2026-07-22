import { Popover } from '@base-ui/react/popover'

type BacklinksPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
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

export function BacklinksPopover({ open, onOpenChange }: BacklinksPopoverProps) {
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
          <Popover.Popup className="backlinks-popover w-64 max-w-[calc(100vw-2.5rem)] rounded-lg bg-surface p-4 text-ink shadow-[0_8px_24px_oklch(0_0_0/0.08)] outline-none">
            <p className="text-small text-faint">No backlinks</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
