import { Button } from '@base-ui/react/button'
import { Dialog } from '@base-ui/react/dialog'
import { Menu } from '@base-ui/react/menu'
import type { ReactNode } from 'react'

type NoteActionsProps = {
  deleteOpen: boolean
  deleting: boolean
  dialogs?: ReactNode
  menuItems?: ReactNode
  onDeleteOpenChange: (open: boolean) => void
  onDelete: () => void
}

function MoreVerticalIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path clipRule="evenodd" d="M2.25 12C2.25 10.4812 3.48122 9.25 5 9.25C6.51878 9.25 7.75 10.4812 7.75 12C7.75 13.5188 6.51878 14.75 5 14.75C3.48122 14.75 2.25 13.5188 2.25 12ZM5 10.75C4.30964 10.75 3.75 11.3096 3.75 12C3.75 12.6904 4.30964 13.25 5 13.25C5.69036 13.25 6.25 12.6904 6.25 12C6.25 11.3096 5.69036 10.75 5 10.75Z" fill="currentColor" fillRule="evenodd" />
      <path clipRule="evenodd" d="M9.25 12C9.25 10.4812 10.4812 9.25 12 9.25C13.5188 9.25 14.75 10.4812 14.75 12C14.75 13.5188 13.5188 14.75 12 14.75C10.4812 14.75 9.25 13.5188 9.25 12ZM12 10.75C11.3096 10.75 10.75 11.3096 10.75 12C10.75 12.6904 11.3096 13.25 12 13.25C12.6904 13.25 13.25 12.6904 13.25 12C13.25 11.3096 12.6904 10.75 12 10.75Z" fill="currentColor" fillRule="evenodd" />
      <path clipRule="evenodd" d="M19 9.25C17.4812 9.25 16.25 10.4812 16.25 12C16.25 13.5188 17.4812 14.75 19 14.75C20.5188 14.75 21.75 13.5188 21.75 12C21.75 10.4812 20.5188 9.25 19 9.25ZM17.75 12C17.75 11.3096 18.3096 10.75 19 10.75C19.6904 10.75 20.25 11.3096 20.25 12C20.25 12.6904 19.6904 13.25 19 13.25C18.3096 13.25 17.75 12.6904 17.75 12Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="size-4 shrink-0" fill="none" viewBox="0 0 24 24">
      <path d="M3 6.38597C3 5.90152 3.34538 5.50879 3.77143 5.50879L6.43567 5.50832C6.96502 5.49306 7.43202 5.11033 7.61214 4.54412C7.61688 4.52923 7.62232 4.51087 7.64185 4.44424L7.75665 4.05256C7.8269 3.81241 7.8881 3.60318 7.97375 3.41617C8.31209 2.67736 8.93808 2.16432 9.66147 2.03297C9.84457 1.99972 10.0385 1.99986 10.2611 2.00002H13.7391C13.9617 1.99986 14.1556 1.99972 14.3387 2.03297C15.0621 2.16432 15.6881 2.67736 16.0264 3.41617C16.1121 3.60318 16.1733 3.81241 16.2435 4.05256L16.3583 4.44424C16.3778 4.51087 16.3833 4.52923 16.388 4.54412C16.5682 5.11033 17.1278 5.49353 17.6571 5.50879H20.2286C20.6546 5.50879 21 5.90152 21 6.38597C21 6.87043 20.6546 7.26316 20.2286 7.26316H3.77143C3.34538 7.26316 3 6.87043 3 6.38597Z" fill="currentColor" />
      <path clipRule="evenodd" d="M11.5956 22.0001H12.4044C15.1871 22.0001 16.5785 22.0001 17.4831 21.1142C18.3878 20.2283 18.4803 18.7751 18.6654 15.8686L18.9321 11.6807C19.0326 10.1037 19.0828 9.31524 18.6289 8.81558C18.1751 8.31592 17.4087 8.31592 15.876 8.31592H8.12404C6.59127 8.31592 5.82488 8.31592 5.37105 8.81558C4.91722 9.31524 4.96744 10.1037 5.06788 11.6807L5.33459 15.8686C5.5197 18.7751 5.61225 20.2283 6.51689 21.1142C7.42153 22.0001 8.81289 22.0001 11.5956 22.0001ZM10.2463 12.1886C10.2051 11.7548 9.83753 11.4382 9.42537 11.4816C9.01321 11.525 8.71251 11.9119 8.75372 12.3457L9.25372 17.6089C9.29494 18.0427 9.66247 18.3593 10.0746 18.3159C10.4868 18.2725 10.7875 17.8856 10.7463 17.4518L10.2463 12.1886ZM14.5746 11.4816C14.9868 11.525 15.2875 11.9119 15.2463 12.3457L14.7463 17.6089C14.7051 18.0427 14.3375 18.3593 13.9254 18.3159C13.5132 18.2725 13.2125 17.8856 13.2537 17.4518L13.7537 12.1886C13.7949 11.7548 14.1625 11.4382 14.5746 11.4816Z" fill="currentColor" fillRule="evenodd" />
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
            <Menu.Popup className="w-44 rounded-xl bg-surface p-1.5 text-small text-ink shadow-[0_8px_20px_rgb(0_0_0/0.20)] outline-none">
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
