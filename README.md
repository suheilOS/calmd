# Calmd

A calm notes interface for developing or retrieving the current thought without exposing the size or structure of the collection.

## Current prototype

The project is an interactive React prototype backed by in-memory mock data. It includes:

- A blank composer that retrieves mock notes while typing
- Exact-title handling and in-memory note creation
- A minimal full-page note editor with in-memory autosave
- Keyboard and pointer navigation through retrieval results
- A hidden backlinks popover with static placeholder content
- Responsive light and dark styling

Persistence, filesystem storage, backlink discovery, wiki links, semantic search, SQLite, Rust, and Tauri are not implemented.

## Development

```sh
bun install
bun run dev
```

## Checks

```sh
bun run lint
bun run build
```
