type KeyboardShortcut = Pick<KeyboardEvent,
  'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
>

function isInitialCtrlKey(event: KeyboardShortcut, key: string) {
  return !event.repeat
    && event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && event.key.toLowerCase() === key
}

export function isCreateUntitledShortcut(event: KeyboardShortcut) {
  return isInitialCtrlKey(event, 'n') && !event.shiftKey
}

export function isNavigateHomeShortcut(event: KeyboardShortcut) {
  return isInitialCtrlKey(event, 'h') && event.shiftKey
}
