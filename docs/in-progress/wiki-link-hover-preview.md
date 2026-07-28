# Ctrl/Cmd-hover note preview implementation plan

## Status

Implemented; pending manual acceptance. Durable behavior is recorded in `docs/adr/0002-internal-links-and-navigation.md` and `docs/markdown-editor.md`. Remove this plan after acceptance.

## Goal

Add one calm, read-only note preview surface that appears when the user holds the platform navigation modifier and hovers either:

- a supported inline `[[wiki link]]` in the CodeMirror editor, or
- a note entry in the backlinks popover.

Use `Ctrl` on Windows and Linux and `Cmd` on macOS, matching existing modifier-click navigation. The preview shows the resolved note title and a bounded, lightly formatted leading excerpt without navigating, saving, creating a note, rewriting a link, or changing application history.

This follows Obsidian's Editing-view interaction: Page preview opens for an internal link while `Ctrl`/`Cmd` is held, without navigating. Calmd intentionally applies the same modifier requirement to backlinks entries as well, so both preview sources have one predictable interaction.

## Product and architecture fit

The feature supports retrieval of the current thought without exposing collection scale. It remains transient and contextual: no sidebar, file tree, persistent panel, recent-note list, or additional retrieval backend.

Markdown remains the source of truth. Preview resolution must use the vault persistence boundary rather than SQLite search state. The derived index remains responsible only for finding backlinks; it must not become authoritative for preview content or link identity.

The preview is separate from the conflict-safe navigation flow because it performs no transition. In particular, it must not call `noteEditing.flush()`, `open_note_link`, `resolveWikiLinkActivation`, or `NoteNavigation`.

## Reference behavior

Obsidian documents Page preview as a non-navigating preview shown by hovering an internal link. In Editing view, the user presses `Ctrl`, or `Cmd` on macOS, while hovering. Outside Editing view Obsidian can preview without the modifier, but Calmd will require the modifier everywhere in this scope for consistency and to avoid accidental UI.

