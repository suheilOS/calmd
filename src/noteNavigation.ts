export type NoteLocation =
  | { type: 'composer'; thought: string }
  | { type: 'note'; key: string }

export class NoteNavigation {
  private locations: NoteLocation[] = [{ type: 'composer', thought: '' }]
  private index = 0
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

  private push(location: NoteLocation) {
    this.locations = [
      ...this.locations.slice(0, this.index + 1),
      location,
    ]
    this.index = this.locations.length - 1
    this.generation += 1
  }

  beginNote(key: string) {
    this.push({ type: 'note', key })
  }

  beginComposer(thought = '') {
    this.push({ type: 'composer', thought })
  }

  current() {
    const location = this.locations[this.index]
    return location ? { ...location } : null
  }

  canGoBack() {
    return this.index > 0
  }

  canGoForward() {
    return this.index < this.locations.length - 1
  }

  previous() {
    const location = this.locations[this.index - 1]
    return location ? { ...location } : null
  }

  next() {
    const location = this.locations[this.index + 1]
    return location ? { ...location } : null
  }

  commitBack() {
    if (!this.canGoBack()) return false
    this.index -= 1
    this.generation += 1
    return true
  }

  commitForward() {
    if (!this.canGoForward()) return false
    this.index += 1
    this.generation += 1
    return true
  }

  rename(oldKey: string, newKey: string) {
    this.locations = this.locations.map((location) =>
      location.type === 'note' && location.key === oldKey
        ? { ...location, key: newKey }
        : location,
    )
  }

  updateComposerThought(thought: string) {
    const composer = this.locations[this.index]
    if (composer?.type === 'composer') composer.thought = thought
  }

  entries() {
    return this.locations.map((location) => ({ ...location }))
  }
}
