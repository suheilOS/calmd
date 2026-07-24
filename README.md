# Calmd

A calm notes interface for developing or retrieving the current thought without exposing the size or structure of the collection.

## Current application

Calmd is a Tauri 2 desktop application backed by a portable, user-selected Markdown vault. It includes:

- A blank composer with ranked literal retrieval while typing
- Exact-title handling that opens an existing note instead of creating a duplicate
- Rust-owned create, read, save, and coordinated rename commands with conflict-safe Markdown writes
- A rebuildable schema-version-2 SQLite/FTS5 trigram index with concise excerpts and derived backlinks
- A minimal full-page note editor with automatic saving
- `[[target]]` and `[[target|display text]]` links with modifier-click open-or-create navigation
- Application-owned Back, Forward, and Home navigation gated by successful saves
- An on-demand backlinks popover
- Responsive light and dark styling

Markdown remains the source of truth. Internal links identify top-level Markdown filename stems case-insensitively. Paths, headings, blocks, embeds, multiline links, links in code, and ambiguous case-folded targets are unsupported. Embeddings and semantic retrieval remain deferred.

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
