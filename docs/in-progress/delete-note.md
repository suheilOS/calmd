# Delete note

## Goal

Complete note CRUD by allowing the currently open note to be permanently deleted from Calmd without requiring the user to use a file explorer.

## Approved product behavior

- Expose note actions through a contextual overflow menu in the title bar, immediately before the window controls.
- Put **Delete note** in that menu as a destructive action.
- Confirm deletion with a Base UI `Dialog`; do not add a dependency or use another component library.
- Permanently remove the selected top-level Markdown file from the vault.
- Flush pending editor changes before deletion. If flushing fails or detects a conflict, do not delete the file.
- Return to the composer after a successful deletion.
- Remove deleted-note entries from application navigation history so Back/Forward cannot reopen a missing file.
- Refresh the derived retrieval index and close note-specific UI state.
- Preserve wiki links in other notes. Deleting a target must not rewrite or remove those source links.

## Explicit non-goals

- No trash/recycle-bin integration.
- No undo or restore flow.
- No filesystem watcher.
- No folders, bulk deletion, multi-select, or collection browser.
- No changes to the search backend or ranking architecture.
- No deletion of linked notes or automatic link cleanup.

## Existing flow and boundaries

- `src-tauri/src/note_persistence.rs` owns safe Markdown filesystem behavior, revisions, and path validation.
- `src-tauri/src/storage.rs` owns Tauri commands and best-effort derived-index updates.
- `src-tauri/src/search.rs` owns the rebuildable SQLite/FTS5 index.
- `src/useNoteEditing.ts` and `src/noteEditing.ts` own autosave, flush, and conflict handling.
- `src/TitleBar.tsx` owns the title-bar controls.
- `src/App.tsx` owns note-level orchestration, navigation, and return-to-composer behavior.
- `src/noteNavigation.ts` owns application history and must gain deletion-aware history handling.

## Implementation steps

### 1. Add conflict-safe filesystem deletion

In `src-tauri/src/note_persistence.rs`:

1. Add `NotePersistence::delete(key, expected_revision) -> PersistenceResult<()>`.
2. Resolve the key through `validated_note_path` so traversal, nested paths, symlinks, and non-regular files remain rejected by the existing policy.
3. Verify the content hash with `ensure_revision` before unlinking.
4. Remove the validated file with `fs::remove_file`.
5. Return a conflict when the note disappeared or changed before deletion; return the existing structured I/O errors for other failures.

Add tests for successful deletion, revision conflicts leaving the file intact, and invalid/missing keys.

### 2. Keep the derived search index consistent

In `src-tauri/src/search.rs`:

1. Add a transactional `SearchState::remove(key)` operation.
2. Delete the matching `notes` row so existing FTS delete triggers and `note_links` foreign-key cascades run.
3. Mark the index dirty if the update fails; the next reconciliation must remain able to rebuild it from Markdown.

In `src-tauri/src/storage.rs`:

1. Add the `delete_note` Tauri command accepting `key` and `expected_revision`.
2. Validate the vault, delete the Markdown source through `NotePersistence`, then best-effort remove the derived index row.
3. Keep Markdown deletion authoritative: an index failure must not report the source deletion as failed.

Register `delete_note` in `src-tauri/src/lib.rs`.

Add search tests proving deleted notes no longer appear in retrieval or backlinks while unrelated outgoing links remain represented correctly.

### 3. Add the frontend persistence call

In `src/storage.ts`:

1. Add `deleteStoredNote(key, expectedRevision)` invoking `delete_note`.
2. Keep deletion separate from `NotePersistenceAdapter`; the editing session should continue to own read/save/rename/autosave, while `App` coordinates flush-then-delete.

### 4. Add the title-bar action and confirmation UI

In the existing React/Base UI layer:

1. Add a note-specific overflow trigger to `src/TitleBar.tsx`, shown only while editing and placed before the window controls.
2. Use the installed Base UI menu primitive for the action list.
3. Add **Delete note** with destructive styling and the existing minimum desktop hit area.
4. Use `Dialog` from `@base-ui/react/dialog` for confirmation, styled directly with Tailwind.
5. Provide an accessible title, clear permanent-deletion description, explicit Cancel and Delete buttons, Escape-to-cancel behavior, and sensible focus placement.
6. Keep the dialog controlled by `App` or a small note-actions component so the actual deletion remains in the application orchestration layer.

### 5. Coordinate deletion with editing and navigation

In `src/App.tsx` and `src/noteNavigation.ts`:

1. Open the confirmation dialog from the note-actions menu without mutating the note.
2. After confirmation, start a save-gated transition and flush the active `NoteEditingSession` before calling the backend, using the returned authoritative key and revision in case a pending rename completed.
3. Call `deleteStoredNote` with that key and revision.
4. On success, close the editing session, remove all history entries for the deleted note (or otherwise guarantee it cannot be revisited), return to the composer, close backlinks state, clear stale messages, and increment the search generation.
5. On conflict or any failure, leave the editor open and display the structured storage error.
6. Prevent concurrent navigation or duplicate delete requests while the operation is pending.

Add focused TypeScript tests for removing deleted notes from history and preserving valid composer/note history around the removal.

### 6. Update durable documentation

After implementation is accepted:

- Update `docs/implementation-brief.md` to list deletion among completed storage capabilities and remove it from remaining limitations.
- Document the permanent-delete, revision-check, confirmation, and link-preservation behavior in the relevant storage/internal-linking documentation.
- Remove this in-progress plan after the permanent documentation is updated.

## Validation

Run:

```sh
bun test
bun run lint
bun run build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
```

Also manually verify that:

- A note with unsaved edits cannot be deleted until those edits flush successfully.
- A changed note on disk produces a conflict and remains present.
- The deleted note disappears from retrieval immediately.
- Back/Forward cannot navigate back to the deleted note.
- Links to the deleted note remain in their source Markdown files.
