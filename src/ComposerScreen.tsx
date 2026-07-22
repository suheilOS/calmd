import { Button } from '@base-ui/react/button'
import { Input } from '@base-ui/react/input'
import type { FormEvent, KeyboardEvent } from 'react'
import { getExcerpt, MAX_NOTE_TITLE_LENGTH, type Note } from './notes'

type ComposerScreenProps = {
  thought: string
  results: Note[]
  hasExactMatch: boolean
  activeResultIndex: number
  onThoughtChange: (thought: string) => void
  onSubmit: () => void
  onResultSelect: (index: number) => void
  onActiveResultChange: (index: number) => void
}

const RESULT_CLASS_NAME =
  'text-base block w-full px-2 py-3 text-left transition-[background-color,color,transform] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-faint active:scale-[0.97]'

export function ComposerScreen({
  thought,
  results,
  hasExactMatch,
  activeResultIndex,
  onThoughtChange,
  onSubmit,
  onResultSelect,
  onActiveResultChange,
}: ComposerScreenProps) {
  const hasThought = thought.trim().length > 0
  const optionCount = results.length + Number(!hasExactMatch)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!hasThought || optionCount === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onActiveResultChange(Math.min(activeResultIndex + 1, optionCount - 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onActiveResultChange(Math.max(activeResultIndex - 1, -1))
      return
    }

    if (event.key === 'Enter' && activeResultIndex >= 0) {
      event.preventDefault()
      onResultSelect(activeResultIndex)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      onThoughtChange('')
    }
  }

  return (
    <main className="app bg-canvas text-ink">
      <h1 className="sr-only">Calmd</h1>
      <section className="mx-auto w-full max-w-[65ch] px-6 pb-24 pt-[25vh] sm:px-8 sm:pt-[28vh]">
        <form onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="thought">Begin a thought</label>
          <Input
            aria-activedescendant={activeResultIndex >= 0 ? `search-result-${activeResultIndex}` : undefined}
            aria-autocomplete="list"
            aria-controls="search-results"
            aria-expanded={hasThought}
            aria-label="Begin a thought"
            autoFocus
            autoComplete="off"
            className="w-full border-0 bg-transparent p-0 text-base text-ink outline-none placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-faint"
            id="thought"
            maxLength={MAX_NOTE_TITLE_LENGTH}
            name="thought"
            onChange={(event) => onThoughtChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Find a note or start a thought…"
            role="combobox"
            value={thought}
          />
        </form>

        {hasThought ? (
          <div className="mt-4 border-t border-border motion-safe:animate-[result-in_180ms_ease-out]" id="search-results" role="listbox">
            {results.map((note, index) => (
              <Button
                aria-selected={activeResultIndex === index}
                className={`${RESULT_CLASS_NAME} border-b border-divider ${activeResultIndex === index ? 'bg-surface text-secondary' : 'text-ink'}`}
                id={`search-result-${index}`}
                key={note.key}
                onClick={() => onResultSelect(index)}
                onMouseEnter={() => onActiveResultChange(index)}
                role="option"
                type="button"
              >
                <span className="block break-words">{note.title}</span>
                {note.body ? <span className="mt-1 block truncate text-small text-faint">{getExcerpt(note.body)}</span> : null}
              </Button>
            ))}
            {!hasExactMatch ? (
              <Button
                aria-selected={activeResultIndex === results.length}
                className={`${RESULT_CLASS_NAME} ${activeResultIndex === results.length ? 'bg-surface text-ink' : 'text-secondary'}`}
                id={`search-result-${results.length}`}
                onClick={() => onResultSelect(results.length)}
                onMouseEnter={() => onActiveResultChange(results.length)}
                role="option"
                type="button"
              >
                Create “{thought.trim()}”
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}
