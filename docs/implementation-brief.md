# Product Implementation Brief

## Experience

The app opens to a single composer.

As the user types, it:

* Searches existing notes
* Shows relevant matches
* Offers to create a new note

There is no sidebar, file tree, dashboard, graph, note count, or recent-notes feed.

## Navigation

Knowledge is accessed through:

* Search
* Inline `[[links]]`
* Backlinks
* Browser-style back navigation

The full collection is never shown by default.

## Notes

* Stored as plain Markdown files
* Kept in one vault folder
* No folders, tags, or user-defined properties
* SQLite stores indexes and system metadata
* Markdown remains the source of truth

## Search

Use hybrid retrieval:

* SQLite FTS5 for exact text matching
* Embeddings for semantic similarity
* Combined ranking for final results

Results show the title and a short matching excerpt.

## Editor

* Full-page Markdown editor
* Automatic saving
* Minimal formatting controls
* Backlinks hidden until requested
* No permanent secondary panels

## Technology

* React + Vite
* Base UI
* Tailwind CSS
* CodeMirror
* Tauri
* Rust
* SQLite

## Initial Scope

1. Composer prototype with mock notes
2. Note editor
3. Title and body search
4. Note creation and saving
5. Wiki links and backlinks
6. Semantic search
7. Tauri and filesystem integration

## Constraint

Every feature must pass one test:

> Does this help the user retrieve or develop the current thought without exposing the scale of the entire collection?

