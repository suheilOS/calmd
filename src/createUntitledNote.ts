import type { Note } from './notes'

type TransitionCoordinator = {
  startTransition: () => number | null
  isCurrent: (generation: number) => boolean
  finishTransition: () => void
}

type CreateUntitledNoteOptions = {
  navigation: TransitionCoordinator
  prepare: () => Promise<boolean>
  create: () => Promise<Note>
  open: (note: Note) => void
}

export async function createUntitledNote({
  navigation,
  prepare,
  create,
  open,
}: CreateUntitledNoteOptions) {
  const generation = navigation.startTransition()
  if (generation === null) return false

  try {
    if (!(await prepare()) || !navigation.isCurrent(generation)) return false

    const note = await create()
    if (!navigation.isCurrent(generation)) return false

    open(note)
    return true
  } finally {
    navigation.finishTransition()
  }
}
