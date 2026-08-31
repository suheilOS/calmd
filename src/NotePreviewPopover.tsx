import { Popover } from '@base-ui/react/popover'
import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import type { NoteDraft } from './notes'
import { isPlatformPrimaryModifier, navigationPlatform } from './navigation'
import {
  NotePreviewController,
  previewFromDraft,
} from './notePreview'

const NotePreviewContent = lazy(() => import('./NotePreviewContent'))

type NotePreviewPopoverProps = {
  controller: NotePreviewController
  currentDraft: NoteDraft
  currentNoteKey: string
  onOpenExternalLink: (url: string) => void
  onOpenWikiLink: (target: string) => void
}

export function NotePreviewPopover({
  controller,
  currentDraft,
  currentNoteKey,
  onOpenExternalLink,
  onOpenWikiLink,
}: NotePreviewPopoverProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  )

  useEffect(() => {
    function updateModifier(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        controller.dismiss()
        return
      }
      controller.setModifierHeld(
        isPlatformPrimaryModifier(navigationPlatform(), event),
      )
    }

    function handleBlur() {
      controller.resetOnBlur()
    }

    window.addEventListener('keydown', updateModifier)
    window.addEventListener('keyup', updateModifier)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', updateModifier)
      window.removeEventListener('keyup', updateModifier)
      window.removeEventListener('blur', handleBlur)
    }
  }, [controller])

  const open = state.status === 'loading'
    || state.status === 'visible'
    || state.status === 'error'
  const candidate = state.status === 'idle' ? null : state.candidate
  const storedPreview = state.status === 'visible' ? state.preview : null
  const preview = storedPreview?.key === currentNoteKey
    ? previewFromDraft(currentNoteKey, currentDraft)
    : storedPreview
  const alignment = candidate?.source === 'backlink' ? 'end' : 'start'

  return (
    <Popover.Root
      modal={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) controller.dismiss()
      }}
      open={open}
    >
      <Popover.Portal>
        <Popover.Positioner
          align={alignment}
          anchor={candidate?.anchor ?? null}
          className="z-40"
          collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'end' }}
          collisionPadding={12}
          positionMethod="fixed"
          side="bottom"
          sideOffset={8}
        >
          <Popover.Popup
            aria-label="Note preview"
            className="note-preview-popover w-[24rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-surface text-ink shadow-[0_16px_40px_rgb(0_0_0/0.22)] outline-none"
            finalFocus={false}
            initialFocus={false}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') controller.enterPreview()
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') controller.leavePreview()
            }}
          >
            <div className="max-h-[min(22rem,60vh)] overflow-y-auto px-5 py-4">
              {state.status === 'loading' ? (
                <p className="text-small text-secondary">Loading…</p>
              ) : state.status === 'error' ? (
                <p className="text-small text-secondary" role="status">{state.message}</p>
              ) : preview ? (
                <>
                  <Popover.Title className="text-base font-semibold leading-tight tracking-[-0.02em]" dir="auto">
                    {preview.title}
                  </Popover.Title>
                  <div className="note-preview-content mt-3 text-small text-secondary">
                    {preview.excerpt.trim() ? (
                      <Suspense fallback={<p>Loading…</p>}>
                        <NotePreviewContent
                          excerpt={preview.excerpt}
                          onOpenExternalLink={(url) => {
                            controller.dismiss()
                            onOpenExternalLink(url)
                          }}
                          onOpenWikiLink={(target) => {
                            controller.dismiss()
                            onOpenWikiLink(target)
                          }}
                        />
                      </Suspense>
                    ) : <p className="italic text-faint">Empty note</p>}
                  </div>
                  {preview.truncated ? (
                    <p className="mt-4 text-small text-faint">Open note to continue</p>
                  ) : null}
                </>
              ) : null}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
