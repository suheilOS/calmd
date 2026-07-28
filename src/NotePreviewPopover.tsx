import { Popover } from '@base-ui/react/popover'
import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import type { NoteDraft } from './notes'
import {
  isPlatformPrimaryModifier,
  navigationPlatform,
  NotePreviewController,
  previewFromDraft,
} from './notePreview'

const NotePreviewContent = lazy(() => import('./NotePreviewContent'))

type NotePreviewPopoverProps = {
  controller: NotePreviewController
  currentDraft: NoteDraft
  currentNoteKey: string
}

export function NotePreviewPopover({
  controller,
  currentDraft,
  currentNoteKey,
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
      controller.setModifierHeld(false)
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
          align="start"
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
            className="note-preview-popover w-[26rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl bg-surface text-ink shadow-[0_12px_36px_oklch(0_0_0/0.22)] outline-none"
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
                  <Popover.Title className="text-base font-semibold leading-tight tracking-[-0.02em]">
                    {preview.title}
                  </Popover.Title>
                  <div className="note-preview-content mt-3 text-small text-secondary">
                    {preview.excerpt.trim() ? (
                      <Suspense fallback={<p>Loading…</p>}>
                        <NotePreviewContent excerpt={preview.excerpt} />
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
