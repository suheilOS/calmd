import { Dialog } from '@base-ui/react/dialog'
import { Tooltip } from '@base-ui/react/tooltip'
import { Kbd } from './Kbd'
import { KEYBOARD_SHORTCUT_SECTIONS } from './keyboardShortcuts'

const triggerClassName =
  'inline-flex size-10 items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-active-ink focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-faint active:scale-[0.96]'

function HelpIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path clipRule="evenodd" d="M8 5H16C18.8284 5 20.2426 5 21.1213 5.87868C22 6.75736 22 8.17157 22 11V13C22 15.8284 22 17.2426 21.1213 18.1213C20.2426 19 18.8284 19 16 19H8C5.17157 19 3.75736 19 2.87868 18.1213C2 17.2426 2 15.8284 2 13V11C2 8.17157 2 6.75736 2.87868 5.87868C3.75736 5 5.17157 5 8 5ZM6 10C6.55228 10 7 9.55228 7 9C7 8.44772 6.55228 8 6 8C5.44772 8 5 8.44772 5 9C5 9.55228 5.44772 10 6 10ZM6 13C6.55228 13 7 12.5523 7 12C7 11.4477 6.55228 11 6 11C5.44772 11 5 11.4477 5 12C5 12.5523 5.44772 13 6 13ZM9 13C9.55228 13 10 12.5523 10 12C10 11.4477 9.55228 11 9 11C8.44772 11 8 11.4477 8 12C8 12.5523 8.44772 13 9 13ZM9 10C9.55228 10 10 9.55228 10 9C10 8.44772 9.55228 8 9 8C8.44772 8 8 8.44772 8 9C8 9.55228 8.44772 10 9 10ZM12 10C12.5523 10 13 9.55228 13 9C13 8.44772 12.5523 8 12 8C11.4477 8 11 8.44772 11 9C11 9.55228 11.4477 10 12 10ZM12 13C12.5523 13 13 12.5523 13 12C13 11.4477 12.55228 11 12 11C11.4477 11 11 11.44772 11 12C11 12.5523 11.4477 13 12 13ZM15 10C15.5523 10 16 9.55228 16 9C16 8.44772 15.5523 8 15 8C14.4477 8 14 8.44772 14 9C14 9.55228 14.4477 10 15 10ZM15 13C15.5523 13 16 12.5523 16 12C16 11.4477 15.5523 11 15 11C14.4477 11 14 11.4477 14 12C14 12.5523 14.4477 13 15 13ZM18 10C18.5523 10 19 9.55228 19 9C19 8.44772 18.5523 8 18 8C17.4477 8 17 8.44772 17 9C17 9.55228 17.4477 10 18 10ZM18 13C18.5523 13 19 12.5523 19 12C19 11.4477 18.55228 11 18 11C17.4477 11 17 11.44772 17 12C17 12.5523 17.4477 13 18 13ZM17.75 16C17.75 16.4142 17.4142 16.75 17 16.75H7C6.58579 16.75 6.25 16.4142 6.25 16C6.25 15.5858 6.58579 15.25 7 15.25H17C17.4142 15.25 17.75 15.5858 17.75 16Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
      <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </svg>
  )
}

export function KeyboardShortcutsDialog() {
  return (
    <Dialog.Root>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={(
            <Dialog.Trigger
              aria-label="Keyboard shortcuts"
              className={triggerClassName}
              type="button"
            >
              <HelpIcon />
            </Dialog.Trigger>
          )}
        />
        <Tooltip.Portal>
          <Tooltip.Positioner className="z-50" side="bottom" sideOffset={6}>
            <Tooltip.Popup className="origin-[var(--transform-origin)] rounded-lg bg-surface p-1.5 text-sm text-ink shadow-[0_8px_20px_rgb(0_0_0/0.20)] transition-[opacity,scale] duration-100 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              Keyboard shortcuts
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-150 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <Dialog.Popup className="max-h-[min(42rem,calc(100svh-2rem))] w-full max-w-xl overflow-y-auto rounded-2xl bg-surface p-5 text-ink shadow-[0_16px_48px_oklch(0_0_0/0.24)] outline-none transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-base font-semibold tracking-[-0.02em]">
                  Keyboard shortcuts
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-pretty text-small leading-relaxed text-secondary">
                  Use Ctrl on Windows and Linux, and Cmd on macOS, unless noted.
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label="Close keyboard shortcuts"
                className="-mr-2 -mt-2 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-faint active:scale-[0.96]"
              >
                <CloseIcon />
              </Dialog.Close>
            </div>

            <div className="mt-6 space-y-6">
              {KEYBOARD_SHORTCUT_SECTIONS.map((section, sectionIndex) => {
                const headingId = `keyboard-shortcuts-section-${sectionIndex}`
                return (
                  <section aria-labelledby={headingId} key={section.label}>
                    <h2 className="text-small font-semibold text-ink" id={headingId}>
                      {section.label}
                    </h2>
                    <dl className="mt-2 space-y-1">
                      {section.shortcuts.map((shortcut) => (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg px-2 py-2" key={shortcut.label}>
                          <dt className="text-small text-secondary">{shortcut.label}</dt>
                          <dd>
                            <Kbd>{shortcut.keys}</Kbd>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )
              })}
            </div>

            <div className="mt-6 flex justify-end">
              <Dialog.Close className="inline-flex h-10 items-center justify-center rounded-xl bg-hover px-4 text-small text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96]">
                Close
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
