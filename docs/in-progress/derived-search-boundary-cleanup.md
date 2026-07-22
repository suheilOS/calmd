# Derived Search Boundary Cleanup

## Goal

Keep Markdown storage as the sole source of truth while making note creation direct and keeping derived-index consistency policy out of individual Tauri commands.

The implementation should preserve all current behavior:

- submitting an existing title opens that note
- submitting a new title creates it
- index failures never invalidate a successful Markdown write
- corrupt or incompatible indexes are rebuilt from the vault
- searches remain asynchronous and do not block the UI

## Problems to solve

1. `App.createNote` performs an exact-result check, another explicit search request, and then an authoritative create request. The Rust `create_note` command already performs the source-of-truth exact-title lookup, so the extra search adds latency and race-prone fallback control flow without adding correctness.
2. `storage.rs` repeats derived-index policy across vault opening, searching, creating, saving, and renaming. Dirty-state handling, best-effort updates, and recoverable-error rebuilding should have one obvious home before more indexed operations are added.

## Design

### 1. Make `create_note` the canonical open-or-create operation

Treat the existing Rust command contract as authoritative:

- canonicalize the requested title
- return the existing exact-title note when present
- otherwise create and return a new note
- best-effort update the derived index for the returned note

In `src/App.tsx`, retain the already-loaded `exactNote` shortcut because it avoids a filesystem command when the current search response is known to be exact. Otherwise call `createStoredNote(title)` directly and begin editing its returned note.

Do not issue a second `searchStoredNotes` request from `createNote`, and do not catch search errors as part of creation. Search availability must not control whether a note can be opened or created.

### 2. Consolidate index policy behind focused `SearchState` operations

Keep filesystem ownership in `storage.rs` and SQLite ownership in `search.rs`. Do not introduce a generic repository, event bus, callback-heavy API, or trait hierarchy.

Add focused operations to `SearchState` that own index lifecycle policy:

- a best-effort reconciliation operation used when opening or selecting a vault; it marks the index dirty and logs on failure
- a best-effort note replacement operation used after successful create/save/rename; it marks the index dirty and logs on failure
- a query operation that handles recoverable SQLite failures consistently once supplied with the current vault snapshot

Keep scanning and conversion from `Note` to `IndexedNote` in the storage layer because Markdown remains the canonical data source. Centralize the command-side scan-and-query flow in one helper rather than scattering `needs_reconciliation`, retry, and error mapping branches through the command.

The resulting command flow should read directly:

1. resolve the selected vault
2. ask the index whether reconciliation is required
3. scan only when required
4. query
5. on a recoverable index failure, rebuild once from a fresh scan and retry once

Avoid eagerly scanning on every query. Avoid hiding filesystem failures inside `SearchError`; storage errors should retain their existing command error codes.

### 3. Keep lock scope explicit

Preserve the current vault-before-index lock order, but clone the resolved vault path and release the `VaultState` mutex before filesystem scans or SQLite work. The selected path is immutable for the lifetime of an individual command, and long-running reconciliation should not unnecessarily hold the vault-state mutex.

Apply this consistently to `open_vault_in`, `search_notes_in`, and mutation commands where practical. Markdown writes must remain serialized as required by the existing revision and atomic-write behavior; do not weaken conflict protection merely to shorten a lock scope.

## Implementation steps

1. **Simplify frontend creation** — `src/App.tsx`
   - Remove the explicit `searchStoredNotes(title)` block from `createNote`.
   - Keep the current exact-result fast path.
   - Otherwise call `createStoredNote(title)` once and edit the returned note.
   - Confirm that search errors no longer participate in creation control flow.

2. **Name the backend contract clearly** — `src-tauri/src/storage.rs`, `src/storage.ts`
   - Keep the Tauri command name stable unless a rename materially improves clarity without migration cost.
   - Add a concise comment or function name making it explicit that creation returns an existing exact-title note.
   - Do not add a second `find_or_create` command or wrapper around the same behavior.

3. **Centralize best-effort index maintenance** — `src-tauri/src/search.rs`, `src-tauri/src/storage.rs`
   - Move dirty-state transitions for failed reconciliation and note replacement into `SearchState` methods.
   - Replace command-level `mark_dirty`/logging repetition with focused calls.
   - Keep logging messages contextual enough to distinguish reconciliation from post-write staleness.

4. **Centralize recoverable search retry** — `src-tauri/src/storage.rs`, with lifecycle mechanics in `src-tauri/src/search.rs`
   - Extract one direct helper for “query, rebuild from a fresh vault scan if required/recoverable, retry once.”
   - Preserve storage errors from scanning and map only index failures to the `search` command error.
   - Ensure a failed retry leaves the index dirty for the next request.
   - Do not add recursive retries or silent infinite rebuild loops.

5. **Tighten lock scopes** — `src-tauri/src/storage.rs`
   - Resolve and clone the vault root through a small canonical helper.
   - Release the vault-state guard before scanning or reconciling where this does not compromise write serialization.
   - Document any mutation path that intentionally retains the guard through the write.

6. **Add regression coverage**
   - Frontend: extract the create/open decision only if necessary for a meaningful unit test; avoid refactoring `App` solely to test implementation details.
   - Rust storage test: verify `create_note`’s underlying source-of-truth operation returns an existing exact-title note and does not create a collision-suffixed duplicate.
   - Rust search tests: verify a failed best-effort update marks the index dirty, a recoverable failure rebuilds at most once, and a successful retry clears dirty state.
   - Preserve existing corruption, rename replacement, Unicode, and Markdown durability tests.

7. **Update durable documentation**
   - Update `docs/implementation-brief.md` only if its command/lifecycle description changes.
   - Keep `AGENTS.md` limited to project-wide facts; no update is needed if its current source-of-truth and derived-index statements remain accurate.
   - Remove this in-progress plan after acceptance and after any durable documentation updates.

## Validation

Run:

```bash
bun test
bun run lint
bun run build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
```

Manual checks in the Tauri app:

1. Search for an existing title and submit it; the existing note opens.
2. Submit an existing title before the debounced result arrives; no duplicate file is created.
3. Submit a new title; exactly one Markdown file is created and opened.
4. Save and rename a note, then immediately retrieve it under its new content/title.
5. Modify a Markdown file externally, refocus the app, and verify reconciliation updates retrieval.
6. Make the index unavailable or corrupt in a development fixture and verify Markdown creation/saving still succeeds while search reports or recovers from the derived-index failure.

## Acceptance criteria

- Creation performs at most one authoritative backend request after the optional current-result fast path.
- Search failure cannot prevent source-of-truth note creation or opening.
- Exact-title creation cannot produce a duplicate note.
- Individual storage commands no longer manually repeat dirty-state and best-effort index policy.
- Recoverable index failures rebuild and retry once; non-recoverable failures remain explicit.
- Filesystem and index work do not hold the vault-state mutex longer than required.
- No new generic abstraction, duplicate command, or cross-layer error type is introduced.
- All automated and manual validation passes.
