# Wiki-link Live Preview and Modifier Navigation Polish

## Status

Temporary implementation plan for review. Do not implement until this plan is accepted.

## Context and intended outcome

Calmd's CodeMirror Markdown editor already parses supported wiki links and has a flush-gated navigation path for Ctrl/Cmd-click. The remaining UX polish is to make supported wiki links behave more like Obsidian Live Preview:

- Hide wiki-link syntax when the cursor or selection is outside the link.
- Reveal the complete source syntax when the cursor or selection enters/touches the link.
- Navigate to the linked note with exactly one platform modifier plus primary click.
- Preserve the existing source-of-truth, conflict-safe save, canonicalization, and navigation-history behavior.

Supported syntax remains `[[target]]` and `[[target|display text]]`. This task does not add embeds, headings, blocks, paths, nested links, or new backend behavior.

## Investigation findings

- Obsidian's official linking documentation specifies Ctrl-click on Windows/Linux and Cmd-click on macOS for opening a link. The same action can create/open a missing note.
- Obsidian Live Preview hides source delimiters outside the active link and reveals source while editing the link. Hover-only source revelation is not part of the required behavior.
- For an aliased link, the visible text is the display text while the target remains the navigation identity.
- CodeMirror recommends syntax-tree-based decorations and editor-wide event handlers using `posAtDOM` for source-position lookup.
- `Decoration.replace({})` hides source while retaining the underlying document and allows the existing cursor-sensitive reveal pattern used for emphasis and highlights.
- The current interaction already requires a primary click with exactly one of Ctrl or Meta. Shift, Alt, middle/right clicks, and Ctrl+Meta together do not activate it.
- The current `WikiLinkDisplay` syntax node includes the pipe and display text, so hiding that entire node would incorrectly hide the alias. Only the pipe must be hidden separately.

## Recommended approach

Keep the implementation localized to the CodeMirror editor:

1. Extend `inlineMarkdownDecorations` to add replace decorations for wiki-link delimiters when the active selection does not touch the enclosing `WikiLink` node.
2. For aliased links, hide only the pipe character separately from the visible display range.
3. Reuse `selectionTouchesRange` so a cursor, partial selection, full selection, or any secondary selection touching a link reveals its complete raw syntax.
4. Keep the full `WikiLink` mark for styling and hover color behavior.
5. Retain the existing `wikiLinkInteraction` event handler and navigation seam. Harden or test it only where necessary; do not duplicate navigation logic in the decoration code.
6. Preserve the existing `resolveWikiLinkActivation` flow: flush, validate the mapped occurrence, resolve/create authoritatively, canonicalize the clicked occurrence, flush the rewrite, then switch notes.

Do not make the entire link atomic. Editing inside the link must remain possible, and source syntax must reappear at the cursor.

## Files to modify

### `src/MarkdownEditor.tsx`

- Update `inlineMarkdownDecorations` to inspect `WikiLink` children/ranges.
- Add hidden replace decorations for `WikiLinkMark` nodes when the active selection does not touch the link.
- Add a one-character replace decoration for the alias pipe, without hiding `WikiLinkDisplay` text.
- Keep the existing `cm-wiki-link` mark over the complete link.
- Review the existing modifier-click handler for defensive position lookup and ensure its exact-modifier behavior remains explicit.

### `src/App.css` (only if needed)

- Avoid visual changes unless browser verification shows a cursor/underline issue caused by hidden delimiter ranges.
- Preserve the existing `cm-wiki-link` styling and do not add pointer-event behavior that would interfere with CodeMirror event handling.

### `tests/wikiLinks.test.ts`

- Add pure contract coverage for any extracted helper that computes hidden wiki-link ranges, if extracting that logic makes it testable without a browser.
- Cover plain links, aliases, `.md` targets, Unicode content, and invalid/code-excluded syntax as appropriate to the existing parser contract.

### `tests/wikiLinkNavigation.test.ts`

- Extend the existing navigation tests for modifier-click navigation's flush, stale-occurrence, self-link, and canonicalization behavior where a regression is found.
- Keep navigation tests focused on the existing `resolveWikiLinkActivation` seam rather than React or Tauri implementation details.

### Optional new editor interaction test file

If the project can exercise CodeMirror with the available Bun test environment, add a focused test file for mounting `EditorView` and inspecting decorations/events. Otherwise, validate DOM behavior manually through the development build and keep automated coverage at the parser/navigation seams.

## Existing code and patterns to reuse

