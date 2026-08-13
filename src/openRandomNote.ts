import type { Note } from './notes'

type TransitionCoordinator = {
  startTransition: () => number | null
  isCurrent: (generation: number) => boolean
  finishTransition: () => void
}

type PreparedRandomNote = {
  currentKey: string | null
}

type OpenRandomNoteOptions = {
  navigation: TransitionCoordinator
  prepare: () => Promise<PreparedRandomNote | null>
  pick: (excludedKey: string | null) => Promise<Note | null>
  open: (note: Note) => void
}

export type OpenRandomNoteResult = 'blocked' | 'empty' | 'unchanged' | 'opened'

export async function openRandomNote({
  navigation,
  prepare,
  pick,
  open,
}: OpenRandomNoteOptions): Promise<OpenRandomNoteResult> {
  const generation = navigation.startTransition()
  if (generation === null) return 'blocked'

  try {
    const prepared = await prepare()
    if (!prepared || !navigation.isCurrent(generation)) return 'blocked'

    const note = await pick(prepared.currentKey)
    if (!navigation.isCurrent(generation)) return 'blocked'
    if (!note) return 'empty'
    if (note.key === prepared.currentKey) return 'unchanged'

    open(note)
    return 'opened'
  } finally {
    navigation.finishTransition()
  }
}
