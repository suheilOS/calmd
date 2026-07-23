## Project State

Calmd is currently a Tauri 2 desktop application backed by top-level Markdown files in one user-selected, portable vault. Rust owns filesystem access through dedicated commands; a framework-independent Note persistence module owns Markdown parsing, filename policy, revisions, and atomic create/read/save/rename behavior. Vault selection is persisted separately. A rebuildable SQLite/FTS5 index under Tauri app data provides ranked literal search and excerpts; Markdown remains the sole source of truth. Frontend Note editing is a framework-neutral session module with autosave, save sequencing, and conflict handling behind a local-substitutable persistence seam. Supported wiki links use cursor-sensitive Live Preview and platform-specific modifier navigation through the conflict-safe persistence flow. Backlinks are derived from the rebuildable index and remain collapsed until requested. Embeddings and semantic retrieval remain deferred.

Current UI stack:

- React
- Vite
- TypeScript
- Tailwind CSS
- Base UI

## Product Goal

Build a calm notes app that keeps accumulated knowledge available without continuously exposing its scale.

The interface should feel like starting a thought, not managing a vault.

## Current Prototype Scope

Focus only on:

- A plain composer-style home screen
- Ranked literal retrieval through a derived index reconciled from the selected vault
- Creating and renaming portable Markdown notes through Rust
- A minimal full-page note editor with conflict-safe saving
- A backlinks popover revealed only when requested

Do not introduce embeddings or other backend architecture beyond the existing derived literal-search and backlink index during this phase.

## Constraints

- No sidebar
- No file tree
- No dashboard
- No graph view
- No visible note counts
- No recent-notes feed
- No folders, tags, or user-defined properties
- No always-visible panels
- No AI chat or automatic content generation
- Prefer retrieval over browsing
- Keep backlinks collapsed by default
- Avoid adding features outside the active phase

Every interface decision should answer:

> Does this help develop or retrieve the current thought without exposing the scale of the collection?

## UI

Use Base UI primitives and style them directly with Tailwind.

Base UI reference:

https://base-ui.com/llms.txt

Do not introduce another component library without explicit approval.

## Documentation

Implementation phases and detailed decisions belong in the `docs/` folder.

Keep this file limited to project-wide context and constraints.
