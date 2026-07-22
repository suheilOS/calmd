import { Button } from '@base-ui/react/button'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ReactNode } from 'react'

const appWindow = getCurrentWindow()

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
  'inline-flex size-10 items-center justify-center text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-faint active:scale-[0.96]'

export function TitleBar() {
  return (
    <header
      className="relative flex h-10 shrink-0 select-none items-center bg-canvas text-small text-secondary"
      data-tauri-drag-region
    >
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center" data-tauri-drag-region>
        calmd
      </span>
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

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TitleBar />
      {children}
    </div>
  )
}
