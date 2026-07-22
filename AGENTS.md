## Project State

This project is currently a non-functional web prototype.

Current stack:

- React
- Vite
- TypeScript
- Tailwind CSS
- Base UI

Tauri, Rust, SQLite, filesystem storage, backlinks, and semantic search are not implemented yet.

## Product Goal

Build a calm notes app that keeps accumulated knowledge available without continuously exposing its scale.

The interface should feel like starting a thought, not managing a vault.

## Current Prototype Scope

Focus only on:

- A plain composer-style home screen
- Mock search results while typing
- Creating a note from the composer
- A minimal full-page note editor
- Backlinks revealed only when requested

Use static or mocked data. Do not introduce backend architecture during this phase.

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
