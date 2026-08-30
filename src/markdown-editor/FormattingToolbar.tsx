import { Menu } from '@base-ui/react/menu'
import { Popover } from '@base-ui/react/popover'
import { Toolbar } from '@base-ui/react/toolbar'
import { Tooltip } from '@base-ui/react/tooltip'
import { useEffect, useMemo, useRef } from 'react'
import type {
  FormattingToolbarSnapshot,
  MarkdownInlineFormat,
} from './contracts'
import type { MarkdownBlockKind } from './markdownBlockCommands'
import { Kbd } from '../Kbd'

type FormattingToolbarProps = {
  focusRequested: boolean
  onBlockChange: (kind: MarkdownBlockKind) => void
  onDismiss: () => void
  onFocusHandled: () => void
  onInlineChange: (format: MarkdownInlineFormat) => void
  onReturnFocus: () => void
  snapshot: FormattingToolbarSnapshot
}

const buttonClassName =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-secondary outline-none transition-[background-color,color,transform] duration-100 ease-out hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-faint active:scale-[0.96] aria-pressed:bg-active aria-pressed:text-active-ink data-[disabled]:cursor-not-allowed data-[disabled]:text-faint data-[disabled]:active:scale-100 data-[mixed]:bg-hover data-[mixed]:text-ink'

const itemClassName =
  'grid h-10 cursor-default select-none grid-cols-[1rem_1fr_1rem] items-center gap-2.5 rounded-lg px-3 text-small text-ink outline-none data-[highlighted]:bg-hover'

const popupClassName =
  'origin-[var(--transform-origin)] min-w-48 rounded-[0.875rem] bg-surface p-1.5 text-ink shadow-[0_8px_20px_rgb(0_0_0/0.20)] outline-none transition-[scale,opacity] duration-100 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-opacity'

const headingNumberPaths = {
  1: 'M11.5 6.5 13 5v6',
  2: 'M11 6.5a1.5 1.5 0 1 1 2.6 1L11 11h3',
  3: 'M11 5h3l-2 2.5a1.75 1.75 0 1 1-1 3.25',
  4: 'M13.5 11V5L11 9h3.5',
  5: 'M14 5h-3v2.5h1.5a1.75 1.75 0 1 1-1.5 2.65',
  6: 'M13.75 5.25C11 5.5 10.5 8 11 10a1.6 1.6 0 1 0 0-1.5h2.75',
} as const

function IconFrame({ children }: { children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
      {children}
    </svg>
  )
}

function ParagraphIcon() {
  return <IconFrame><path d="M9.25 13V3.5H7a3 3 0 0 0 0 6h2.25M12.25 3.5V13" /></IconFrame>
}

function HeadingIcon({ level }: { level?: keyof typeof headingNumberPaths }) {
  return (
    <IconFrame>
      <path d={level ? 'M2.5 3.5v9m5-9v9m-5-4.5h5' : 'M3 3.5v9m6-9v9M3 8h6'} />
      {level ? <path d={headingNumberPaths[level]} /> : null}
    </IconFrame>
  )
}

function QuoteIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M8.09 11.6314H3.4C3.48 6.96144 4.4 6.19144 7.27 4.49144C7.6 4.29144 7.71 3.87144 7.51 3.53144C7.32 3.20144 6.89 3.09144 6.56 3.29144C3.18 5.29144 2 6.51144 2 12.3214V17.7114C2 19.4214 3.39 20.8014 5.09 20.8014H8.09C9.85 20.8014 11.18 19.4714 11.18 17.7114V14.7114C11.18 12.9614 9.85 11.6314 8.09 11.6314Z" fill="currentColor" />
      <path d="M18.9086 11.6314H14.2186C14.2986 6.96144 15.2186 6.19144 18.0886 4.49144C18.4186 4.29144 18.5286 3.87144 18.3286 3.53144C18.1286 3.20144 17.7086 3.09144 17.3686 3.29144C13.9886 5.29144 12.8086 6.51144 12.8086 12.3314V17.7214C12.8086 19.4314 14.1986 20.8114 15.8986 20.8114H18.8986C20.6586 20.8114 21.9886 19.4814 21.9886 17.7214V14.7214C21.9986 12.9614 20.6686 11.6314 18.9086 11.6314Z" fill="currentColor" />
    </svg>
  )
}

function BulletedListIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <circle cx="5" cy="7" fill="currentColor" r="3" />
      <circle cx="5" cy="17" fill="currentColor" r="3" />
      <path d="M 21.6666 8 h -10 c -0.552 0 -1 -0.448 -1 -1 s 0.448 -1 1 -1 h 10 c 0.552 0 1 0.448 1 1 s -0.448 1 -1 1 Z" fill="currentColor" />
      <path d="M 21.6666 18 h -10 c -0.552 0 -1 -0.448 -1 -1 s 0.448 -1 1 -1 h 10 c 0.552 0 1 0.448 1 1 s -0.448 1 -1 1 Z" fill="currentColor" />
    </svg>
  )
}

function NumberedListIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M 8.7306 21.9999 H 3.3333 c -0.2773 0 -0.5427 -0.1147 -0.732 -0.3187 s -0.2853 -0.476 -0.2653 -0.752 c 0.1627 -2.292 1.9853 -3.0373 3.316 -3.5813 0.796 -0.324 2.1227 -0.9813 2.0773 -1.74 -0.0507 -0.852 -1.2293 -0.936 -1.588 -0.9413 -0.7427 -0.0333 -1.6013 0.2853 -1.8453 1.1507 -0.148 0.5307 -0.6933 0.8453 -1.2333 0.6933 -0.5307 -0.1493 -0.8413 -0.7013 -0.692 -1.2333 0.44 -1.5693 1.9333 -2.6107 3.728 -2.6107 0.0253 0 0.048 0 0.072 0 2.028 0.0293 3.4573 1.164 3.556 2.8213 0.0907 1.528 -1.0267 2.7773 -3.3187 3.712 -0.7373 0.3013 -1.2307 0.536 -1.552 0.8 h 3.8747 c 0.552 0 1 0.448 1 1 s -0.448 1 -1 1 Z" fill="currentColor" />
      <path d="M 21.6666 8 h -9 c -0.552 0 -1 -0.448 -1 -1 s 0.448 -1 1 -1 h 9 c 0.552 0 1 0.448 1 1 s -0.448 1 -1 1 Z" fill="currentColor" />
      <path d="M 21.6666 18 h -9 c -0.552 0 -1 -0.448 -1 -1 s 0.448 -1 1 -1 h 9 c 0.552 0 1 0.448 1 1 s -0.448 1 -1 1 Z" fill="currentColor" />
      <path d="M 6.3333 11 c -0.552 0 -1 -0.448 -1 -1 V 4.944 c -0.4093 0.228 -0.8853 0.4173 -1.4347 0.524 -0.5307 0.0987 -1.0667 -0.252 -1.1693 -0.7947 -0.104 -0.5427 0.2507 -1.0653 0.7947 -1.1693 1.284 -0.2453 1.9187 -1.2933 1.9453 -1.3373 0.2307 -0.388 0.6987 -0.5787 1.1267 -0.4587 0.4347 0.1187 0.7387 0.5093 0.7387 0.96 V 10 c 0 0.552 -0.448 1 -1 1 Z" fill="currentColor" />
    </svg>
  )
}

function TaskIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M7.22192 4.19197C7.60409 3.79327 7.59068 3.16024 7.19197 2.77808C6.79327 2.39591 6.16024 2.40932 5.77808 2.80803L3.61094 5.06896L2.70872 4.16261C2.31909 3.7712 1.68593 3.76975 1.29451 4.15938C0.903095 4.54901 0.901649 5.18218 1.29128 5.57359L2.91574 7.20549C3.10572 7.39634 3.36463 7.5025 3.63391 7.49996C3.90318 7.49741 4.16004 7.38638 4.34638 7.19197L7.22192 4.19197Z" fill="currentColor" />
      <path d="M7.22192 11.192C7.60409 10.7933 7.59068 10.1602 7.19197 9.77808C6.79327 9.39591 6.16024 9.40932 5.77808 9.80803L3.61094 12.069L2.70872 11.1626C2.31909 10.7712 1.68593 10.7698 1.29451 11.1594C0.903095 11.549 0.901649 12.1822 1.29128 12.5736L2.91574 14.2055C3.10572 14.3963 3.36463 14.5025 3.63391 14.5C3.90318 14.4974 4.16004 14.3864 4.34638 14.192L7.22192 11.192Z" fill="currentColor" />
      <path d="M7.19197 16.7781C7.59068 17.1602 7.60409 17.7933 7.22192 18.192L4.34638 21.192C4.16004 21.3864 3.90318 21.4974 3.63391 21.5C3.36463 21.5025 3.10572 21.3963 2.91574 21.2055L1.29128 19.5736C0.901649 19.1822 0.903095 18.549 1.29451 18.1594C1.68593 17.7698 2.31909 17.7712 2.70872 18.1626L3.61094 19.069L5.77808 16.808C6.16024 16.4093 6.79327 16.3959 7.19197 16.7781Z" fill="currentColor" />
      <path d="M10.5 11.5C9.94771 11.5 9.5 11.9477 9.5 12.5C9.5 13.0523 9.94771 13.5 10.5 13.5H22C22.5523 13.5 23 13.0523 23 12.5C23 11.9477 22.5523 11.5 22 11.5H10.5Z" fill="currentColor" />
      <path d="M9.5 5.5C9.5 4.94772 9.94771 4.5 10.5 4.5H22C22.5523 4.5 23 4.94772 23 5.5C23 6.05228 22.5523 6.5 22 6.5H10.5C9.94771 6.5 9.5 6.05228 9.5 5.5Z" fill="currentColor" />
      <path d="M10.5 18.5C9.94771 18.5 9.5 18.9477 9.5 19.5C9.5 20.0523 9.94771 20.5 10.5 20.5H22C22.5523 20.5 23 20.0523 23 19.5C23 18.9477 22.5523 18.5 22 18.5H10.5Z" fill="currentColor" />
    </svg>
  )
}

function BoldIcon() {
  return <IconFrame><path d="M4.5 2.75h3.75a2.5 2.5 0 0 1 0 5H4.5zm0 5h4.25a2.75 2.75 0 0 1 0 5.5H4.5z" /></IconFrame>
}

function ItalicIcon() {
  return <IconFrame><path d="M7 3h5M4 13h5M9.5 3 6.5 13" /></IconFrame>
}

function HighlightIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M 19 21.3333 H 8.7266 c -0.552 0 -1 -0.448 -1 -1 s 0.448 -1 1 -1 h 10.2733 c 0.552 0 1 0.448 1 1 s -0.448 1 -1 1 Z" fill="currentColor" />
      <path d="M 16.9906 2.848 l -2.076 -1.048 c -1.6373 -0.8267 -3.6493 -0.3067 -4.6813 1.208 L 5.2107 10.3706 c -0.3773 0.556 -0.4987 1.2467 -0.3307 1.896 0.08 0.312 0.2267 0.5987 0.4213 0.848 0.9267 2.332 0.0453 4.3 -0.1427 4.6707 0 0 0 0.0013 0 0.0027 l -1.0507 2.096 c -0.156 0.3107 -0.1387 0.6787 0.0413 0.9733 0.1827 0.2947 0.5053 0.4747 0.852 0.4747 h 3.7267 c 0.3773 0 0.7227 -0.212 0.892 -0.5493 l 0.3013 -0.5947 c 0.188 -0.372 1.2467 -2.2507 3.6773 -2.8893 0.0187 0 0.036 0.0067 0.0547 0.0067 0.296 0 0.5907 -0.056 0.872 -0.1693 0.6227 -0.2507 1.108 -0.7587 1.3307 -1.3933 l 2.944 -8.4106 c 0.6053 -1.7307 -0.172 -3.6587 -1.808 -4.4853 Z M 8.656 18.4306 l -1.332 -0.6733 c 0.2533 -0.7653 0.48 -1.8787 0.3613 -3.1827 l 3.3173 1.6747 c -1.12 0.6787 -1.88 1.5227 -2.3467 2.1813 Z" fill="currentColor" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M9.79287 7.20709C9.40234 6.81656 9.40234 6.1834 9.79287 5.79287L12.8429 2.74289C15.1664 0.419364 18.9335 0.419364 21.2571 2.74288C23.5806 5.06641 23.5806 8.83358 21.2571 11.1571L18.2071 14.2071C17.8166 14.5976 17.1834 14.5976 16.7929 14.2071C16.4023 13.8166 16.4023 13.1834 16.7929 12.7929L19.8429 9.74289C21.3853 8.20041 21.3853 5.69957 19.8429 4.1571C18.3004 2.61463 15.7995 2.61463 14.2571 4.1571L11.2071 7.20709C10.8166 7.59761 10.1834 7.59761 9.79287 7.20709Z" fill="currentColor" />
      <path d="M15.7071 8.29287C16.0976 8.6834 16.0976 9.31656 15.7071 9.70709L9.70708 15.7071C9.31656 16.0976 8.6834 16.0976 8.29287 15.7071C7.90235 15.3166 7.90235 14.6834 8.29287 14.2929L14.2929 8.29287C14.6834 7.90235 15.3166 7.90235 15.7071 8.29287Z" fill="currentColor" />
      <path d="M14.2071 18.2071C14.5976 17.8166 14.5976 17.1834 14.2071 16.7929C13.8166 16.4023 13.1834 16.4023 12.7929 16.7929L9.74288 19.8429C8.20041 21.3853 5.69957 21.3853 4.1571 19.8429C2.61463 18.3004 2.61463 15.7995 4.1571 14.2571L7.20709 11.2071C7.59761 10.8166 7.59761 10.1834 7.20709 9.79287C6.81656 9.40235 6.1834 9.40235 5.79287 9.79287L2.74289 12.8429C0.419364 15.1664 0.419363 18.9336 2.74288 21.2571C5.06641 23.5806 8.83358 23.5806 11.1571 21.2571L14.2071 18.2071Z" fill="currentColor" />
    </svg>
  )
}

function CodeIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M14.1809 4.2755C14.581 4.3827 14.8185 4.79396 14.7113 5.19406L10.7377 20.0238C10.6304 20.4239 10.2192 20.6613 9.81909 20.5541C9.41899 20.4469 9.18156 20.0356 9.28876 19.6355L13.2624 4.80583C13.3696 4.40573 13.7808 4.16829 14.1809 4.2755Z" fill="currentColor" />
      <path d="M16.4425 7.32781C16.7196 7.01993 17.1938 6.99497 17.5017 7.27206L19.2392 8.8358C19.9756 9.49847 20.5864 10.0482 21.0058 10.5467C21.4468 11.071 21.7603 11.6342 21.7603 12.3295C21.7603 13.0248 21.4468 13.5881 21.0058 14.1123C20.5864 14.6109 19.9756 15.1606 19.2392 15.8233L17.5017 17.387C17.1938 17.6641 16.7196 17.6391 16.4425 17.3313C16.1654 17.0234 16.1904 16.5492 16.4983 16.2721L18.1947 14.7452C18.9826 14.0362 19.5138 13.5558 19.8579 13.1467C20.1882 12.7541 20.2603 12.525 20.2603 12.3295C20.2603 12.1341 20.1882 11.9049 19.8579 11.5123C19.5138 11.1033 18.9826 10.6229 18.1947 9.91383L16.4983 8.387C16.1904 8.10991 16.1654 7.63569 16.4425 7.32781Z" fill="currentColor" />
      <path d="M7.50178 8.387C7.80966 8.10991 7.83462 7.63569 7.55752 7.32781C7.28043 7.01993 6.80621 6.99497 6.49833 7.27206L4.76084 8.8358C4.0245 9.49847 3.41369 10.0482 2.99428 10.5467C2.55325 11.071 2.23975 11.6342 2.23975 12.3295C2.23975 13.0248 2.55325 13.5881 2.99428 14.1123C3.41369 14.6109 4.02449 15.1606 4.76082 15.8232L6.49833 17.387C6.80621 17.6641 7.28043 17.6391 7.55752 17.3313C7.83462 17.0234 7.80966 16.5492 7.50178 16.2721L5.80531 14.7452C5.01743 14.0362 4.48623 13.5558 4.14213 13.1467C3.81188 12.7541 3.73975 12.525 3.73975 12.3295C3.73975 12.1341 3.81188 11.9049 4.14213 11.5123C4.48623 11.1033 5.01743 10.6229 5.80531 9.91383L7.50178 8.387Z" fill="currentColor" />
    </svg>
  )
}

function StrikethroughIcon() {
  return <IconFrame><path d="M4.25 5.25c.25-1.5 1.5-2.5 3.75-2.5 2 0 3.25.75 3.75 2M4.5 10.75c.5 1.5 1.75 2.5 3.75 2.5 2.25 0 3.5-1.25 3.5-2.75M2 8h12" /></IconFrame>
}

function ChevronDownIcon() {
  return <IconFrame><path d="m5 6.5 3 3 3-3" /></IconFrame>
}

