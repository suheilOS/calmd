# Product Implementation Brief

## Current phase: interactive UI prototype with Tauri shell

This phase validates the appearance and core interaction model using React state and mock notes, with the UI runnable inside a Tauri 2 desktop shell. It does not validate persistence, backend architecture, semantic retrieval, wiki links, or backlink discovery.

### Completed

- Blank composer with no collection overview or recent-notes feed
- Mock title and body retrieval while typing
- Exact-title matching that opens the existing note instead of creating a duplicate
- Keyboard and pointer navigation through retrieval results
- In-memory note creation and editing
- Debounced in-memory saving while the app remains open
- Minimal full-page editor with return navigation
- On-demand backlinks popover with static empty-state content
- Responsive light and dark presentation using a restrained three-level type scale

### Deferred

- Persistent Markdown and filesystem storage
- Rust commands and application integration
- SQLite, FTS5, embeddings, and combined ranking
- Inline `[[links]]` and backlink discovery
- CodeMirror integration and formatting controls
- Browser-history-backed navigation

## Target experience

The app opens to a single composer.

As the user types, it:

* Searches existing notes
* Shows relevant matches
* Offers to create a new note

There is no sidebar, file tree, dashboard, graph, note count, or recent-notes feed.

## Target navigation

Knowledge is accessed through:

* Search
* Inline `[[links]]`
* Backlinks
* Browser-style back navigation

The full collection is never shown by default.

## Target note storage

* Stored as plain Markdown files
* Kept in one vault folder
* No folders, tags, or user-defined properties
* SQLite stores indexes and system metadata
* Markdown remains the source of truth

## Target search

Use hybrid retrieval:

* SQLite FTS5 for exact text matching
* Embeddings for semantic similarity
* Combined ranking for final results

Results show the title and a short matching excerpt.

## Target editor

* Full-page Markdown editor
* Automatic saving
* Minimal formatting controls
* Backlinks hidden until requested
* No permanent secondary panels

## Target technology

* React + Vite
* Base UI
* Tauri 2 desktop shell
* Tailwind CSS
* CodeMirror
* Rust
* SQLite

## Delivery roadmap

1. **Completed:** Composer prototype with mock notes
2. **Completed:** Minimal note editor
3. **Prototype only:** Literal title and body retrieval over mock notes
4. **Prototype only:** In-memory note creation and saving
5. **UI placeholder only:** Backlinks popover; wiki links and backlink discovery remain deferred
6. **Deferred:** Semantic search
7. **Deferred:** Tauri and filesystem integration

## Constraint

Every feature must pass one test:

> Does this help the user retrieve or develop the current thought without exposing the scale of the entire collection?

