type KeyboardShortcutEvent = Pick<KeyboardEvent,
  'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
>

type RandomNoteShortcut = KeyboardShortcutEvent & Pick<KeyboardEvent, 'code'>

export type KeyboardShortcut = {
  label: string
  keys: string
}

export type KeyboardShortcutSection = {
  label: string
  shortcuts: readonly KeyboardShortcut[]
}

/** The shortcuts users can use to navigate Calmd and work in notes. */
export const KEYBOARD_SHORTCUT_SECTIONS: readonly KeyboardShortcutSection[] = [
  {
    label: 'Navigation',
    shortcuts: [
      { label: 'Go back', keys: 'Ctrl/Cmd + [' },
      { label: 'Go forward', keys: 'Ctrl/Cmd + ]' },
      { label: 'Go home', keys: 'Alt + H' },
      { label: 'Create a new note', keys: 'Ctrl + N' },
      { label: 'Open a random note', keys: 'Ctrl/Cmd + Alt + R' },
    ],
  },
  {
    label: 'Composer',
    shortcuts: [
      { label: 'Move through search results', keys: '↑ / ↓' },
      { label: 'Open or create a note', keys: 'Enter' },
      { label: 'Clear the thought', keys: 'Escape' },
    ],
  },
  {
    label: 'Formatting',
    shortcuts: [
      { label: 'Bold', keys: 'Ctrl/Cmd + B' },
      { label: 'Italic', keys: 'Ctrl/Cmd + I' },
      { label: 'Inline code', keys: 'Ctrl/Cmd + `' },
      { label: 'Highlight', keys: 'Ctrl/Cmd + Shift + H' },
      { label: 'Strikethrough', keys: 'Ctrl/Cmd + Shift + X' },
      { label: 'Link', keys: 'Ctrl/Cmd + K' },
      { label: 'Heading 1–6', keys: 'Ctrl/Cmd + Alt + 1–6' },
      { label: 'Ordered list', keys: 'Ctrl/Cmd + Shift + 7' },
      { label: 'Bulleted list', keys: 'Ctrl/Cmd + Shift + 8' },
      { label: 'Quote', keys: 'Ctrl/Cmd + Shift + 9' },
      { label: 'Task list', keys: 'Ctrl/Cmd + Shift + L' },
      { label: 'Open the formatting toolbar', keys: 'Alt + F10' },
    ],
  },
  {
    label: 'Editor',
    shortcuts: [
      { label: 'Move from the title to the body', keys: 'Enter' },
      { label: 'Continue or exit a list or quote', keys: 'Enter' },
      { label: 'Indent or outdent a selection', keys: 'Tab / Shift + Tab' },
      { label: 'Undo', keys: 'Ctrl/Cmd + Z' },
      { label: 'Redo', keys: 'Ctrl + Y / Ctrl + Shift + Z / Cmd + Shift + Z' },
      { label: 'Find in the note', keys: 'Ctrl/Cmd + F' },
      { label: 'Find next', keys: 'Ctrl/Cmd + G / F3' },
      { label: 'Find previous', keys: 'Shift + Ctrl/Cmd + G / Shift + F3' },
      { label: 'Select all', keys: 'Ctrl/Cmd + A' },
      { label: 'Select the next occurrence', keys: 'Ctrl/Cmd + D' },
    ],
  },
]

function isInitialCtrlKey(event: KeyboardShortcutEvent, key: string) {
  return !event.repeat
    && event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && event.key.toLowerCase() === key
}

export function isCreateUntitledShortcut(event: KeyboardShortcutEvent) {
  return isInitialCtrlKey(event, 'n') && !event.shiftKey
}

export function isNavigateHomeShortcut(event: KeyboardShortcutEvent) {
  return !event.repeat
    && event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && event.key.toLowerCase() === 'h'
}

export function isOpenRandomNoteShortcut(event: RandomNoteShortcut) {
  return !event.repeat
    && event.altKey
    && !event.shiftKey
    && event.ctrlKey !== event.metaKey
    && event.code === 'KeyR'
}