function ChevronRightIcon() {
  return <IconFrame><path d="m6.5 4 4 4-4 4" /></IconFrame>
}

function CheckIcon() {
  return <IconFrame><path d="m3.5 8 3 3 6-6" /></IconFrame>
}

const blockLabels: Record<MarkdownBlockKind | 'mixed', string> = {
  paragraph: 'Paragraph',
  'heading-1': 'Heading 1',
  'heading-2': 'Heading 2',
  'heading-3': 'Heading 3',
  'heading-4': 'Heading 4',
  'heading-5': 'Heading 5',
  'heading-6': 'Heading 6',
  quote: 'Quote',
  bullet: 'Bulleted list',
  ordered: 'Numbered list',
  task: 'Task',
  mixed: 'Mixed blocks',
}

function BlockIcon({ kind }: { kind: MarkdownBlockKind | 'mixed' }) {
  if (kind === 'paragraph') return <ParagraphIcon />
  if (kind.startsWith('heading-')) return <HeadingIcon />
  if (kind === 'quote') return <QuoteIcon />
  if (kind === 'bullet') return <BulletedListIcon />
  if (kind === 'ordered') return <NumberedListIcon />
  if (kind === 'task') return <TaskIcon />
  return <HeadingIcon />
}

type FormatButtonProps = {
  format: MarkdownInlineFormat
  icon: React.ReactNode
  label: string
  onChange: (format: MarkdownInlineFormat) => void
  shortcut: string
  snapshot: FormattingToolbarSnapshot
}

