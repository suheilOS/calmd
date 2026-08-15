import { Button } from '@base-ui/react/button'
import { Dialog } from '@base-ui/react/dialog'
import { Menu } from '@base-ui/react/menu'
import type { ReactNode } from 'react'
import { MoreVerticalIcon } from '../MoreVerticalIcon'

type NoteActionsProps = {
  deleteOpen: boolean
  deleting: boolean
  dialogs?: ReactNode
  menuItems?: ReactNode
  onDeleteOpenChange: (open: boolean) => void
  onDelete: () => void
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
      <path d="M3 4.5h10v9H3zM1.5 3h13M6 3V1.5h4V3M6 6.5v4M10 6.5v4" />
    </svg>
  )
}

const actionClassName =
  'inline-flex size-10 items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-faint active:scale-[0.96] disabled:cursor-not-allowed disabled:text-faint disabled:active:scale-100'

export function NoteActions({
  deleteOpen,
  deleting,
  dialogs,
  menuItems,
  onDeleteOpenChange,
  onDelete,
}: NoteActionsProps) {
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label="Note actions"
          className={actionClassName}
          disabled={deleting}
        >
          <MoreVerticalIcon />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" className="z-40" side="bottom" sideOffset={6}>
            <Menu.Popup className="w-44 rounded-xl bg-surface p-1.5 text-small text-ink shadow-[0_8px_24px_oklch(0_0_0/0.18)] outline-none">
              {menuItems}
              {menuItems ? <Menu.Separator className="mx-2 my-1 h-px bg-divider" /> : null}
              <Menu.Item
                className="flex h-10 cursor-default select-none items-center gap-2 rounded-lg px-3 text-danger outline-none data-[highlighted]:bg-danger-surface data-[highlighted]:text-danger-ink"
                onClick={() => onDeleteOpenChange(true)}
              >
                <TrashIcon />
                <span>Delete note</span>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {dialogs}

      <Dialog.Root
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleting) onDeleteOpenChange(open)
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-150 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <Dialog.Popup className="w-full max-w-sm rounded-2xl bg-surface p-6 text-ink shadow-[0_16px_48px_oklch(0_0_0/0.24)] outline-none transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              <Dialog.Title className="text-base font-semibold tracking-[-0.02em]">
                Delete this note?
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-pretty text-small leading-relaxed text-secondary">
                This permanently deletes the note from your vault. Links to it in other notes will remain.
              </Dialog.Description>
              <div className="mt-6 flex justify-end gap-2">
                <Dialog.Close
                  autoFocus
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-hover px-4 text-small text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96] disabled:cursor-not-allowed disabled:text-faint"
                  disabled={deleting}
                >
                  Cancel
                </Dialog.Close>
                <Button
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-red-500 px-4 text-small text-white transition-[background-color,transform] duration-150 ease-out hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
                  disabled={deleting}
                  onClick={onDelete}
                  type="button"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

    </>
  )
}
