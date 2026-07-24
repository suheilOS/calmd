import { Popover } from '@base-ui/react/popover'
import { useEffect, useRef, useState } from 'react'
import type { Backlink } from './notes'
import { getStorageError, getStoredBacklinks } from './storage'

type BacklinksPopoverProps = {
  noteKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (key: string) => void
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

export function BacklinksPopover({ noteKey, open, onOpenChange, onSelect }: BacklinksPopoverProps) {
  const [backlinks, setBacklinks] = useState<Backlink[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestGenerationRef = useRef(0)

  useEffect(() => {
    if (!open) requestGenerationRef.current += 1
  }, [noteKey, open])

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    const generation = ++requestGenerationRef.current
    if (!nextOpen) return
    setBacklinks(null)
    setError(null)
    void getStoredBacklinks(noteKey).then(
      (links) => {
        if (requestGenerationRef.current === generation) setBacklinks(links)
      },
      (reason) => {
        if (requestGenerationRef.current === generation) {
          setError(getStorageError(reason).message)
        }
      },
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger aria-label="Show backlinks" className="fixed bottom-5 right-5 z-10 inline-flex size-9 items-center justify-center rounded-xl bg-surface text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.97] sm:bottom-8 sm:right-8">
        <InfoIcon />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" positionMethod="fixed" side="top" sideOffset={8}>
          <Popover.Popup className="backlinks-popover w-64 max-w-[calc(100vw-2.5rem)] rounded-xl bg-surface p-2 text-ink shadow-[0_8px_24px_oklch(0_0_0/0.18)] outline-none">
            {error ? <p className="p-2 text-small text-secondary" role="alert">{error}</p> : backlinks === null ? (
              <p className="p-2 text-small text-secondary">Loading…</p>
            ) : backlinks.length === 0 ? (
              <p className="p-2 text-small text-secondary">No backlinks</p>
            ) : backlinks.map((link) => (
              <button className="block min-h-10 w-full rounded-lg px-3 py-2 text-left text-small hover:bg-hover focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-faint" key={link.key} onClick={() => onSelect(link.key)} type="button">
                {link.title}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
