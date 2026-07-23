export type NoteLocation =
  | { type: 'composer'; thought: string }
  | { type: 'note'; key: string }

export class NoteNavigation {
  private locations: NoteLocation[] = [{ type: 'composer', thought: '' }]
  private generation = 0
  private transitionPending = false

  startTransition() {
    if (this.transitionPending) return null
    this.transitionPending = true
    return this.generation
  }

  finishTransition() {
    this.transitionPending = false
  }

  isCurrent(generation: number) {
    return generation === this.generation
  }

  beginNote(key: string, push = true) {
    this.generation += 1
    if (push) this.locations.push({ type: 'note', key })
  }

  leaveNote() {
    this.generation += 1
  }

  previous() {
    return this.locations.at(-2) ?? null
  }

  commitBack() {
    if (this.locations.length > 1) this.locations.pop()
  }

  rename(oldKey: string, newKey: string) {
    this.locations = this.locations.map((location) =>
      location.type === 'note' && location.key === oldKey
        ? { ...location, key: newKey }
        : location,
    )
  }

  updateComposerThought(thought: string) {
    const composer = this.locations[0]
    if (composer?.type === 'composer') composer.thought = thought
  }

  entries() {
    return this.locations.map((location) => ({ ...location }))
  }
}
