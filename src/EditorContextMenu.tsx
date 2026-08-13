import { Menu } from '@base-ui/react/menu'
import type { MarkdownBlockKind } from './markdownBlockCommands'

type EditorContextMenuProps = {
  onBlockChange: (kind: MarkdownBlockKind) => void
  onSpellcheckChange: (enabled: boolean) => void
  spellcheckEnabled: boolean
}

const itemClassName =
  'flex h-10 cursor-default select-none items-center justify-between gap-4 rounded-lg px-3 text-small text-ink outline-none data-[highlighted]:bg-hover data-[disabled]:text-faint'

const popupClassName =
  'origin-[var(--transform-origin)] min-w-48 rounded-[0.875rem] bg-surface p-1.5 text-ink shadow-[0_8px_24px_oklch(0_0_0/0.18)] outline-none transition-[scale,opacity] duration-100 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0'

/** Button-triggered formatting menu that leaves the editor's native context menu intact. */
export function EditorContextMenu({
  onBlockChange,
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
          <span aria-hidden="true" className="-translate-y-px text-xl leading-none">⋯</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="z-50 outline-none">
            <Menu.Popup className={popupClassName}>
              <Menu.Item
                className={itemClassName}
                onClick={() => onBlockChange('paragraph')}
              >
                Paragraph
              </Menu.Item>
              <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger className={itemClassName}>
                  <span>Heading</span>
                  <span aria-hidden="true" className="text-faint">›</span>
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
                          Heading {level}
                        </Menu.Item>
                      ))}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.SubmenuRoot>
              <Menu.Item className={itemClassName} onClick={() => onBlockChange('quote')}>
                Quote
              </Menu.Item>
              <Menu.Item className={itemClassName} onClick={() => onBlockChange('bullet')}>
                Bulleted list
              </Menu.Item>
              <Menu.Item className={itemClassName} onClick={() => onBlockChange('ordered')}>
                Numbered list
              </Menu.Item>
              <Menu.Item className={itemClassName} onClick={() => onBlockChange('task')}>
                Task
              </Menu.Item>
              <Menu.Separator className="mx-2 my-1 h-px bg-divider" />
              <Menu.CheckboxItem
                checked={spellcheckEnabled}
                className={itemClassName}
                closeOnClick
                onCheckedChange={onSpellcheckChange}
              >
                <span>Spellcheck</span>
                <Menu.CheckboxItemIndicator aria-hidden="true" className="text-accent">
                  ✓
                </Menu.CheckboxItemIndicator>
              </Menu.CheckboxItem>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
    </Menu.Root>
  )
}
