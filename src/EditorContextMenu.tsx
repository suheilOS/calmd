import { ContextMenu } from '@base-ui/react/context-menu'
import type { ReactNode } from 'react'
import type { MarkdownBlockKind } from './markdownBlockCommands'

type EditorContextMenuProps = {
  children: ReactNode
  onBlockChange: (kind: MarkdownBlockKind) => void
  onSpellcheckChange: (enabled: boolean) => void
  spellcheckEnabled: boolean
}

const itemClassName =
  'flex h-10 cursor-default select-none items-center justify-between gap-4 rounded-lg px-3 text-small text-ink outline-none data-[highlighted]:bg-hover data-[disabled]:text-faint'

const popupClassName =
  'origin-[var(--transform-origin)] min-w-48 rounded-[0.875rem] bg-surface p-1.5 text-ink shadow-[0_8px_24px_oklch(0_0_0/0.18)] outline-none transition-[scale,opacity] duration-100 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0'

export function EditorContextMenu({
  children,
  onBlockChange,
  onSpellcheckChange,
  spellcheckEnabled,
}: EditorContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger className="block">{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50 outline-none">
          <ContextMenu.Popup className={popupClassName}>
            <ContextMenu.Item
              className={itemClassName}
              onClick={() => onBlockChange('paragraph')}
            >
              Paragraph
            </ContextMenu.Item>
            <ContextMenu.SubmenuRoot>
              <ContextMenu.SubmenuTrigger className={itemClassName}>
                <span>Heading</span>
                <span aria-hidden="true" className="text-faint">›</span>
              </ContextMenu.SubmenuTrigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner
                  alignOffset={-6}
                  className="z-50 outline-none"
                  sideOffset={4}
                >
                  <ContextMenu.Popup className={popupClassName}>
                    {([1, 2, 3, 4, 5, 6] as const).map((level) => (
                      <ContextMenu.Item
                        className={itemClassName}
                        key={level}
                        onClick={() => onBlockChange(`heading-${level}`)}
                      >
                        Heading {level}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.SubmenuRoot>
            <ContextMenu.Item className={itemClassName} onClick={() => onBlockChange('quote')}>
              Quote
            </ContextMenu.Item>
            <ContextMenu.Item className={itemClassName} onClick={() => onBlockChange('bullet')}>
              Bulleted list
            </ContextMenu.Item>
            <ContextMenu.Item className={itemClassName} onClick={() => onBlockChange('ordered')}>
              Numbered list
            </ContextMenu.Item>
            <ContextMenu.Item className={itemClassName} onClick={() => onBlockChange('task')}>
              Task
            </ContextMenu.Item>
            <ContextMenu.Separator className="mx-2 my-1 h-px bg-divider" />
            <ContextMenu.CheckboxItem
              checked={spellcheckEnabled}
              className={itemClassName}
              closeOnClick
              onCheckedChange={onSpellcheckChange}
            >
              <span>Spellcheck</span>
              <ContextMenu.CheckboxItemIndicator aria-hidden="true" className="text-accent">
                ✓
              </ContextMenu.CheckboxItemIndicator>
            </ContextMenu.CheckboxItem>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
