import { Button } from '@base-ui/react/button'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, type ReactNode } from 'react'

const appWindow = getCurrentWindow()

export type TitleBarNavigation = {
  canGoBack: boolean
  canGoForward: boolean
  canGoHome: boolean
  onBack: () => void
  onForward: () => void
  onHome: () => void
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
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
      <path d="M2.75 7.25 8 2.75l5.25 4.5v5.5a.5.5 0 0 1-.5.5h-3V9h-3v4.25h-3a.5.5 0 0 1-.5-.5z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" />
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

export function TitleBar({ navigation }: { navigation?: TitleBarNavigation }) {
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
      className="relative flex h-10 shrink-0 select-none items-center bg-canvas text-small text-secondary"
      data-tauri-drag-region
    >
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center" data-tauri-drag-region>
        calmd
      </span>
      {navigation ? (
        <div className="flex" role="group" aria-label="Navigation controls">
          <Button
            aria-keyshortcuts="Control+[ Meta+["
            aria-label="Back"
            className={navigationControlClassName}
            disabled={!navigation.canGoBack}
            onClick={navigation.onBack}
            title="Back (Ctrl+[)"
            type="button"
          >
            <BackIcon />
          </Button>
          <Button
            aria-keyshortcuts="Control+] Meta+]"
            aria-label="Forward"
            className={navigationControlClassName}
            disabled={!navigation.canGoForward}
            onClick={navigation.onForward}
            title="Forward (Ctrl+])"
            type="button"
          >
            <ForwardIcon />
          </Button>
          <Button
            aria-label="Home"
            className={navigationControlClassName}
            disabled={!navigation.canGoHome}
            onClick={navigation.onHome}
            title="Home"
            type="button"
          >
            <HomeIcon />
          </Button>
        </div>
      ) : null}
      <div className="ml-auto flex" role="group" aria-label="Window controls">
        <Button aria-label="Minimize window" className={controlClassName} onClick={() => void appWindow.minimize()} type="button">
          <MinimizeIcon />
        </Button>
        <Button aria-label="Maximize or restore window" className={controlClassName} onClick={() => void appWindow.toggleMaximize()} type="button">
          <MaximizeIcon />
        </Button>
        <Button aria-label="Close window" className={`${controlClassName} hover:bg-red-500 hover:text-white`} onClick={() => void appWindow.close()} type="button">
          <CloseIcon />
        </Button>
      </div>
    </header>
  )
}

export function AppShell({
  children,
  navigation,
}: {
  children: ReactNode
  navigation?: TitleBarNavigation
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TitleBar navigation={navigation} />
      {children}
    </div>
  )
}
