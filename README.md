# Calmd

A calm notes interface for developing or retrieving the current thought without exposing the size or structure of the collection.

## Current application

Calmd is a Tauri 2 desktop application backed by a portable, user-selected Markdown vault. It includes:

- A blank composer with ranked literal retrieval while typing
- Exact-title handling that opens an existing note instead of creating a duplicate
- Rust-owned create, read, save, and rename commands with conflict-safe Markdown writes
- A rebuildable SQLite/FTS5 trigram index with concise match-specific excerpts
- A minimal full-page note editor with automatic saving
- Keyboard and pointer navigation through retrieval results
- A hidden backlinks popover with static placeholder content
- Responsive light and dark styling

Markdown remains the source of truth. Backlink discovery, wiki-link behavior, embeddings, and semantic retrieval are deferred.

## Development

```sh
bun install
bun run dev
```

To run the desktop shell:

```sh
bun run tauri:dev
```

## Checks

```sh
bun test
bun run lint
bun run build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
```
