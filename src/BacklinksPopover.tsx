import { Popover } from '@base-ui/react/popover'
import { Tooltip } from '@base-ui/react/tooltip'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { NoteReference, UnlinkedMention } from './notes'
import type { NotePreviewCandidate } from './notePreview'
import {
  getStorageError,
  getStoredBacklinks,
  getStoredUnlinkedMentions,
} from './storage'

type BacklinksPopoverProps = {
  noteKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPreviewCandidateEnter: (candidate: NotePreviewCandidate) => void
  onPreviewCandidateLeave: () => void
  onPreviewDismiss: () => void
  onSelect: (key: string) => void
}

type LinkButtonProps = {
  children: ReactNode
  id: string
  note: NoteReference
  onPreviewCandidateEnter: (candidate: NotePreviewCandidate) => void
  onPreviewCandidateLeave: () => void
  onPreviewDismiss: () => void
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

function LinkButton({
  children,
  id,
  note,
  onPreviewCandidateEnter,
  onPreviewCandidateLeave,
  onPreviewDismiss,
  onSelect,
}: LinkButtonProps) {
  return (
    <button
      className="block min-h-10 w-full select-none rounded-lg px-2 py-2 text-left text-small transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-faint active:scale-[0.96]"
      onClick={() => onSelect(note.key)}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return
        onPreviewCandidateEnter({
          source: 'backlink',
          id,
          key: note.key,
          anchor: event.currentTarget,
        })
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') onPreviewCandidateLeave()
      }}
      onPointerDown={onPreviewDismiss}
      type="button"
    >
      {children}
    </button>
  )
}

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

function highlightedExcerpt(mention: UnlinkedMention) {
  return (
    <>
      {mention.excerpt.slice(0, mention.matchStart)}
      <mark className="bg-active text-inherit">
        {mention.excerpt.slice(mention.matchStart, mention.matchEnd)}
      </mark>
      {mention.excerpt.slice(mention.matchEnd)}
    </>
  )
}

export function BacklinksPopover({
  noteKey,
  open,
  onOpenChange,
  onPreviewCandidateEnter,
  onPreviewCandidateLeave,
  onPreviewDismiss,
  onSelect,
}: BacklinksPopoverProps) {
  const [backlinks, setBacklinks] = useState<LoadState<NoteReference[]>>({ status: 'loading' })
  const [mentions, setMentions] = useState<LoadState<UnlinkedMention[]>>({ status: 'loading' })
  const requestGenerationRef = useRef(0)
  const noteKeyRef = useRef(noteKey)

  useEffect(() => {
    if (noteKeyRef.current !== noteKey) {
      noteKeyRef.current = noteKey
      requestGenerationRef.current += 1
    }
    if (!open) requestGenerationRef.current += 1
  }, [noteKey, open])

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    const generation = ++requestGenerationRef.current
    if (!nextOpen) return

    setBacklinks({ status: 'loading' })
    setMentions({ status: 'loading' })
    void getStoredBacklinks(noteKey).then(
      (data) => {
        if (requestGenerationRef.current === generation) {
          setBacklinks({ status: 'ready', data })
        }
      },
      (reason) => {
        if (requestGenerationRef.current === generation) {
          setBacklinks({ status: 'error', message: getStorageError(reason).message })
        }
      },
    )
    void getStoredUnlinkedMentions(noteKey).then(
      (data) => {
        if (requestGenerationRef.current === generation) {
          setMentions({ status: 'ready', data })
        }
      },
      (reason) => {
        if (requestGenerationRef.current === generation) {
          setMentions({ status: 'error', message: getStorageError(reason).message })
        }
      },
    )
  }

  const hasNoLinksOrMentions = backlinks.status === 'ready'
    && mentions.status === 'ready'
    && backlinks.data.length === 0
    && mentions.data.length === 0

  const buttonProps = {
    onPreviewCandidateEnter,
    onPreviewCandidateLeave,
    onPreviewDismiss,
    onSelect,
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Tooltip.Root>
        <Tooltip.Trigger
          delay={500}
          render={(
            <Popover.Trigger aria-label="Show links and mentions" className="fixed bottom-5 right-5 z-10 inline-flex size-10 items-center justify-center rounded-xl bg-surface text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96] sm:bottom-8 sm:right-8">
              <InfoIcon />
            </Popover.Trigger>
          )}
        />
        <Tooltip.Portal>
          <Tooltip.Positioner className="z-50" side="top" sideOffset={6}>
            <Tooltip.Popup className="origin-[var(--transform-origin)] rounded-lg bg-surface px-2 py-1 text-small text-ink shadow-[0_4px_12px_oklch(0_0_0/0.16)] transition-[opacity,scale] duration-100 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              Links
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      <Popover.Portal>
        <Popover.Positioner align="end" positionMethod="fixed" side="top" sideOffset={8}>
          <Popover.Popup className="backlinks-popover max-h-[min(28rem,calc(100vh-5rem))] w-72 max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-2xl bg-surface p-2 text-ink shadow-[0_8px_24px_oklch(0_0_0/0.18)] outline-none">
            {hasNoLinksOrMentions ? (
              <p className="px-2 py-2 text-small leading-normal text-secondary">No links or mentions</p>
            ) : (
              <>
                <section aria-labelledby="backlinks-heading">
                  <h2 className="px-2 py-1 text-small font-medium leading-snug text-secondary" id="backlinks-heading">Backlinks</h2>
                  {backlinks.status === 'error' ? <p className="px-2 py-2 text-small leading-normal text-secondary" role="alert">Could not load backlinks: {backlinks.message}</p> : backlinks.status === 'loading' ? (
                    <p className="px-2 py-2 text-small leading-normal text-secondary">Loading backlinks…</p>
                  ) : backlinks.data.length === 0 ? (
                    <p className="px-2 py-2 text-small leading-normal text-secondary">No backlinks</p>
                  ) : backlinks.data.map((link) => (
                    <LinkButton {...buttonProps} id={`backlink:${link.key}`} key={link.key} note={link}>
                      <span className="block break-words font-medium leading-snug text-pretty text-ink">{link.title}</span>
                    </LinkButton>
                  ))}
                </section>
                <section aria-labelledby="mentions-heading" className="mt-2 border-t border-divider pt-2">
                  <h2 className="px-2 py-1 text-small font-medium leading-snug text-secondary" id="mentions-heading">Unlinked mentions</h2>
                  {mentions.status === 'error' ? <p className="px-2 py-2 text-small leading-normal text-secondary" role="alert">Could not load unlinked mentions: {mentions.message}</p> : mentions.status === 'loading' ? (
                    <p className="px-2 py-2 text-small leading-normal text-secondary">Loading unlinked mentions…</p>
                  ) : mentions.data.length === 0 ? (
                    <p className="px-2 py-2 text-small leading-normal text-secondary">No unlinked mentions</p>
                  ) : mentions.data.map((mention) => (
                    <LinkButton {...buttonProps} id={`unlinked-mention:${mention.key}`} key={mention.key} note={mention}>
                      <span className="block break-words font-medium leading-snug text-pretty text-ink">{mention.title}</span>
                      <span className="mt-1.5 block line-clamp-3 break-words leading-normal text-secondary">
                        {highlightedExcerpt(mention)}
                      </span>
                    </LinkButton>
                  ))}
                </section>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
