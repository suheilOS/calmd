type KeyboardShortcut = Pick<KeyboardEvent,
  'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
>

type RandomNoteShortcut = KeyboardShortcut & Pick<KeyboardEvent, 'code'>

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