- `selectionTouchesRange` in `src/MarkdownEditor.tsx` already defines the reveal rule used by emphasis and highlights.
- `inlineMarkdownDecorations` already walks the Lezer syntax tree and returns a sorted `DecorationSet`.
- `WikiLink`, `WikiLinkMark`, `WikiLinkTarget`, and `WikiLinkDisplay` are already defined by `src/wikiLinks.ts`.
- `wikiLinkInteraction` already uses `syntaxTree`, `resolveInner`, `posAtDOM`, mapped pending ranges, and `validateWikiLinkOccurrence`.
- `resolveWikiLinkActivation` already provides the asynchronous flush/revalidate/canonicalize/flush sequence.
- `NoteNavigation` and `NoteEditingSession.flush()` already protect history and persistence transitions.
- Existing emphasis/highlight replacement decorations provide the intended cursor-sensitive source reveal pattern.

## Numbered implementation steps

1. **Confirm the current baseline.**
   - Inspect the existing wiki-link syntax tree ranges for `[[Target]]` and `[[Target|Display]]`.
   - Confirm that `WikiLinkDisplay` includes the pipe and display text.
   - Confirm the current modifier predicate means exactly one of Ctrl or Meta plus primary click.

2. **Define the decoration contract in code.**
   - For each visible `WikiLink`, always add the existing link-style mark.
   - If the enclosing link is untouched by every selection, replace both `WikiLinkMark` ranges.
   - If the link has an alias, replace only the pipe character; leave the display text visible.
   - If the cursor or selection touches any part of the link, add no replacement decorations for that link.

3. **Preserve source-editing behavior.**
   - Recompute decorations on document, viewport, and selection changes as the existing plugin does.
   - Do not add `atomicRanges` for the link or mutate the DOM directly.
   - Verify that cursor positions at the start/end delimiters and on the hidden pipe reveal the complete source.

4. **Review modifier-click handling.**
   - Keep normal clicks available for cursor placement.
   - Keep navigation limited to primary Ctrl-only or Meta-only clicks.
   - Ensure hidden syntax does not prevent `posAtDOM` from resolving a click on the visible target/display text.
   - Add a defensive fallback or guard only if DOM testing demonstrates that a replaced range produces an invalid position.

5. **Preserve async navigation safety.**
   - Reuse `resolveWikiLinkActivation` without changing its backend contract.
   - Confirm that navigation aborts if flushing fails, the session changes, or the mapped occurrence is no longer the same parsed wiki link.
   - Confirm aliases resolve by target and canonical rewrites preserve the intended display text.

6. **Add focused automated coverage.**
   - Test hidden-range calculation or its pure helper for plain and aliased links.
   - Test reveal behavior for cursor, selection, boundary, and multiple-selection cases.
   - Extend navigation tests for modifier semantics and stale/concurrent edits where practical.

7. **Run the validation suite and perform manual UI verification.**
   - Run formatting/lint/type/build/test checks listed below.
   - Launch the app and verify the acceptance scenarios against real CodeMirror DOM behavior, especially cursor placement around hidden delimiters and modifier clicks.

8. **Update durable documentation after acceptance.**
   - Update `docs/markdown-editor.md` and any relevant internal-link documentation to describe the now-supported live-preview wiki-link behavior.
   - Remove this temporary plan after implementation is accepted and the permanent documentation is updated, per the project workflow.

## Verification and acceptance criteria

### Automated checks

- `bun test`
- `bun run lint`
- `bun run build`
- Run any targeted Rust tests if the navigation/backend contract is changed; no Rust change is expected for this task.

### Syntax visibility

- `[[Target]]` renders as `Target` when the cursor is elsewhere.
- `[[Target|Display]]` renders as `Display` when the cursor is elsewhere.
- Opening brackets, closing brackets, and the alias pipe reappear when the cursor enters or touches the link.
- A selection overlapping any part of the link reveals the complete raw link.
- Multiple selections reveal a link if any selection touches it.
- Syntax remains visible/unchanged for malformed links, inline code, fenced code, indented code, embeds, and unsupported target forms.
- The underlying Markdown saved to disk remains unchanged by visual hiding.
- Copying/selecting source continues to use the underlying Markdown document rather than a rewritten visual representation.

### Navigation

- Normal primary click does not navigate and still permits cursor placement.
- Ctrl-click on Linux/Windows and Cmd-click on macOS navigate to an existing target.
- A missing target follows the existing open-or-create path.
- Aliased links navigate using the target, not the display text.
- Shift/Alt/middle/right clicks and combined Ctrl+Meta do not navigate.
- Navigation waits for a successful flush and is blocked by conflicts or failed saves.
- A stale or changed clicked occurrence cannot cause a different link to be rewritten.
- Canonicalization is persisted before switching notes.
- Self-links do not create duplicate navigation history entries.
- Existing backlinks-popover navigation remains unaffected and continues using the shared flush-gated note-opening path.

### Manual UX quality

- The visible link retains its subdued underline/color treatment.
- Hidden delimiters do not cause cursor jumps, broken line wrapping, or unexpected selection behavior.
- Clicking visible target/display text with the modifier consistently activates the link even when the source delimiters are hidden.
- Reduced-motion and existing editor styling remain unchanged.