Source: [Obsidian Help — Page preview](https://obsidian.md/help/plugins/page-preview)

Base UI supports controlled popovers, hover delays, detached/multiple triggers, virtual anchors through `Popover.Positioner.anchor`, collision avoidance, non-modal behavior, and suppressed focus movement. The CodeMirror link surface is not a React trigger, so the implementation should use a controlled popover with a virtual anchor rather than adding hidden DOM controls over editor text.

Source: [Base UI — Popover](https://base-ui.com/react/components/popover)

## Interaction contract

### Opening

1. Track the pointer's current preview candidate independently of modifier state.
2. When a supported candidate is hovered while the platform modifier is down, wait 300 ms before opening. This matches Base UI's default hover intent delay and avoids flashing previews while the pointer moves through text.
3. Also open when the modifier is pressed after the pointer is already resting on a candidate; do not require pointer movement.
4. Resolve and load only after the intent delay expires.
5. Show a compact loading state only if the request is still pending after the popover opens. Do not show a loading popup during the intent delay.

### Staying open and closing

- Keep the preview open while the pointer is over either the source link or the preview surface and the platform modifier remains held.
- Use a short 100 ms pointer-leave grace period so the pointer can cross the gap into the preview without closing it.
- Close immediately when the modifier is released, `Escape` is pressed, navigation starts, the active note changes, the backlinks popover closes, the editor is destroyed, or the anchor can no longer be measured.
- Close and invalidate the current request when another candidate becomes active. A stale response must never replace the newer preview.
- Do not move focus into the preview or restore focus on close. The current editor selection and scroll position must remain unchanged.
- A modifier-click retains the existing navigation behavior. Close the preview on pointer down, then allow the current click flow to flush, canonicalize, and navigate normally.
- Plain hover does nothing.
- Wrong or additional modifiers (`Alt`, `Shift`, or both `Ctrl` and `Meta`) do nothing, matching the existing strict navigation-modifier contract.

### Preview surface

- Non-modal Base UI popover, anchored to the hovered link rectangle with fixed positioning and viewport collision handling.
- Prefer below/start alignment with an 8 px offset; allow Base UI to flip and shift with 12 px viewport padding.
- Width: approximately 22–28rem, capped to the viewport. Height: no more than roughly 22rem or 60vh, with internal scrolling.
- Show the note title followed by a lightly formatted leading excerpt.
- Render headings, paragraphs, emphasis, strong text, strikethrough, lists, blockquotes, inline/fenced code, links, and GFM basics. Keep source HTML disabled and escaped.
- External links and nested wiki links inside the preview are visually styled but inert in this phase. This avoids nested previews, browser navigation surprises, and a second navigation path.
- If the note body is empty, show a quiet “Empty note” state.
- If content was truncated, end with a subdued “Open note to continue” indicator; it is informational, not a second navigation control.
- Use a restrained surface, shadow, and a short interruptible opacity/scale transition. Respect the existing reduced-motion rules and do not animate position while tracking the source.

## Data contract

Add a dedicated preview response rather than sending a complete `Note` to the frontend:

```ts
type NotePreview = {
  key: string
  title: string
  excerpt: string
  truncated: boolean
}
```

Add two read-only Tauri commands:

```text
resolve_note_preview(target) -> NotePreview | null
read_note_preview(key)       -> NotePreview
```

- `resolve_note_preview` validates the same target grammar and performs the same case-insensitive filename-identity resolution as `open_note_link`, but returns `null` when the target is missing or ambiguous.
- It must never create a missing target, update the index, canonicalize source Markdown, or mutate vault files.
- `read_note_preview` is for backlinks, which already provide an authoritative key. It uses the existing safe key/read policy and returns the normal not-found/read error when an externally removed file disappears.
- Both commands bound the body before IPC. Define one Rust helper and one named limit, measured by Unicode scalar values rather than bytes, so truncation never splits UTF-8. Start with 4,000 characters and preserve the leading content; set `truncated` when content remains.
- Include the whole title subject to the existing title contract.

Refactor the matching portion of `open_note_link` into one private resolver that returns an explicit `Missing | Found(Note) | Ambiguous` result. Reuse it in `open_note_link` and `resolve_note_preview` so click and preview cannot drift in normalization or ambiguity behavior. Preserve all existing `open_note_link` semantics: missing targets are still created only by modifier-click, and ambiguity is still an error there.

For a preview that resolves to the currently edited note, present the in-memory `draft.title` and bounded `draft.body` after resolution identifies the key. This makes self-links and self-backlinks reflect unsaved local edits without flushing. Other notes are read from disk. Keep the same frontend truncation helper/limit semantics for this local substitution and test it against the Rust behavior.

Do not cache preview responses initially. Avoiding a cache keeps externally edited note content fresh and removes invalidation complexity. The 300 ms intent delay and stale-request suppression are sufficient for the first implementation.

## Frontend design

### Shared state owner

Create a single preview owner under `NoteEditor`, for example `NotePreviewPopover`, with a small controller/hook that owns:

- current candidate (`target` for inline links or `key` for backlinks),
- source identity and anchor rectangle/virtual element,
- platform modifier state,
- source-hover and preview-hover state,
- intent and close timers,
- request generation,
- loading/result/error state.

Only one preview can exist at a time. Keeping state above both sources prevents competing popovers and centralizes race handling.

Represent candidates as a discriminated union:

```ts
type NotePreviewCandidate =
  | { source: 'wiki-link'; id: string; target: string; anchor: PreviewAnchor }
  | { source: 'backlink'; id: string; key: string; anchor: PreviewAnchor }
```

`id` must identify the concrete source occurrence, not only the target/key, so moving between two links to the same note updates the anchor correctly.

### Platform modifier helper

Extract/generalize the existing strict platform-primary-modifier check in `src/wikiLinks.ts` so pointer events and global key events share one tested rule. Prefer `navigator.userAgentData?.platform` when available, with the current platform/user-agent fallback. Do not change current click behavior.

Track global `keydown`, `keyup`, and window `blur`. Ignore repeated keydown work and clear modifier state on blur to prevent a stuck preview if the application loses focus before receiving `keyup`.

### CodeMirror integration

Extend the existing wiki-link interaction plugin rather than adding a second syntax walk:

- On `pointermove`/`pointerover`, resolve the nearest `WikiLink` from the syntax tree, parse it with `parseWikiLinkText`, and publish a candidate plus `view.coordsAtPos(node.from/node.to)`-derived anchor bounds.
- On pointer leave or movement outside the resolved node, clear source hover with the close grace period.
- Keep the candidate available while hovered even if the modifier is not yet held, enabling modifier-after-hover.
- Recompute or dismiss the anchor after document changes, viewport changes, editor scrolling, and window resizing. Never retain a detached DOM node as the source of truth.
- Do not use document offsets outside CodeMirror and do not pass offsets over IPC.
- Preserve the existing `mousedown` modifier-click path and its mapped occurrence validation exactly.

Expose candidate enter/leave callbacks through `MarkdownEditor` props. Keep pure node/position/modifier decisions in `src/wikiLinks.ts` where they can be unit tested without mounting CodeMirror.

### Backlinks integration

Add pointer enter/move/leave callbacks to each existing backlinks button. Use `event.currentTarget.getBoundingClientRect()` as the anchor and the existing `link.key` as the candidate key. Keyboard focus alone does not open this pointer-specific preview; clicking and keyboard activation continue to navigate through the existing conflict-safe flow.

Closing the backlinks popover must also clear a backlinks-origin candidate. Moving into the note preview should not accidentally select a backlink or close the underlying backlinks popover before the preview grace period is evaluated.

### Rendering

Add `react-markdown` and `remark-gfm` as rendering dependencies, loaded only with the preview component's lazy chunk. Configure them without `rehype-raw`; raw HTML remains escaped/ignored and no arbitrary HTML reaches the DOM. Override rendered anchors so they have no navigation action in this phase. Apply explicit component styles rather than importing a prose/theme package.

Before implementation, verify the chosen package versions support the project's React 19 and TypeScript versions and inspect the lockfile diff. If they do not, stop and choose a small local renderer based on the already-installed Lezer Markdown parser rather than weakening dependency constraints.

## Error and edge-case behavior

| Case | Required behavior |
| --- | --- |
| Missing inline target | Resolve to `null`; show no popup and do not create a note. |
| Ambiguous case-folded target | Resolve to `null`; show no popup and do not reveal an arbitrary match. Modifier-click behavior remains an ambiguity error. |
| Invalid target | Normally impossible after parser validation; suppress the preview and log/retain the typed command error for diagnostics, without a disruptive toast. |
| Backlink deleted externally after list load | Close the loading preview quietly on `not_found`; leave normal backlink click error handling unchanged. |
| Other storage/I/O failure | Show a compact error inside an already-open preview; never write to `storageMessage`, because transient hover failures should not replace editor save status. |
| Request A finishes after request B | Ignore A using a monotonic generation token. |
| Pointer leaves before load finishes | Close and invalidate; do not reopen when the response arrives. |
| Modifier released before load finishes | Close and invalidate immediately. |
| Same note hovered repeatedly | A new request is acceptable; no cache in phase one. |
| Self-link/self-backlink | Resolve identity from Rust, then render the current in-memory draft without saving. |
| Current draft changes while self-preview is open | Update the displayed local excerpt from the latest draft without issuing another IPC request. |
| Source link edited while preview is open | CodeMirror update dismisses or republishes the concrete occurrence; stale content cannot remain anchored to unrelated text. |
| Link wraps across lines | Anchor to the union of available endpoint coordinates; if reliable bounds cannot be produced, anchor to the pointer rectangle rather than opening off-screen. |
| Very large note | IPC response remains bounded to 4,000 Unicode scalar values; popup scroll remains bounded. |
| Unicode/emoji at truncation boundary | Preserve valid UTF-8 and set `truncated` correctly. |
| Empty/whitespace body | Show “Empty note”; do not render a blank loading-looking surface. |
| Raw HTML/script/event attributes | Never enable raw HTML rendering; output remains inert. |
| Markdown images | Do not fetch or display images in phase one; render alt text or omit the image to avoid local/remote resource loading and oversized previews. |
| External Markdown links | Render inert text styling; do not open URLs from the preview. |
| Nested wiki links | Render as inert text; no recursive preview in phase one. |
| Window blur or lost keyup | Close and clear modifier state on blur. |
| Touch/pen input | Do not open modifier-hover preview. Existing backlink tap/click behavior remains. |
| Reduced motion | Use opacity only or effectively instant transitions under the existing media query. |

## Implementation sequence

### 1. Establish shared resolver and bounded preview commands

Files:

- `src-tauri/src/storage.rs`
- `src-tauri/src/lib.rs`
- relevant Rust test module(s)

Work:

1. Introduce the private link-resolution result and refactor `open_note_link` onto it without changing behavior.
2. Add `NotePreview`, Unicode-safe leading truncation, `resolve_note_preview`, and `read_note_preview`.
3. Register both commands.
4. Verify commands hold the vault lock only for filesystem work and perform no derived-index update.

Checks:

- Existing open/create/ambiguity tests continue to pass.
- New resolver tests cover exact, case-insensitive, optional `.md`, missing, ambiguous, unsafe, Unicode, and collision-resolved filenames.
- Truncation tests cover below/at/above limit, multibyte Unicode, emoji, empty body, and the `truncated` flag.
- A missing preview resolution leaves the vault directory unchanged.

### 2. Add frontend contracts and storage adapters

Files:

- `src/notes.ts`
- `src/storage.ts`
- new pure preview utility and test file under `src/` / `tests/`

Work:

1. Add `NotePreview` and typed invoke wrappers.
2. Add the matching local-draft truncation utility and candidate types.
3. Generalize/test platform modifier detection without changing modifier-click semantics.

Checks:

- Type-level command payloads match Rust camel-case serialization.
- Unit tests cover platform rules, extra modifiers, modifier-after-hover state, window blur reset, truncation parity assumptions, and candidate identity changes.

### 3. Implement the shared preview state machine and surface

Files:

- new `src/NotePreviewPopover.tsx`
- optionally new `src/useNotePreview.ts`
- `src/NoteEditor.tsx`
- `src/App.css`
- `package.json` and lockfile

Work:

1. Implement intent/close timers, generation invalidation, global modifier tracking, current-draft substitution, and one controlled Base UI popover.
2. Position against a virtual anchor with collision avoidance and no focus transfer.
3. Lazy-load the safe Markdown renderer and add inert element overrides.
4. Add bounded sizing, scrolling, loading/empty/error/truncated states, transition, and reduced-motion treatment.
5. Ensure all timers/listeners are removed on unmount.

Checks:

- Fake-timer/component tests cover delayed open, grace-period transfer, release/blur/Escape close, stale requests, unmount cleanup, and no focus movement.
- Renderer tests verify raw HTML, scripts, images, and links cannot execute or navigate.

### 4. Connect inline wiki-link candidates

Files:

- `src/MarkdownEditor.tsx`
- `src/wikiLinks.ts`
- `src/NoteEditor.tsx`
- `tests/wikiLinks.test.ts`

Work:

1. Add candidate callbacks to the editor contract.
2. Extend the existing CodeMirror interaction plugin to publish/clear concrete hovered occurrences and anchor geometry.
3. Refresh or dismiss geometry on editor/document/layout changes.
4. Close before the existing modifier-click activation while preserving that activation unchanged.

Checks:

- Supported links and aliases preview; unsupported/code-contained forms do not.
- Pressing the modifier before or after hover works.
- Wrapped links, hidden Live Preview syntax, selection-revealed syntax, edits under the pointer, editor scroll, and viewport resize do not produce stale anchors.
- Existing wiki-link click and canonicalization tests remain unchanged and pass.

### 5. Connect backlinks candidates

Files:

- `src/BacklinksPopover.tsx`
- `src/NoteEditor.tsx`

Work:

1. Publish key-based candidates from backlink buttons.
2. Clear candidates when the backlinks popover closes or the item unmounts.
3. Preserve button click and keyboard behavior.

Checks:

- Ctrl/Cmd-hover previews the source note.
- Moving from a backlink button into the preview does not prematurely close it.
- Clicking still uses `onBacklinkSelect`; no preview path calls navigation.
- A stale/deleted backlink fails quietly as specified.

### 6. Integration validation and durable documentation

Files:

- `docs/adr/0002-internal-links-and-navigation.md`
- `docs/internal-links-navigation-research.md` or `docs/markdown-editor.md`
- `docs/implementation-brief.md` if its implemented-feature summary needs updating

Work:

1. Document preview as read-only resolution outside the save-gated navigation path.
2. Record the no-create, source-of-truth, ambiguity, bounded-content, and modifier contracts.
3. Remove this in-progress plan after implementation acceptance and transfer durable decisions to the permanent docs.

Run:

```sh
bun test
bun run lint
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Also perform a Tauri desktop smoke test on the available platform.

## Manual acceptance checklist

1. Hover an inline supported wiki link without a modifier: nothing opens.
2. Rest on it, then press Ctrl/Cmd: preview opens after the delay.
3. Hold Ctrl/Cmd first, then hover: the same preview opens.
4. Move into and scroll the preview; it remains open and does not move editor focus.
5. Release Ctrl/Cmd or press Escape: it closes immediately.
6. Ctrl/Cmd-click the same link: existing flush/canonicalize/create-or-open/navigation behavior still works.
7. Hover a missing link: no preview and no file is created; click can still create it through the existing flow.
8. Hover an ambiguous link: no preview; click still reports the existing ambiguity error.
9. Preview a self-link after unsaved edits: the preview shows the local draft and no save occurs.
10. Open backlinks and Ctrl/Cmd-hover an entry: its source note previews; click still navigates through the save gate.
11. Rapidly cross several links with delayed filesystem responses: only the latest candidate can appear.
12. Edit or remove the hovered link, scroll the editor, resize the window, blur the app, and switch notes: no detached or stuck preview remains.
13. Preview empty, long, Unicode-heavy, raw-HTML-containing, image-containing, and code-heavy notes: rendering is bounded, safe, and stable.
14. Verify light/dark appearance and reduced motion.

## Explicitly out of scope

- Previewing missing notes as empty notes.
- Creating, renaming, canonicalizing, saving, or navigating from the preview path.
- Nested hover previews or interactive links inside previews.
- Heading/block/path/embed targets not already supported by Calmd.
- Images, remote resource fetching, transclusion, properties, tags, backlinks inside the preview, or a full read-only editor.
- Preview preferences, pinning, resizing, caching, or persistent preview windows.
- Preview on plain hover or keyboard focus in this phase.
