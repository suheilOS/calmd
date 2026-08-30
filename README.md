# Calmd

A calm notes interface for developing or retrieving the current thought without exposing the size or structure of the collection.

## Current application

Calmd is a Tauri 2 desktop application backed by a portable Markdown vault. It includes:

- A blank composer with ranked literal retrieval while typing
- Literal match highlighting in result titles and excerpts
- Exact-title handling that opens an existing note instead of creating a duplicate
- Rust-owned create, read, save, and coordinated rename commands with conflict-safe Markdown writes
- A rebuildable schema-version-4 SQLite/FTS5 trigram index with concise excerpts, derived backlinks, and title-based unlinked mentions
- A minimal full-page CodeMirror Markdown editor with automatic saving, configurable spellcheck, and in-memory cursor and scroll restoration
- `[[target]]` and `[[target|display text]]` links with modifier-click open-or-create navigation
- Application-owned Back, Forward, and Home navigation gated by successful saves
- An on-demand links popover containing backlinks and unlinked mentions
- Portable local PNG, JPEG, GIF, and WebP images imported by paste or a native picker
- Conflict-safe permanent note deletion that preserves links and attachments
- Optional Substack export with a per-user publication URL stored in application settings
- Responsive light and dark styling

Markdown remains the source of truth. Internal links identify top-level Markdown filename stems case-insensitively. Paths, headings, blocks, embeds, multiline links, links in code, and ambiguous case-folded targets are unsupported.

## Development

Install Bun and the Rust toolchain, then run:

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
