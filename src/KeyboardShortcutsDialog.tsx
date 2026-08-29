import { Dialog } from '@base-ui/react/dialog'
import { Tooltip } from '@base-ui/react/tooltip'
import { Kbd } from './Kbd'
import { KEYBOARD_SHORTCUT_SECTIONS } from './keyboardShortcuts'

const triggerClassName =
  'inline-flex size-10 items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-active-ink focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-faint active:scale-[0.96]'

function HelpIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6.5 6.25a1.55 1.55 0 1 1 2.58 1.16c-.64.56-1.08.87-1.08 1.72M8 11.25v.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
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
