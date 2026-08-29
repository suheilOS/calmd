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
  return <IconFrame><path d="M2.5 8h3v3h-3V7.25A2.75 2.75 0 0 1 5.25 4.5M9 8h3v3H9V7.25a2.75 2.75 0 0 1 2.75-2.75" /></IconFrame>
}

function BulletedListIcon() {
  return <IconFrame><path d="M6 4h7M6 8h7M6 12h7" /><path d="M3 4h.01M3 8h.01M3 12h.01" strokeWidth="2" /></IconFrame>
}

function NumberedListIcon() {
  return <IconFrame><path d="M7 4h6M7 8h6M7 12h6M2.5 3l1-.75V5M2.25 7.25a.9.9 0 1 1 1.5.65l-1.5 1.1H4M2.25 11.25H4l-1.25 1 1.25.75H2.25" /></IconFrame>
}

function TaskIcon() {
  return <IconFrame><rect height="10" rx="1.5" width="10" x="3" y="3" /><path d="m5.5 8 1.75 1.75L10.75 6" /></IconFrame>
}

function BoldIcon() {
  return <IconFrame><path d="M4.5 2.75h3.75a2.5 2.5 0 0 1 0 5H4.5zm0 5h4.25a2.75 2.75 0 0 1 0 5.5H4.5z" /></IconFrame>
}

function ItalicIcon() {
  return <IconFrame><path d="M7 3h5M4 13h5M9.5 3 6.5 13" /></IconFrame>
}

function HighlightIcon() {
  return <IconFrame><path d="m4 10.5 5.75-7.75 2.5 2.5L4.5 11zM3 13h10" /></IconFrame>
}

function LinkIcon() {
  return <IconFrame><path d="m6.25 9.75-1 1a2.3 2.3 0 0 1-3.25-3.25l2-2a2.3 2.3 0 0 1 3.25 0M9.75 6.25l1-1A2.3 2.3 0 1 1 14 8.5l-2 2a2.3 2.3 0 0 1-3.25 0M5.75 10.25l4.5-4.5" /></IconFrame>
}

function CodeIcon() {
  return <IconFrame><path d="m5.5 4-4 4 4 4M10.5 4l4 4-4 4M9 2.75 7 13.25" /></IconFrame>
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
