# Editor experience audit

Status: historical audit; its recommended editor phases are implemented. Updated 2026-08-30 to distinguish the audited baseline from the current editor.

> The defect descriptions, "Calmd now" comparisons, and Before columns below describe the pre-implementation editor audited in early August 2026. They are retained as decision history, not as a current defect list. See [Markdown editor](markdown-editor.md) for the current contract, which includes isolated per-note history, shared Live Preview rules, pointer-drag stability, lists and tasks, local images, configurable spellcheck, a selection toolbar, syntax-highlighted fenced code, and in-memory cursor and scroll restoration.

This audit compares Calmd's note editor with Writer at commit
[`eef8455`](https://github.com/joelbqz/writer-computer/commit/eef84557429ee1897c4c0b9eeec39af80cfe199e)
(2026-07-20). It is intentionally limited to editing: document lifecycle,
Markdown presentation, selection and caret behavior, typing commands, focus,
scrolling, and editor tests. Sidebars, tabs, file browsing, metadata, themes,
Mermaid, math, HTML rendering, and the rest of either app are not targets.

The reference contract is Obsidian's definition: Live Preview shows formatted
text inline, hides most Markdown syntax, and reveals the underlying syntax when
the cursor enters formatted content. Source mode is a separate concept, not the
definition of Live Preview. See [Obsidian: Views and editing
mode](https://obsidian.md/help/edit-and-read).

Detailed, commit-pinned Writer source notes live in
[writer-computer-editor-research.md](writer-computer-editor-research.md).

## Conclusion

Calmd is not starting from a weak editor. Its plain-Markdown model, parsed
formatting commands, multiple-selection support, list/quote continuation,
wiki-link completion and modifier navigation, React/CodeMirror ownership seam,
and conflict-safe persistence are good foundations. Its command semantics and
persistence safety are stronger than Writer's in several important cases.

The editor is nevertheless incomplete in two different ways:

1. A P0 document-lifecycle defect lets Undo cross a note boundary and can write
   the previous note's body into the current note.
2. “Live Preview” is currently a collection of special cases, not one coherent
   interaction model. It covers some inline syntax and two block prefixes, but
   it lacks the selection stability, lifecycle, coverage, and integration tests
   needed for an Obsidian-like experience.

The right next move is not to import Writer's large vendored ProseMark layer or
to add every widget Writer has. First isolate each note's editor history. Then
turn Calmd's existing decorations into a small Calmd-owned Live Preview engine,
complete the prose-oriented Markdown subset, and add richer block replacements
only when their editing and scroll behavior are demonstrably stable.

## Resolved interview decisions

- Live Preview is Calmd's only editing mode for the current product direction;
  there is no separate Source mode.
- Inline reveal is grammar-aware. Only the active formatted span reveals its
  source; activating one span does not reveal unrelated syntax on the line.
- Every formatted span overlapped by a completed non-empty selection is active.
- A collapsed caret activates a span at either boundary. Adjacent spans may
  therefore both reveal at a shared boundary.
- Pointer-drag selection freezes the pre-drag presentation and reconciles all
  overlapped syntax once the selection is completed.
- Delivery is staged. The first milestone contains document-history isolation,
  the shared visibility engine, selection stability, and prose-oriented syntax:
  strikethrough, inline code, ordinary links, headings, blockquotes, escapes,
  fenced code, and thematic breaks. Lists and task checkboxes follow as one
  subsystem. Images and rendered tables are later, independent decisions.
- A fenced code block is one reveal unit. Activating any part reveals its
  opening fence, language identifier, content, and closing fence together.
- Heading text keeps a stable horizontal anchor when its source prefix is
  revealed. The `#` markers appear in reserved margin space rather than pushing
  the heading text sideways.
- Consistency means deterministic reliability: the same note content and active
  selection must produce the same Live Preview after initial mount, note swap,
  editing, parser progress, and viewport changes. Intermittently raw or
  unformatted headings are correctness failures, not acceptable visual polish
  debt.
- Ordinary Markdown links follow the wiki-link interaction contract: a normal
  click places the caret and reveals editable source, while the platform
  modifier plus click opens the destination.
- Inactive list and task lines render their bullet, number, or checkbox. When a
  line becomes active, its literal Markdown prefix (`- `, `1. `, or `- [ ] `)
  is revealed, following the same structural-line rule as headings and
  blockquotes rather than remaining a permanent widget.
- On an inactive task line, clicking the rendered checkbox toggles the task
  without entering source editing. Clicking the task text instead activates the
  line and reveals its Markdown prefix.
- Inline and structural formatting are discoverable through one quiet selection
  toolbar, backed by the same commands as keyboard shortcuts. Calmd does not add
  a persistent formatting toolbar or a second command-palette surface for these
  actions.
- Native spellcheck is enabled for prose by default, while autocorrect and
  automatic text replacement remain disabled. A simple editor setting lets the
  user turn spellcheck off; code spans and link destinations are excluded where
  the platform permits it.

## Resolved P0: Undo crossed note boundaries in the audited baseline

[App.tsx](../src/App.tsx#L439) keeps the same `NoteEditor` mounted while moving
from one note to another. [session.ts](../src/markdown-editor/session.ts)
creates one `EditorView` for that component lifetime and enables
`history()`. When `value` changes,
[the complete document is replaced](../src/markdown-editor/session.ts) without
clearing history or adding CodeMirror's `addToHistory: false` annotation.

Using Calmd's installed CodeMirror version, the exact transaction shape was
reproduced with `note A`, a full-document external replacement to `note B`, and
Undo. CodeMirror returned `note A`. The resulting undo transaction does not
carry Calmd's `externalSync` annotation, so the editor's update listener reports
it through `onChange`; the active editing session can then autosave it as note
B. All 110 current tests pass because no test mounts the editor across a note
change or exercises its history field.

Writer encountered the same lifecycle boundary. It keeps the view alive, but
temporarily removes and reinstalls the compartment containing `history()` when
the file changes, annotates the document swap as not part of history, and then
restores that file's cursor and scroll position. See Writer's
[document-swap path](https://github.com/joelbqz/writer-computer/blob/eef84557429ee1897c4c0b9eeec39af80cfe199e/apps/desktop/src/components/editor-area/use-prosemark-editor.ts#L791-L858).

### Per-document history isolation

| Before | After |
| --- | --- |
| One history field survives note navigation; the external full-document replacement is undoable | Every newly opened note begins an isolated history timeline; document swaps and canonical persistence reconciliation are not user undo steps |
| Editor identity is inferred from a changing `value` string | The editor receives an explicit document-session identity that changes on open/navigation but not on an in-place rename |
| No regression test crosses a note boundary | An integration test types in A, opens B, invokes Undo/Redo, and proves neither note's body crosses the boundary or reaches the other session's `onChange` |

This is a correctness prerequisite for further editor work.

## Audited baseline Live Preview coverage

Calmd already uses Lezer rather than regular expressions for presentation. The
current behavior is split between `markdownMarkerDecorations` and
`inlineMarkdownDecorations` in
[session.ts](../src/markdown-editor/session.ts). That is a sound parsing
choice, but the supported Markdown described in
[markdown-editor.md](markdown-editor.md) is much broader than the presentation
coverage.

| Syntax | Calmd now | Writer now | Recommended Calmd target |
| --- | --- | --- | --- |
| ATX headings | Styled; `#` prefix and following space are replaced off the active line | Styled; hashes occupy a stable margin position and fade off the active line | Keep source reveal line-sensitive, but prevent the heading text from shifting horizontally when the prefix appears |
| Setext headings | Styled, underline remains source | Underline hides off-selection | Hide the underline off its structural line if Setext headings remain supported |
| Strong and emphasis | Styled; delimiters hide unless a selection touches the parsed format | Same, through declarative hide specifications | Retain behavior under one shared visibility engine; test nesting and boundaries |
| Highlight | Styled; `==` hides off-selection | Not part of Writer's core policy | Retain as a first-class Calmd syntax rule |
| Strikethrough | Styled, but `~~` remains visible | Delimiters hide off-selection | Complete the existing Live Preview behavior |
| Inline code | Styled as monospace, but backticks remain visible | Backticks hide off-selection and the rendered span has a stable click target | Hide delimiters off-selection; preserve literal spacing and caret geometry |
| Standard Markdown links | Label, brackets, and destination remain visible and underlined | Only the label remains off-selection | Show the label off-selection and the full source on touch; preserve Calmd's modifier-based navigation policy |
| Wiki links | Clean label/alias off-selection; complete source on touch; missing state and completion supported | Similar folding, plus image embeds | Calmd is already strong here; move the rule into the shared engine without weakening its conflict-safe navigation |
| Blockquotes | `>` becomes a quiet `|` only on inactive, spaced quote lines | Source markers hide and a continuous quote treatment renders | Replace the literal-character illusion with stable line/block decoration while keeping source accessible |
| Bullet and ordered lists | Source markers remain; CodeMirror continues/indents them | Source-backed, fixed-width bullets/tasks, hanging wraps, atomic prefixes, smart Enter/Backspace/Tab | Treat list geometry as its own subsystem; do not hide markers until caret, selection, wrapping, and deletion are covered together |
| Task lists | Raw `[ ]`/`[x]` source; continuation works as list markup | Rendered, click-toggleable checkboxes backed by source | Add only with the list subsystem; checkbox clicks must be one undoable source transaction |
| Fenced code | Source fences/info remain; language-aware highlighting works | Fence/info hide off-selection; code retains a block treatment | Hide fence syntax outside the active code block while keeping language identity and keyboard entry obvious |
| Thematic breaks | Raw source | Rendered horizontal rule off-selection | A low-risk block replacement after keyboard reveal behavior exists |
| Images | Raw source in the editor | Rendered off-selection; source plus preview on touch; measured-height cache prevents scroll jumps | Defer until local-vault URL resolution, failure UI, sizing, alt text, and height stability are specified |
| GFM tables | Raw source | Rendered table off-selection; entire source block on touch | Defer to a dedicated phase; table folding changes height and selection geometry too much for the first pass |

Writer's default hide policy is visible in its
[declarative specifications](https://github.com/joelbqz/writer-computer/blob/eef84557429ee1897c4c0b9eeec39af80cfe199e/apps/desktop/src/lib/prosemark-core/hide/index.ts#L22-L99).
Its tables and media demonstrate what is possible, but they also demonstrate
why block preview is not merely syntax coloring.

## Resolved P1: Live Preview needed one interaction model

Editor ownership is now explicit under `src/markdown-editor/`:
`MarkdownEditor.tsx` is a thin React adapter, `session.ts` owns the CodeMirror
document lifecycle, and `livePreview.ts` owns source visibility and semantic
decorations. New preview behavior should extend that policy instead of entering
the React lifecycle or Note workspace.

Writer's reusable idea is not its feature count. It is the split between:

- **Hide rules** for syntax that leaves semantic text in place.
- **Fold rules** for syntax replaced by an inline or block widget.
- **Selection stability** for freezing display decisions during drag,
  navigating atomic prefixes, and entering replaced blocks by keyboard.

Its `HidableNodeSpec` and `FoldableSyntaxSpec` are implemented in the
[hide engine](https://github.com/joelbqz/writer-computer/blob/eef84557429ee1897c4c0b9eeec39af80cfe199e/apps/desktop/src/lib/prosemark-core/hide/core.ts#L35-L189)
and [fold engine](https://github.com/joelbqz/writer-computer/blob/eef84557429ee1897c4c0b9eeec39af80cfe199e/apps/desktop/src/lib/prosemark-core/fold/core.ts#L21-L112).

### Live Preview architecture

| Before | After |
| --- | --- |
| Two private decoration builders with syntax-specific branches | One small, testable Live Preview module with declarative rules for matching a syntax node, defining its reveal zone, and producing hide/mark/replace/line decorations |
| Wiki-link display state is inseparable from general inline formatting | Generic visibility owns reveal/hide decisions; wiki-link resolution only contributes semantic state such as existing/missing |
| Every new syntax decides selection overlap independently | One canonical selection-touch contract handles collapsed cursors, range selections, multiple selections, and boundary positions |
| Block replacements can be added without a navigation contract | Every fold rule must define pointer entry, ArrowUp/ArrowDown entry, selection behavior, estimated height where needed, and source recovery on render failure |

This should remain a Calmd module on top of the CodeMirror and Lezer packages
already installed. Writer vendored and heavily modified ProseMark; importing
that layer would bring much more behavior and maintenance surface than Calmd's
scope needs.

## Resolved P1: syntax reveal moved text during selection

`Decoration.replace({})` removes delimiters from layout. When a selection
touches a format, Calmd drops the replacement and the delimiters return to
inline flow. During a mouse drag this can repeatedly move text beneath the
pointer. Headings also shift right when `# ` reappears. The current tests cover
wiki-link range math but never mount a real `EditorView` and drag through mixed
decorations.

Writer had this exact failure and added a pointer-drag gate that freezes hide
and fold decisions until pointer-up, followed by one rebuild against the final
selection. See its
[drag-selection gate](https://github.com/joelbqz/writer-computer/blob/eef84557429ee1897c4c0b9eeec39af80cfe199e/apps/desktop/src/components/editor-area/drag-selection-gate.ts#L12-L199).
Writer also keeps heading text aligned by hanging its source prefix in the
margin, though its caret guards show that this choice introduces its own
complexity.

### Selection stability

| Before | After |
| --- | --- |
| Pointer selection can reveal syntax on every mouse movement and reflow the line under the pointer | Live Preview appearance freezes from pointer-down through pointer-up/cancel/blur, then reconciles once |
| Hidden structural prefixes have no shared cursor policy | Prefixes that remain measurable define atomic or guarded caret ranges and explicit Backspace/Arrow behavior |
| Heading text changes horizontal position between preview and active states | Heading text keeps one horizontal anchor; source appears in reserved space or another non-shifting treatment |
| A future block widget could be skipped by vertical arrows | Adjacent replaced blocks have explicit keyboard entry into editable source |

CodeMirror documents that replacement decorations hide source ranges, while
`atomicRanges` makes decorated ranges act as units for cursor motion. See the
[CodeMirror reference](https://codemirror.net/docs/ref/#view.EditorView^atomicRanges).

## Resolved P1: document state needed deliberate restoration

Calmd opens the CodeMirror view with its cursor at the end and does not record
per-note selection or scroll. On a value replacement, CodeMirror maps the
existing selection through the full-document change, effectively treating the
new note as another revision of the same editor document.

Cursor and scroll restoration are editor experience, not collection
management: they return a person to the thought location they left without
showing any additional vault structure. Writer stores both per file and
restores them after the view is ready; see its
[mount and restore path](https://github.com/joelbqz/writer-computer/blob/eef84557429ee1897c4c0b9eeec39af80cfe199e/apps/desktop/src/components/editor-area/use-prosemark-editor.ts#L700-L789).

### Editor document lifecycle

| Before | After |
| --- | --- |
| A note change is represented only as a new `value` | Open, same-note reconciliation, rename, conflict reload, and close have distinct editor lifecycle signals |
| Selection starts or lands at the document end | Each open note restores its last selection when available; a genuinely new note starts at the beginning |
| Scroll is whatever the shared page retains | Each note restores a bounded scroll anchor or position after layout is stable |
| Canonical external replacements use ordinary history semantics | Persistence reconciliation is mapped safely without becoming a user edit or merging document histories |

## Completed: integration coverage for the editor contract

Co-located session and `MarkdownEditor` integration tests now mount real
`EditorView` instances and exercise:

- history across document changes;
- DOM decorations for active versus inactive syntax;
- pointer drag through changing replacements;
- background parsing after scrolling into a long document;
- focus, cursor, and scroll restoration;
- asynchronous wiki-link resolution after the editor changes notes.

Nested and adjacent reveal, caret movement around hidden prefixes, and IME
composition remain useful additions when those behaviors next change.

Writer has focused tests for list geometry, drag freezing, heading caret guards,
table folds, images, math, and formatting, but even Writer lacks broad E2E
coverage for ordinary live-preview interactions. Calmd should copy the testing
lesson, not its remaining gap.

### Editor acceptance coverage

| Before | After |
| --- | --- |
| Pure helper tests prove range calculations | Real `EditorView` tests assert visible decorations, selection, transactions, focus, and undo behavior |
| One happy syntax form at a time | A contract matrix covers inactive, caret-inside, caret-at-boundary, partial selection, complete selection, multiple selections, nesting, malformed/in-progress syntax, and code exclusions |
| No long-document live-preview case | A deterministic long document scrolls from an initially unparsed region and proves syntax converges without a raw flash |
| No cross-note history case | Note A and note B cannot affect each other through Undo, Redo, canonical sync, delayed link resolution, or async save completion |

## Implemented P2: performance and long-note behavior

`inlineMarkdownDecorations` walks the complete current syntax tree whenever the
document, viewport, selection, or a link-resolution effect changes. It does not
explicitly rebuild when the syntax tree advances in a background parse.
`wikiLinkTargets` also walks the whole tree after every document change, while
its resolution cache persists for the lifetime of the shared editor and is
neither pruned per note nor invalidated when vault identity changes.

Writer noticed raw syntax in newly visible, not-yet-committed parse regions and
forces a viewport parse with overshoot, followed by idle whole-document parsing.
See its [parse catch-up](https://github.com/joelbqz/writer-computer/blob/eef84557429ee1897c4c0b9eeec39af80cfe199e/apps/desktop/src/components/editor-area/use-prosemark-editor.ts#L149-L231).
But Writer's hide and fold fields also rebuild by walking the entire syntax
tree for every selection transaction. That is not a pattern to copy blindly.

### Parsing and decoration work

| Before | After |
| --- | --- |
| Separate full-tree walks for formatting and wiki-link targets | One profiled syntax pass, with document/viewport-local updates where CodeMirror's decoration constraints allow them |
| Inline Live Preview may miss a background syntax-tree advance | Decoration state observes parser progress and converges when a newly visible range becomes parsed |
| Wiki-link existence cache survives unrelated documents indefinitely | Cache ownership and invalidation follow the vault/document session; unused targets are pruned or the cache is bounded |
| Performance changes are justified by Writer's experience alone | Add a long-note benchmark and reproduce a parse/scroll defect before adopting forced parsing or idle whole-document work |

## Implemented P2: writing polish and discoverability

Calmd already gets several typographic fundamentals right: a 65-character
measure, 16px body text, 1.6 body leading, tighter headings, a restrained type
scale, literal punctuation ligatures, intentional selection color, and one
font-smoothing rule at the root. These should be preserved. Writer's default
1.8 leading and `-0.03em` body tracking are not self-evident improvements.

The remaining editor-level opportunities are smaller than the lifecycle and
Live Preview work:

### Writing rhythm and commands

| Before | After |
| --- | --- |
| Headings change size but have no deliberate block rhythm beyond source blank lines | Test modest heading spacing and compact separator blank lines without changing the 65ch measure |
| Inline formatting shortcuts are strong; structural formatting is mostly typed manually | Consider discoverable commands for heading level, paragraph, quote, list, and task only after their editing contracts are stable |
| With no toolbar or command surface, supported shortcuts are effectively hidden | Choose one quiet discovery surface: native context menu, command palette, or selection toolbar; do not add all three |
| Browser spellcheck is deliberately disabled | Revisit with an explicit writing-quality decision and platform testing rather than treating disabled spellcheck as permanent editor identity |

## What to borrow from Writer

1. One declarative model for hide rules and fold rules.
2. A pointer-drag freeze so selection never chases moving syntax.
3. Source-backed, measurable list prefixes with a complete caret/editing
   contract.
4. Explicit keyboard entry into block replacements.
5. Per-document undo isolation with cursor and scroll restoration.
6. Height estimation, measurement caching, and `requestMeasure()` for any
   asynchronous media widget.
7. Real `EditorView` integration tests for selection and transaction paths.

## What not to borrow

1. Do not widen Calmd into Mermaid, math, raw HTML, frontmatter, emoji
   substitution, smart dashes, or metadata editing. Those are outside the
   current product direction.
2. Do not replace Calmd's modifier-click link navigation with Writer's ordinary
   click navigation. Ordinary click must remain available for positioning and
   revealing source.
3. Do not use a nested editor inside block widgets; edit the Markdown source in
   the main document.
4. Do not rebuild the complete syntax tree on every pointer-selection movement
   without profiling and an explicit performance budget.
5. Do not regress from Calmd's conflict-safe save sequencing toward Writer's
   external-reload behavior, which can overwrite dirty local text.
6. Do not import Writer's vendored ProseMark core wholesale. The useful
   abstraction is small enough to express with Calmd's current CodeMirror and
   Lezer dependencies.

## Historical implementation order

1. **P0 — isolate document history.** Add the cross-note Undo regression first,
   then correct the editor-session lifecycle.
2. **P1 — define the Live Preview reveal contract.** Resolve inline node versus
   whole-line/block behavior, boundary rules, range selections, and whether a
   source-mode escape hatch exists.
3. **P1 — extract the shared visibility engine.** Migrate the behavior already
   implemented without changing its visible contract.
4. **P1 — add drag-selection stability and editor integration tests.** Make
   moving syntax safe before increasing coverage.
5. **P1 — complete the prose subset.** Strikethrough, inline code, standard
   links, escapes, Setext markers, fenced-code syntax, and thematic breaks.
6. **P1/P2 — build lists and tasks as one subsystem.** Rendering and smart
   editing ship together.
7. **P2 — restore cursor and scroll per note.** Tie them to the explicit editor
   document session.
8. **P2 — profile long notes.** Add parser-progress handling only when the
   benchmark or a reproduction justifies it.
9. **Later — decide on images and tables separately.** Each needs a block-widget
   contract and should not hold the prose experience hostage.

No editor-specific ADR was added because the selected approach remains replaceable within the
editor module and does not change Markdown storage. The resolved Live Preview
term is recorded in [CONTEXT.md](../CONTEXT.md); the implementation follows the
document-session and interaction decisions above. Portable inline local images are now implemented through the contract in [ADR 0003](adr/0003-portable-local-images.md). Rendered tables, reference-style images, and OS image drag-and-drop remain deferred.