function FormatButton({ format, icon, label, onChange, shortcut, snapshot }: FormatButtonProps) {
  const state = snapshot.formats[format]
  const pressed = state === 'active' ? true : state === 'mixed' ? 'mixed' : false
  return (
    <Tooltip.Root>
      <Toolbar.Button
        aria-label={label}
        aria-pressed={pressed}
        className={buttonClassName}
        data-mixed={state === 'mixed' ? '' : undefined}
        disabled={state === 'unavailable'}
        onClick={() => onChange(format)}
        render={(
          <Tooltip.Trigger />
        )}
        type="button"
      >
        {icon}
      </Toolbar.Button>
      <Tooltip.Portal>
        <Tooltip.Positioner className="z-[70]" side="bottom" sideOffset={6}>
          <Tooltip.Popup className="rounded-lg bg-surface p-1.5 text-sm text-ink shadow-[0_8px_20px_rgb(0_0_0/0.20)]">
            <span className="inline-flex items-center gap-1.5">
              <span>{label}</span>
              <Kbd>{shortcut}</Kbd>
            </span>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function FormattingToolbar({
  focusRequested,
  onBlockChange,
  onDismiss,
  onFocusHandled,
  onInlineChange,
  onReturnFocus,
  snapshot,
}: FormattingToolbarProps) {
  const firstButtonRef = useRef<HTMLButtonElement>(null)
  const anchor = useMemo(() => ({
    getBoundingClientRect: () => new DOMRect(
      snapshot.anchor.x,
      snapshot.anchor.y,
      snapshot.anchor.width,
      snapshot.anchor.height,
    ),
  }), [snapshot.anchor])

  useEffect(() => {
    if (!focusRequested) return
    firstButtonRef.current?.focus()
    onFocusHandled()
  }, [focusRequested, onFocusHandled])

  const currentBlock = snapshot.blockKind === 'mixed' ? undefined : snapshot.blockKind

  return (
    <Popover.Root
      modal={false}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
      open
    >
      <Popover.Portal keepMounted>
        <Popover.Positioner
          align="center"
          anchor={anchor}
          className="z-[60] outline-none"
          collisionAvoidance={{ align: 'shift', side: 'flip' }}
          positionMethod="fixed"
          side="top"
          sideOffset={8}
        >
          <Popover.Popup
            className="rounded-xl bg-surface p-1 shadow-[0_8px_20px_rgb(0_0_0/0.20)] outline-none transition-[scale,opacity] duration-100 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-opacity"
            finalFocus={false}
            initialFocus={false}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              onDismiss()
              onReturnFocus()
            }}
          >
            <Tooltip.Provider delay={500} timeout={300}>
              <Toolbar.Root aria-label="Text formatting" className="flex items-center gap-0.5">
                <Menu.Root>
                  <Menu.Trigger
                    render={(
                      <Toolbar.Button
                        aria-label={`Block style: ${blockLabels[snapshot.blockKind]}`}
                        className={`${buttonClassName} w-12 gap-0.5`}
                        ref={firstButtonRef}
                        type="button"
                      >
                        <BlockIcon kind={snapshot.blockKind} />
                        <span className="-mr-1 text-faint"><ChevronDownIcon /></span>
                      </Toolbar.Button>
                    )}
                  />
                  <Menu.Portal>
                    <Menu.Positioner align="start" className="z-[70] outline-none" side="bottom" sideOffset={6}>
                      <Menu.Popup className={popupClassName}>
                        <Menu.RadioGroup
                          onValueChange={(kind: MarkdownBlockKind) => onBlockChange(kind)}
                          value={currentBlock}
                        >
                          <Menu.RadioItem className={itemClassName} closeOnClick value="paragraph">
                            <ParagraphIcon /><span>Paragraph</span><Menu.RadioItemIndicator><CheckIcon /></Menu.RadioItemIndicator>
                          </Menu.RadioItem>
                          <Menu.SubmenuRoot>
                            <Menu.SubmenuTrigger className={itemClassName}>
                              <HeadingIcon /><span>Heading</span><span className="text-faint"><ChevronRightIcon /></span>
                            </Menu.SubmenuTrigger>
                            <Menu.Portal>
                              <Menu.Positioner alignOffset={-6} className="z-[70] outline-none" sideOffset={4}>
                                <Menu.Popup className={popupClassName}>
                                  {([1, 2, 3, 4, 5, 6] as const).map((level) => (
                                    <Menu.RadioItem className={itemClassName} closeOnClick key={level} value={`heading-${level}`}>
                                      <HeadingIcon level={level} /><span>Heading {level}</span><Menu.RadioItemIndicator><CheckIcon /></Menu.RadioItemIndicator>
                                    </Menu.RadioItem>
                                  ))}
                                </Menu.Popup>
                              </Menu.Positioner>
                            </Menu.Portal>
                          </Menu.SubmenuRoot>
                          <Menu.RadioItem className={itemClassName} closeOnClick value="quote">
                            <QuoteIcon /><span>Quote</span><Menu.RadioItemIndicator><CheckIcon /></Menu.RadioItemIndicator>
                          </Menu.RadioItem>
                          <Menu.RadioItem className={itemClassName} closeOnClick value="bullet">
                            <BulletedListIcon /><span>Bulleted list</span><Menu.RadioItemIndicator><CheckIcon /></Menu.RadioItemIndicator>
                          </Menu.RadioItem>
                          <Menu.RadioItem className={itemClassName} closeOnClick value="ordered">
                            <NumberedListIcon /><span>Numbered list</span><Menu.RadioItemIndicator><CheckIcon /></Menu.RadioItemIndicator>
                          </Menu.RadioItem>
                          <Menu.RadioItem className={itemClassName} closeOnClick value="task">
                            <TaskIcon /><span>Task</span><Menu.RadioItemIndicator><CheckIcon /></Menu.RadioItemIndicator>
                          </Menu.RadioItem>
                        </Menu.RadioGroup>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
                <Toolbar.Separator className="mx-1 h-5 w-px bg-divider" />
                <FormatButton format="bold" icon={<BoldIcon />} label="Bold" onChange={onInlineChange} shortcut="Ctrl/Cmd+B" snapshot={snapshot} />
                <FormatButton format="italic" icon={<ItalicIcon />} label="Italic" onChange={onInlineChange} shortcut="Ctrl/Cmd+I" snapshot={snapshot} />
                <FormatButton format="link" icon={<LinkIcon />} label="Link" onChange={onInlineChange} shortcut="Ctrl/Cmd+K" snapshot={snapshot} />
                <FormatButton format="highlight" icon={<HighlightIcon />} label="Highlight" onChange={onInlineChange} shortcut="Ctrl/Cmd+Shift+H" snapshot={snapshot} />
                <FormatButton format="code" icon={<CodeIcon />} label="Inline code" onChange={onInlineChange} shortcut="Ctrl/Cmd+`" snapshot={snapshot} />
                <FormatButton format="strikethrough" icon={<StrikethroughIcon />} label="Strikethrough" onChange={onInlineChange} shortcut="Ctrl/Cmd+Shift+X" snapshot={snapshot} />
              </Toolbar.Root>
            </Tooltip.Provider>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
