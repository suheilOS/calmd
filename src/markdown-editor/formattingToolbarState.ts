import type { FormattingToolbarSnapshot } from './contracts'

export type FormattingToolbarState =
  | { kind: 'hidden' }
  | { kind: 'focus-pending' }
  | { kind: 'dismissed'; snapshot: FormattingToolbarSnapshot }
  | {
    kind: 'visible'
    focusRequested: boolean
    snapshot: FormattingToolbarSnapshot
  }

export type FormattingToolbarAction =
  | { type: 'snapshot'; snapshot: FormattingToolbarSnapshot | null }
  | { type: 'request-focus' }
  | { type: 'focus-handled' }
  | { type: 'dismiss' }

export const initialFormattingToolbarState: FormattingToolbarState = { kind: 'hidden' }

export function reduceFormattingToolbarState(
  state: FormattingToolbarState,
  action: FormattingToolbarAction,
): FormattingToolbarState {
  switch (action.type) {
    case 'snapshot': {
      if (!action.snapshot) {
        return state.kind === 'hidden' ? state : { kind: 'hidden' }
      }
      if (
        state.kind === 'dismissed'
        && state.snapshot.selectionRevision === action.snapshot.selectionRevision
      ) return state
      return {
        kind: 'visible',
        focusRequested: state.kind === 'focus-pending'
          || (state.kind === 'visible' && state.focusRequested),
        snapshot: action.snapshot,
      }
    }
    case 'request-focus':
      if (state.kind === 'dismissed') {
        return { kind: 'visible', focusRequested: true, snapshot: state.snapshot }
      }
      if (state.kind !== 'visible') return { kind: 'focus-pending' }
      return { ...state, focusRequested: true }
    case 'focus-handled':
      if (state.kind !== 'visible' || !state.focusRequested) return state
      return { ...state, focusRequested: false }
    case 'dismiss':
      if (state.kind !== 'visible') return state
      return {
        kind: 'dismissed',
        snapshot: state.snapshot,
      }
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}
