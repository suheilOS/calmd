# Unlinked mentions

Status: implemented. This file is retained as the historical implementation plan; the current behavior is documented in [the implementation brief](../implementation-brief.md), [derived index research](../derived-search-index-research.md), and [internal links and navigation research](../internal-links-navigation-research.md).

## Goal

Add a read-only **Unlinked mentions** section to the existing on-demand backlinks popover. It should show notes containing a plain-text occurrence of the current note's visible title. Selecting a result should open the source note through Calmd's existing save-gated navigation flow.

## Scope

- Keep the existing linked-backlinks section.
- Add an independently loaded **Unlinked mentions** section in the same popover.
- Match the current note's visible title using conservative, case-insensitive literal phrase matching.
- Return at most one deduplicated result per source note, with a bounded excerpt around the first unlinked occurrence.
- Make each unlinked-mention result a clickable button that passes its source note key to the existing `onSelect` handler.
- Reuse the existing note preview behavior for hover previews and the existing navigation/conflict handling for clicks.
- Keep the feature on-demand; do not add a permanent panel or visible vault counts.

## Explicit non-goals

- No aliases or YAML/frontmatter properties.
- No fuzzy, semantic, or stemming-based matching.
- No conversion of an unlinked mention into a wiki link.
- No cursor or scroll restoration to the occurrence.
- No new search backend or ranking architecture.
- No filesystem watcher or broader Markdown-link support.

## Matching contract

1. Resolve the requested target note by key and use its visible title, not its derived filename, as the mention text.
2. If the target title is not uniquely identifiable by title identity, return no unlinked mentions rather than attributing text ambiguously.
3. Search other indexed note bodies only; do not treat filenames or note titles as body mentions, and exclude the target note itself.
4. Treat an occurrence inside a supported wiki-link range as linked, including aliased wiki links, and exclude it from unlinked results.
5. Exclude inline-code and fenced-code ranges to avoid code and syntax false positives. Keep the matching rules aligned with Calmd's existing Markdown/link parser boundaries.
6. Use a literal phrase match with case-insensitive comparison and no semantic expansion. Avoid matching a title inside a larger alphanumeric token.
7. Group repeated matches from the same source note into one result and return a bounded, safe excerpt containing the first match.
8. Preserve the existing ambiguity behavior: unresolved or ambiguous note identities must not produce a result.

## Backend design

### Rust search layer

- Add an `UnlinkedMention` serializable result containing `key`, `title`, and `excerpt`.
- Add `SearchState::unlinked_mentions(key)` and a search-layer query that reuses the existing `notes` table, note bodies, FTS5 index, and indexed outgoing-link data.
- Use an FTS5 body-column query to find candidate notes for titles supported by the trigram index. Fall back to scanning indexed bodies for titles shorter than three Unicode characters, because SQLite's trigram full-text queries cannot match shorter substrings.
- Run exact occurrence filtering in Rust so results can exclude wiki-link and code ranges, apply token-boundary rules, deduplicate source notes, and produce bounded excerpts.
- Keep the derived index as the only retrieval backend. No schema version change is expected for the first implementation because note bodies and outgoing-link positions already exist in the index.

### Tauri command

- Add `get_unlinked_mentions(key)` to Retrieval and expose it through the Tauri command adapter.
- Reconcile the derived index before querying, following the existing backlinks command behavior.
- Register the command in `src-tauri/src/lib.rs`.
- Preserve the existing behavior where index failures affect retrieval only and never roll back Markdown persistence.

## Frontend design

- Add an `UnlinkedMention` type and `getStoredUnlinkedMentions(key)` adapter in `src/notes.ts` and `src/storage.ts`.
- Extend `BacklinksPopover` with separate state and request-generation protection for linked backlinks and unlinked mentions.
- Load both sections only when the popover opens. A failure in the unlinked-mention request should not hide successfully loaded linked backlinks.
- Render unlinked results as source-note buttons with a compact excerpt and title-match highlighting. Keep the popover bounded and compact.
- Pass the source key to the existing `onSelect` callback. `App.openNote()` remains responsible for flushing, conflict vetoes, reading the destination, and updating application history.
- Reuse the existing backlink preview candidate path for hover previews.
- Update accessible labels and empty/error copy so the two sections are distinguishable without introducing counts.

## Tests

### Rust

Add search tests covering:

- A plain title occurrence is returned with the correct source and excerpt.
- Repeated occurrences in one source are deduplicated.
- Matching is case-insensitive and uses the visible title when it differs from the filename.
- The target note itself is excluded.
- Supported wiki links and aliased wiki links are excluded.
- Inline code and fenced code are excluded.
- Titles shorter than three Unicode characters use the fallback path.
- Ambiguous duplicate title identities return no unlinked mentions.
- Excerpts are bounded and do not expose raw wiki-link syntax unexpectedly.
- A source with both linked and unlinked occurrences appears in the appropriate sections.

### Frontend/build validation

- TypeScript compilation and linting cover the new result type and storage adapter.
- Run the existing Bun tests and production build.
- Run Rust formatting, Clippy, and Rust tests.

## Manual acceptance check

1. Create note `Target`.
2. Create note `Source` containing ordinary text with `Target`, plus a `[[Target]]` link and a code block containing `Target`.
3. Open `Target` and open the links popover.
4. Confirm `Source` appears under **Unlinked mentions** only for the ordinary text occurrence.
5. Click the unlinked result and confirm `Source` opens through normal navigation.
6. Make an unsaved edit before clicking and confirm the existing flush/conflict behavior still applies.
7. Confirm linked backlinks remain unchanged and the popover stays hidden until requested.

## Documentation cleanup

Completed. Permanent documentation now records title-only unlinked mentions, code and wiki-link exclusion, ambiguity handling, bounded excerpts, on-demand loading, and save-gated navigation.
