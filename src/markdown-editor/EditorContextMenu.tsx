import { Menu } from '@base-ui/react/menu'
import { MoreVerticalIcon } from '../MoreVerticalIcon'
import type { MarkdownBlockKind } from './markdownBlockCommands'

type EditorContextMenuProps = {
  onBlockChange: (kind: MarkdownBlockKind) => void
  onInsertImage: () => void
  onSpellcheckChange: (enabled: boolean) => void
  spellcheckEnabled: boolean
}

const itemClassName =
  'flex h-10 cursor-default select-none items-center gap-2.5 rounded-lg px-3 text-small text-ink outline-none data-[highlighted]:bg-hover data-[disabled]:text-faint'

const popupClassName =
  'origin-[var(--transform-origin)] min-w-48 rounded-[0.875rem] bg-surface p-1.5 text-ink shadow-[0_8px_24px_oklch(0_0_0/0.18)] outline-none transition-[scale,opacity] duration-100 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0'

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
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.35"
      viewBox="0 0 16 16"
    >
      {children}
    </svg>
  )
}

function ParagraphIcon() {
  return (
    <IconFrame>
      <path d="M9.25 13V3.5H7a3 3 0 0 0 0 6h2.25M12.25 3.5V13" />
    </IconFrame>
  )
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
    <IconFrame>
      <path d="M2.5 8h3v3h-3V7.25A2.75 2.75 0 0 1 5.25 4.5M9 8h3v3H9V7.25a2.75 2.75 0 0 1 2.75-2.75" />
    </IconFrame>
  )
}

function BulletedListIcon() {
  return (
    <IconFrame>
      <path d="M6 4h7M6 8h7M6 12h7" />
      <path d="M3 4h.01M3 8h.01M3 12h.01" strokeWidth="2" />
    </IconFrame>
  )
}

function NumberedListIcon() {
  return (
    <IconFrame>
      <path d="M7 4h6M7 8h6M7 12h6M2.5 3l1-.75V5M2.25 7.25a.9.9 0 1 1 1.5.65l-1.5 1.1H4M2.25 11.25H4l-1.25 1 1.25.75H2.25" />
    </IconFrame>
  )
}

function TaskIcon() {
  return (
    <IconFrame>
      <rect height="10" rx="1.5" width="10" x="3" y="3" />
      <path d="m5.5 8 1.75 1.75L10.75 6" />
    </IconFrame>
  )
}

function ImageIcon() {
  return (
    <IconFrame>
      <rect height="11" rx="1.5" width="13" x="1.5" y="2.5" />
      <circle cx="5" cy="6" r="1" />
      <path d="m3 12 3.25-3 2.25 2 1.5-1.5 3 2.5" />
    </IconFrame>
  )
}

function SpellcheckIcon() {
  return (
    <IconFrame>
      <path d="m2.25 10 3-7 3 7M3.25 7.75h4M9.5 10.5l1.5 1.5 3-3.5" />
    </IconFrame>
  )
}

function ChevronRightIcon() {
  return (
    <IconFrame>
      <path d="m6.5 4 4 4-4 4" />
    </IconFrame>
  )
}

function CheckIcon() {
  return (
    <IconFrame>
      <path d="m3.5 8 3 3 6-6" />
    </IconFrame>
  )
}

/** Button-triggered formatting menu that leaves the editor's native context menu intact. */
export function EditorContextMenu({
  onBlockChange,
  onInsertImage,
  onSpellcheckChange,
  spellcheckEnabled,
}: EditorContextMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Editor actions"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-secondary outline-none transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.96] focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint"
        type="button"
      >
        <MoreVerticalIcon />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          className="z-50 outline-none"
          side="bottom"
          sideOffset={6}
        >
          <Menu.Popup className={popupClassName}>
            <Menu.Item
              className={itemClassName}
              onClick={() => onBlockChange('paragraph')}
            >
              <ParagraphIcon />
              <span>Paragraph</span>
            </Menu.Item>
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className={itemClassName}>
                <HeadingIcon />
                <span>Heading</span>
                <span className="ml-auto text-faint">
                  <ChevronRightIcon />
                </span>
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner
                  alignOffset={-6}
                  className="z-50 outline-none"
                  sideOffset={4}
                >
                  <Menu.Popup className={popupClassName}>
                    {([1, 2, 3, 4, 5, 6] as const).map((level) => (
                      <Menu.Item
                        className={itemClassName}
                        key={level}
                        onClick={() => onBlockChange(`heading-${level}`)}
                      >
                        <HeadingIcon level={level} />
                        <span>Heading {level}</span>
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>
            <Menu.Item className={itemClassName} onClick={() => onBlockChange('quote')}>
              <QuoteIcon />
              <span>Quote</span>
            </Menu.Item>
            <Menu.Item className={itemClassName} onClick={() => onBlockChange('bullet')}>
              <BulletedListIcon />
              <span>Bulleted list</span>
            </Menu.Item>
            <Menu.Item className={itemClassName} onClick={() => onBlockChange('ordered')}>
              <NumberedListIcon />
              <span>Numbered list</span>
            </Menu.Item>
            <Menu.Item className={itemClassName} onClick={() => onBlockChange('task')}>
              <TaskIcon />
              <span>Task</span>
            </Menu.Item>
            <Menu.Separator className="mx-2 my-1 h-px bg-divider" />
            <Menu.Item className={itemClassName} onClick={onInsertImage}>
              <ImageIcon />
              <span>Insert image…</span>
            </Menu.Item>
            <Menu.CheckboxItem
              checked={spellcheckEnabled}
              className={itemClassName}
              closeOnClick
              onCheckedChange={onSpellcheckChange}
            >
              <SpellcheckIcon />
              <span>Spellcheck</span>
              <Menu.CheckboxItemIndicator
                aria-hidden="true"
                className="ml-auto text-accent"
              >
                <CheckIcon />
              </Menu.CheckboxItemIndicator>
            </Menu.CheckboxItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
