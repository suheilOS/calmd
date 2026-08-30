import { Button } from '@base-ui/react/button'
import { Tooltip } from '@base-ui/react/tooltip'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, type ReactElement, type ReactNode } from 'react'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { Kbd } from './Kbd'

const appWindow = getCurrentWindow()

export type TitleBarNavigation = {
  canGoBack: boolean
  canGoForward: boolean
  canGoHome: boolean
  canOpenRandomNote?: boolean
  onBack: () => void
  onForward: () => void
  onHome: () => void
  onOpenRandomNote?: () => void
}

function BackIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
      <path d="m9.5 3.5-4.5 4.5 4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
      <path d="m6.5 3.5 4.5 4.5-4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path clipRule="evenodd" d="M2.5192 7.82274C2 8.77128 2 9.91549 2 12.2039V13.725C2 17.6258 2 19.5763 3.17157 20.7881C4.34315 22 6.22876 22 10 22H14C17.7712 22 19.6569 22 20.8284 20.7881C22 19.5763 22 17.6258 22 13.725V12.2039C22 9.91549 22 8.77128 21.4808 7.82274C20.9616 6.87421 20.0131 6.28551 18.116 5.10812L16.116 3.86687C14.1106 2.62229 13.1079 2 12 2C10.8921 2 9.88939 2.62229 7.88403 3.86687L5.88403 5.10813C3.98695 6.28551 3.0384 6.87421 2.5192 7.82274ZM9 17.25C8.58579 17.25 8.25 17.5858 8.25 18C8.25 18.4142 8.58579 18.75 9 18.75H15C15.4142 18.75 15.75 18.4142 15.75 18C15.75 17.5858 15.4142 17.25 15 17.25H9Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

function RandomNoteIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path clipRule="evenodd" d="M12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22ZM16.2623 7.47719C16.551 7.1802 17.0258 7.17351 17.3228 7.46225L18.5228 8.62892C18.6681 8.77013 18.75 8.96409 18.75 9.16667C18.75 9.36924 18.6681 9.5632 18.5228 9.70441L17.3228 10.8711C17.0258 11.1598 16.551 11.1531 16.2623 10.8561C16.011 10.5977 15.9834 10.2046 16.1762 9.91667H15.8383C15.3265 9.91667 14.9944 9.91744 14.7373 9.94173C14.4955 9.96458 14.3787 10.0042 14.294 10.0509C14.2102 10.0969 14.1178 10.1718 13.9758 10.3582C13.8236 10.5581 13.6532 10.8325 13.3896 11.2598L11.8693 13.7233C11.6282 14.1138 11.4197 14.4518 11.2175 14.7172C11.0002 15.0026 10.7583 15.2488 10.4294 15.4299C10.1015 15.6104 9.76303 15.6843 9.40387 15.7183C9.06785 15.75 8.66434 15.75 8.1946 15.75L6 15.75C5.58579 15.75 5.25 15.4142 5.25 15C5.25 14.5858 5.58579 14.25 6 14.25H8.16171C8.67346 14.25 9.00564 14.2492 9.26275 14.2249C9.50453 14.2021 9.62126 14.1625 9.70604 14.1158C9.78978 14.0697 9.88225 13.9948 10.0242 13.8085C10.1764 13.6086 10.3468 13.3341 10.6104 12.9068L12.1307 10.4434C12.3717 10.0528 12.5803 9.71485 12.7825 9.44943C12.9998 9.16404 13.2417 8.91784 13.5706 8.73678C13.8985 8.55631 14.237 8.48233 14.5961 8.44839C14.9322 8.41663 15.3357 8.41665 15.8054 8.41667L16.1762 8.41667C15.9834 8.12871 16.011 7.73562 16.2623 7.47719ZM9.38531 9.76916C9.30046 9.7531 9.19932 9.75 8.80057 9.75H6C5.58579 9.75 5.25 9.41421 5.25 9C5.25 8.58579 5.58579 8.25 6 8.25H8.80057L8.85843 8.24998C9.17103 8.24981 9.42305 8.24968 9.66421 8.29532C10.2033 8.39734 10.6972 8.66783 11.0694 9.07011C11.2363 9.25039 11.3679 9.4639 11.5278 9.72348L11.5582 9.77278C11.7758 10.1253 11.6664 10.5874 11.3139 10.8049C10.9614 11.0224 10.4993 10.913 10.2818 10.5606C10.0759 10.2269 10.0234 10.1482 9.96852 10.0889C9.81783 9.92609 9.61368 9.81237 9.38531 9.76916ZM12.6861 13.0284C13.0386 12.8109 13.5007 12.9203 13.7182 13.2728C13.9241 13.6064 13.9766 13.6851 14.0315 13.7444C14.1822 13.9072 14.3863 14.021 14.6147 14.0642C14.6995 14.0802 14.8007 14.0833 15.1994 14.0833H16.1762C15.9834 13.7954 16.011 13.4023 16.2623 13.1439C16.551 12.8469 17.0258 12.8402 17.3228 13.1289L18.5228 14.2956C18.6681 14.4368 18.75 14.6308 18.75 14.8333C18.75 15.0359 18.6681 15.2299 18.5228 15.3711L17.3228 16.5377C17.0258 16.8265 16.551 16.8198 16.2623 16.5228C16.011 16.2644 15.9834 15.8713 16.1762 15.5833H15.1994L15.1416 15.5834C14.829 15.5835 14.5769 15.5837 14.3358 15.538C13.7967 15.436 13.3028 15.1655 12.9306 14.7632C12.7637 14.5829 12.6321 14.3694 12.4722 14.1098L12.4418 14.0606C12.2242 13.7081 12.3336 13.246 12.6861 13.0284Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

function MinimizeIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 14 14">
      <path d="M3 7h8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 14 14">
      <rect height="7" rx="0.75" stroke="currentColor" strokeWidth="1.1" width="7" x="3.5" y="3.5" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 14 14">
      <path d="m4 4 6 6m0-6-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </svg>
  )
}

const controlClassName =
  'inline-flex size-10 items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-active-ink focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-faint active:scale-[0.96]'

const navigationControlClassName =
  `${controlClassName} disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent disabled:hover:text-faint disabled:active:scale-100`

function TitleBarTooltip({ children, label, shortcut }: { children: ReactElement; label: string; shortcut?: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner className="z-50" side="bottom" sideOffset={6}>
          <Tooltip.Popup className="origin-[var(--transform-origin)] rounded-lg bg-surface p-1.5 text-sm text-ink shadow-[0_8px_20px_rgb(0_0_0/0.20)] transition-[opacity,scale] duration-100 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <span className="inline-flex items-center gap-1.5">
              <span>{label}</span>
              {shortcut ? <Kbd>{shortcut}</Kbd> : null}
            </span>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function TitleBar({
  navigation,
  noteActions,
}: {
  navigation?: TitleBarNavigation
  noteActions?: ReactNode
}) {
  useEffect(() => {
    if (!navigation) return
    const activeNavigation = navigation

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.altKey
        || (!event.metaKey && !event.ctrlKey)
        || (event.key !== '[' && event.key !== ']')
      ) return

      event.preventDefault()
      if (event.key === '[' && activeNavigation.canGoBack) activeNavigation.onBack()
      if (event.key === ']' && activeNavigation.canGoForward) activeNavigation.onForward()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigation])

  return (
    <header
      className="sticky top-0 z-20 flex h-10 shrink-0 select-none items-center bg-canvas text-small text-secondary"
      data-tauri-drag-region
    >
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center" data-tauri-drag-region>
        calmd
      </span>
      <Tooltip.Provider delay={500} timeout={300}>
        {navigation ? (
          <div className="flex" role="group" aria-label="Navigation controls">
            <TitleBarTooltip label="Back" shortcut="Ctrl+[">
              <Button
                aria-keyshortcuts="Control+[ Meta+["
                aria-label="Back"
                className={navigationControlClassName}
                disabled={!navigation.canGoBack}
                onClick={navigation.onBack}
                type="button"
              >
                <BackIcon />
              </Button>
            </TitleBarTooltip>
            <TitleBarTooltip label="Forward" shortcut="Ctrl+]">
              <Button
                aria-keyshortcuts="Control+] Meta+]"
                aria-label="Forward"
                className={navigationControlClassName}
                disabled={!navigation.canGoForward}
                onClick={navigation.onForward}
                type="button"
              >
                <ForwardIcon />
              </Button>
            </TitleBarTooltip>
            <TitleBarTooltip label="Home" shortcut="Alt+H">
              <Button
                aria-keyshortcuts="Alt+H"
                aria-label="Home"
                className={navigationControlClassName}
                disabled={!navigation.canGoHome}
                onClick={navigation.onHome}
                type="button"
              >
                <HomeIcon />
              </Button>
            </TitleBarTooltip>
            {navigation.onOpenRandomNote ? (
              <TitleBarTooltip label="Open random note" shortcut="Ctrl/Cmd+Alt+R">
                <Button
                  aria-keyshortcuts="Control+Alt+R Meta+Alt+R"
                  aria-label="Open a random note"
                  className={navigationControlClassName}
                  disabled={!navigation.canOpenRandomNote}
                  onClick={navigation.onOpenRandomNote}
                  type="button"
                >
                  <RandomNoteIcon />
                </Button>
              </TitleBarTooltip>
            ) : null}
          </div>
        ) : null}
        <div className="ml-auto flex">
          <KeyboardShortcutsDialog />
          {noteActions}
          <span aria-hidden="true" className="mx-1 h-5 w-px self-center bg-divider" />
          <div className="flex" role="group" aria-label="Window controls">
          <TitleBarTooltip label="Minimize">
            <Button aria-label="Minimize window" className={controlClassName} onClick={() => void appWindow.minimize()} type="button">
              <MinimizeIcon />
            </Button>
          </TitleBarTooltip>
          <TitleBarTooltip label="Maximize or restore">
            <Button aria-label="Maximize or restore window" className={controlClassName} onClick={() => void appWindow.toggleMaximize()} type="button">
              <MaximizeIcon />
            </Button>
          </TitleBarTooltip>
          <TitleBarTooltip label="Close">
            <Button aria-label="Close window" className={`${controlClassName} hover:bg-red-500 hover:text-white`} onClick={() => void appWindow.close()} type="button">
              <CloseIcon />
            </Button>
          </TitleBarTooltip>
          </div>
        </div>
      </Tooltip.Provider>
    </header>
  )
}

export function AppShell({
  children,
  navigation,
  noteActions,
}: {
  children: ReactNode
  navigation?: TitleBarNavigation
  noteActions?: ReactNode
}) {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-canvas">
      <TitleBar navigation={navigation} noteActions={noteActions} />
      <div className="app-scroll-container min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
