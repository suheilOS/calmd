import { Button } from '@base-ui/react/button'
import { Input } from '@base-ui/react/input'
import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { MAX_NOTE_TITLE_LENGTH, type SearchHit } from './notes'
import { segmentSearchMatches } from './searchHighlight'

type ComposerScreenProps = {
  thought: string
  results: SearchHit[]
  hasExactMatch: boolean
  activeResultIndex: number
  onThoughtChange: (thought: string) => void
  onRandomNote: () => void
  onSubmit: () => void
  onResultSelect: (index: number) => void
  onActiveResultChange: (index: number) => void
}

const RESULT_CLASS_NAME =
  'group text-base block w-full rounded-xl bg-surface px-3 py-3 text-start text-ink transition-[background-color,color,transform] duration-150 ease-out aria-selected:bg-active aria-selected:text-active-ink focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-faint active:scale-[0.97]'

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
})

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function useToday(): Date {
  const [today, setToday] = useState(() => new Date())

  useEffect(() => {
    const nextDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const timeout = window.setTimeout(() => setToday(new Date()), nextDay.getTime() - Date.now())
    return () => window.clearTimeout(timeout)
  }, [today])

  return today
}

function highlightedText(text: string, query: string): ReactNode {
  return segmentSearchMatches(text, query).map((segment, index) => (
    segment.kind === 'match'
      ? <mark className="rounded-[2px] bg-selection text-selection-ink" key={index}>{segment.text}</mark>
      : segment.text
  ))
}

export function ComposerScreen({
  thought,
  results,
  hasExactMatch,
  activeResultIndex,
  onThoughtChange,
  onRandomNote,
  onSubmit,
  onResultSelect,
  onActiveResultChange,
}: ComposerScreenProps) {
  const today = useToday()
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
        <p className="mb-3 text-small text-secondary">
          <time dateTime={localDateKey(today)}>{dateFormatter.format(today)}</time>
        </p>
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
            dir="auto"
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

        <div
          aria-hidden={hasThought || undefined}
          className={`grid transition-[grid-template-rows,margin,opacity,transform] duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none ${hasThought ? 'pointer-events-none -translate-y-1 grid-rows-[0fr] mt-0 opacity-0' : 'grid-rows-[1fr] mt-4 opacity-100'}`}
        >
          <div className="min-h-0 overflow-hidden">
            <Button
              aria-keyshortcuts="Control+Alt+R Meta+Alt+R"
              className="-mx-2 inline-flex min-h-9 items-center rounded-lg px-2 text-small text-secondary transition-[background-color,color,transform] duration-150 ease-out enabled:hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.97] disabled:cursor-default"
              disabled={hasThought}
              onClick={onRandomNote}
              type="button"
            >
              Open a random note
            </Button>
          </div>
        </div>

        {hasThought ? (
          <div className="mt-4 space-y-2 motion-safe:animate-[result-in_180ms_ease-out]" id="search-results" role="listbox">
            {results.map((note, index) => (
              <Button
                aria-selected={activeResultIndex === index}
                className={RESULT_CLASS_NAME}
                id={`search-result-${index}`}
                key={note.key}
                onClick={() => onResultSelect(index)}
                onMouseEnter={() => onActiveResultChange(index)}
                role="option"
                type="button"
              >
                <bdi className="block break-words font-semibold" dir="auto">{highlightedText(note.title, thought)}</bdi>
                {note.excerpt ? <bdi className="mt-1 block truncate text-small text-faint group-aria-selected:text-active-muted group-focus-visible:text-active-muted" dir="auto">{highlightedText(note.excerpt, thought)}</bdi> : null}
              </Button>
            ))}
            {!hasExactMatch ? (
              <Button
                aria-selected={activeResultIndex === results.length}
                className={RESULT_CLASS_NAME}
                id={`search-result-${results.length}`}
                onClick={() => onResultSelect(results.length)}
                onMouseEnter={() => onActiveResultChange(results.length)}
                role="option"
                type="button"
              >
                Create “<bdi dir="auto">{thought.trim()}</bdi>”
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}
