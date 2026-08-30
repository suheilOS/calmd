# Image support research

Status: phases 1–5 implemented; OS drag-and-drop and reference-style images remain deferred.

This document preserves the research and implementation plan. The current contract is in [ADR 0003](adr/0003-portable-local-images.md) and [Markdown editor](markdown-editor.md). The shipped implementation lives in `src-tauri/src/attachments.rs`, `src/images.ts`, `src/markdown-editor/imageInsertion.ts`, and `src/markdown-editor/imageLivePreview.ts`. Tauri's asset protocol and exact-file runtime authorization are enabled. Paste uses browser clipboard files with the Tauri clipboard-image fallback, and the Note actions menu exposes the native picker.

## Conclusion

Calmd should add **portable local Markdown images**, not a second document model or a general media system.

Recommended contract:

- Keep Markdown as the sole source of truth.
- Use standard Markdown image syntax: `![alt text](attachments/image.png)`.
- Import files into an `attachments/` directory at the vault root.
- Let Rust validate, copy, name, and resolve attachment files.
- Render resolved local images as CodeMirror Live Preview widgets.
- Serve only validated image files through Tauri's scoped `asset:` protocol.
- Add paste and a native file picker first; add OS drag-and-drop after the core path is stable.
- Keep remote images, wiki-style embeds, SVG, and image editing out of the first implementation.

The current vault contains only top-level Markdown notes, so a vault-root-relative `attachments/` path is portable and remains stable when a note is renamed. If nested notes are introduced later, path semantics should be revisited before allowing them.

## Pre-implementation Calmd fit

- `@lezer/markdown` already parses standard images as `Image` nodes. No parser replacement is needed.
- `src/markdown-editor/livePreview.ts` had no `Image` decoration rule, so image source remained literal Markdown.
- `MarkdownEditor` already owns the CodeMirror view and is the correct place for image decorations, paste handling, and insertion-position mapping.
- Rust already owns vault filesystem access and atomic Markdown persistence.
- `tauri-plugin-dialog` was already installed and used by Rust for native folder selection.
- `tauri-plugin-clipboard-manager` was installed, but the capability initially granted only `clipboard-manager:allow-write-html`; the implementation added `clipboard-manager:allow-read-image` for the Wayland clipboard fallback.
- The CSP already permitted `asset:` and `http://asset.localhost` in `img-src`.
- The implementation enabled Tauri's `protocol-asset` feature and `assetProtocol` configuration with an empty static scope and exact-file runtime authorization.
- Search remains literal and Markdown remains authoritative; attachments should not require a new search backend or index.
- `NotePreviewContent` intentionally suppresses images and should remain safe, bounded, and alt-text-only.

## Product and Markdown policy

### Implemented release

Support:

- Inline standard Markdown images with local destinations.
- PNG, JPEG, GIF, and WebP, subject to platform decoding tests.
- Existing valid image files inside the selected vault.
- Import by clipboard paste.
- Import through an `Insert image…` native file picker.
- Image rendering while editing, with source recovery on contact.
- Alt text and standard Markdown image titles, even if titles are not otherwise editable through a dedicated UI.

Generated Markdown should use forward-slash, vault-relative destinations. A filename containing spaces or Markdown punctuation should use a valid angle-bracket destination or an equivalent escaping helper rather than writing an ambiguous destination.

### Explicitly defer

- `![[image.png]]` wiki-style embeds.
- Remote HTTP(S) image fetching.
- `file://` URLs and absolute filesystem paths in Markdown.
- Raw HTML `<img>` and SVG rendering.
- AVIF and arbitrary media such as audio or video.
- Captions, resizing, cropping, lightboxes, and image editing.
- Automatic attachment garbage collection.
- OCR, thumbnails, image search, and attachment browsing.

Remote images should remain source text rather than being fetched implicitly. This preserves the local-first model, avoids network behavior in the editor, and avoids expanding the current CSP.

SVG should be excluded initially because it is an active XML format and is not necessary for the first local-image workflow. It can be reconsidered with explicit sanitization and a security review.

### Attachment ownership

Attachments are ordinary vault files and may be referenced by multiple notes. Importing the same filename must never overwrite an existing file. Use a readable collision suffix such as `image 2.png`, or reuse an existing file only after proving its bytes are identical. Deleting a note must not delete attachments.

## End-to-end architecture

```text
paste / picker / OS drop
        |
        v
capture editor session, note key, and selection range
        |
        v
Rust validates and atomically imports the image
        |
        v
return relative path, absolute path, MIME, dimensions, and revision
        |
        v
map the captured position through intervening CodeMirror changes
        |
        v
insert ![alt](attachments/name.png)
        |
        v
existing autosave persists Markdown
        |
        v
Live Preview resolves the Image node and renders it
```

The asynchronous boundary is important. Writer's image-paste implementation demonstrates a race when it waits for persistence and then reads the editor's *current* cursor. Typing or moving the caret during the import can place the image at the wrong location. Calmd must capture and map the insertion position instead.

## Rust attachment service

Add a focused `src-tauri/src/attachments.rs` module. Do not put binary-file behavior into `note_persistence.rs`; Markdown note persistence and attachment persistence have different contracts.

Possible command surface:

```text
pick_attachment(note_key)
import_attachment(source_path, note_key)
import_attachment_bytes(filename, bytes, note_key)
resolve_image(note_key, destination)
```

The exact command names are replaceable. The important boundary is that Rust owns all vault path decisions.

### Import behavior

For a selected or dropped file:

1. Verify that the source is a regular file.
2. Enforce a byte-size limit before copying.
3. Validate extension and file signature; do not trust the filename or browser MIME type alone.
4. Decode/probe dimensions and enforce a pixel limit to avoid oversized or decompression-bomb inputs.
5. Sanitize the basename using a portable cross-platform filename policy.
6. Create `attachments/` if necessary.
7. Choose a non-colliding destination without overwriting an existing file.
8. Copy/write to a temporary file in the destination directory.
9. Flush and atomically install the final file.
10. Return the final relative destination and metadata.

For clipboard images, the frontend may receive RGBA pixels from Tauri's clipboard resource. Raw RGBA bytes must not be written with a `.png` extension. Encode them as PNG first, preferably in a bounded canvas-to-PNG path or in Rust with an explicit image dependency.

A first-pass default of 10 MiB compressed bytes and a bounded decoded pixel count is reasonable, but the limits should be named constants and covered by tests rather than hidden in UI code.

### Resolution behavior

`resolve_image(note_key, destination)` should:

- Accept only a vault-relative local destination.
- Reject absolute paths, URI schemes, `..`, backslashes, and query/fragment forms unless explicitly supported.
- Resolve against the selected vault.
- Reject symlinks and anything that canonicalizes outside the vault.
- Require a regular file and an allowed image signature.
- Return a bounded response containing:
  - relative path;
  - absolute path for the asset URL only;
  - MIME type;
  - width and height;
  - content revision/hash.

The absolute path must never be written to Markdown. It is only an IPC value used to create a Tauri asset URL.

A content hash is the strongest cache revision and also makes height-cache invalidation reliable. If hashing every display is too expensive for large files, use a carefully specified metadata revision and re-hash on import; the first implementation should prefer correctness.

### Existing files

The renderer may resolve any valid image file inside the selected vault, while imports always target `attachments/`. This allows existing portable Markdown to work without requiring a migration. A stricter attachments-only resolver is safer but would make manually authored root-level image references unexpectedly remain raw; the decision should be made before implementation.

## Tauri image serving

Use Tauri's built-in asset protocol rather than `file://`, base64-encoded image data, or repeated IPC reads.

Required configuration shape:

```toml
# Cargo.toml
tauri = { version = "2.11.5", features = ["protocol-asset"] }
```

```json
{
  "app": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": []
      }
    }
  }
}
```

The current CSP already includes the relevant image sources. The runtime resolver should call Tauri's asset scope `allow_file` only after Rust has validated the image. The frontend can then use `convertFileSrc(absolutePath)` and append the returned content revision as a cache-busting query parameter.

Prefer exact-file runtime authorization over a broad home-directory or entire-vault glob. This keeps the webview from becoming a general filesystem viewer. Re-authorizing a validated file during each resolution also avoids making `persisted-scope` a required dependency for the first implementation. If the app later depends on retained runtime scopes across restarts, Tauri's persisted-scope plugin supports asset-protocol scope persistence.

The asset scope must be re-established after vault selection/restoration or on demand. If Calmd later supports switching between arbitrary vaults in one process, a custom tokenized protocol or an explicit scope lifecycle will need consideration because runtime scopes are additive.

Do not allow the entire vault's attachments directory merely to make rendering convenient until the security and vault-switching behavior is tested. Exact-file authorization is the safer default.

## CodeMirror Live Preview design

The existing syntax tree already exposes `Image` and its destination-related children. Add image behavior to the shared Live Preview engine rather than creating a second renderer.

### Inactive image

Replace the complete parsed image range with an `ImageWidget`:

```text
![alt text](attachments/image.png)
             |
             +--> rendered image
```

The widget should contain an `img` element with:

- the resolved asset URL;
- the parsed alt text;
- `decoding="async"`;
- `draggable="false"`;
- bounded CSS sizing such as `max-width: 100%`;
- no user-controlled HTML.

An image that occupies its own line can use a block replacement. An image within prose should use an inline replacement. The line classification must be based on the parsed range and surrounding whitespace, not a regular expression over the whole document.

### Active image

When a caret or completed selection touches the image source:

- retain the complete Markdown source;
- add the rendered image after the source when useful;
- keep the source directly editable;
- allow clicking the rendered image to reveal/select its source range.

This follows the existing Calmd source-visibility contract: source becomes visible when it is relevant, rather than switching to a separate source mode.

`EditorView.atomicRanges` should expose the same replacement ranges so keyboard motion does not enter hidden image source positions unexpectedly. Direct programmatic selection must still be able to enter the source range.

### Loading and failure states

Use explicit states:

- **pending:** retain source or show a quiet measured placeholder; do not make a newly parsed image cause a large layout jump;
- **resolved:** render the image;
- **missing/corrupt:** render a compact unavailable placeholder with alt text;
- **unsupported/remote:** retain literal Markdown.

A failure must never result in a blank inaccessible range. Touching the image always recovers its source.

### Height stability

Async image decoding changes editor height. The widget should:

- expose `estimatedHeight` from a cache or intrinsic aspect-ratio estimate;
- cache settled height by image revision and available content width;
- remove temporary height overrides after load/error;
- call `view.requestMeasure()` after the image settles;
- avoid vertical margins on block widgets;
- participate in existing pointer-drag freezing.

The cache key must include content revision and width class. Caching only by filename can display a stale height after an external replacement or responsive width change.

### Async resolution state

Image resolution is asynchronous while decoration construction is synchronous. Model it like the existing wiki-link resolution:

- identify local `Image` destinations in the parsed ranges;
- keep pending/resolved/missing state in the Live Preview plugin;
- dispatch a resolution-change effect when a request completes;
- scope cache ownership to the editor document session and note key;
- clear or reconfigure it when a new note or vault is opened;
- avoid requests for remote, invalid, or unsupported destinations.

The plugin should observe parser progress and geometry changes so an image entering the viewport is resolved and measured deterministically rather than flashing between raw and rendered states.

### Reference-style images

CommonMark also supports reference-style images. Lezer represents these differently from inline images, with a label on the image and a separate link-reference definition. A complete Markdown implementation should resolve those definitions case-insensitively and use the referenced destination/title.

A practical staged approach is:

1. implement and test inline destinations first;
2. add a small document-level reference-definition resolver before claiming full image coverage;
3. leave unresolved reference images as source rather than guessing.

Do not use a broad regular expression to replace image syntax; rely on the Lezer tree and explicit source ranges.

## Insertion surfaces

### Paste

Handle images in the editor's `paste` DOM event before normal text insertion:

1. inspect `clipboardData.items` for `image/*`;
2. obtain the file or pixels;
3. capture the editor session, note key, and selection range;
4. import asynchronously;
5. map the captured positions through CodeMirror changes;
6. dispatch one Markdown insertion transaction after import;
7. let normal autosave persist the body.

If browser clipboard items do not expose the image, use `@tauri-apps/plugin-clipboard-manager`'s `readImage()`, retrieve `size()` and `rgba()`, encode PNG, and always close the returned Tauri image resource.

Add `clipboard-manager:allow-read-image` to `src-tauri/capabilities/default.json` only if this fallback is implemented. Do not grant broad clipboard permissions unnecessarily.

Text and HTML paste should retain current behavior. Do not parse arbitrary clipboard HTML for image URLs.

### Native picker

Add `Insert image…` to the existing quiet editor action menu. Prefer a Rust command using the already installed dialog plugin:

- show a native image-filtered picker;
- import the selected path through the attachment service;
- return the same response as paste;
- insert at the captured selection.

This keeps file access in Rust and avoids introducing direct frontend filesystem permissions.

### OS drag-and-drop

Tauri 2 exposes file paths and physical pointer positions through `getCurrentWebview().onDragDropEvent`.

Implement this after paste and picker:

- accept only image files;
- listen while the editor session is active;
- convert physical coordinates to webview/client coordinates using the platform's device scale;
- use `EditorView.posAtCoords` to find the insertion point;
- import and insert using the same async session/range machinery as paste;
- ignore drops outside the editor.

The position API and device-scale conversion require real Linux, Windows, and macOS testing. Tauri's file-drop handling can also interact with normal DOM text-drop behavior, so it should not replace the editor's existing text-paste/drop path without regression tests.

## Async insertion safety

Every import request must capture:

```text
editorSessionId
noteKey
selection ranges
```

On completion:

- if the editor session or note key no longer matches, do not edit the current document;
- otherwise map the captured range through the editor's intervening `ChangeSet` transactions;
- insert at the mapped position or replace the mapped selection;
- keep the imported file if insertion is abandoned, because it may be shared or intentionally retained.

The import transaction should be one undoable Markdown edit. The file operation itself is not an editor-history operation.

## Testing plan

### Rust attachment tests

- accepted image signatures and extensions;
- rejected extension/signature mismatches;
- byte-size and decoded-pixel limits;
- absolute paths, `..`, backslashes, URI schemes, and outside-vault paths;
- symlink and non-regular-file rejection;
- Unicode and portable filename sanitization;
- collision suffixes and no-overwrite behavior;
- creation of `attachments/`;
- atomic installation and cleanup of temporary files;
- valid, missing, corrupt, and externally changed image resolution;
- revision/hash and dimension reporting.

### Pure frontend tests

- inline image destination extraction;
- angle-bracket and escaped destinations;
- local versus remote/absolute/invalid destination classification;
- alt-text extraction and safe display text;
- Markdown destination formatting;
- reference-style definition resolution;
- cache keys and width-sensitive height entries;
- async insertion range mapping and session invalidation.

### Mounted editor tests

Use real `EditorView` instances to test:

- inactive inline and block image widgets;
- source reveal at caret boundaries and within selections;
- multiple and partial selections;
- nested images in formatted text where the parser permits them;
- keyboard movement and deletion around atomic replacements;
- click-to-reveal/source selection;
- pointer-drag freeze and one-time reconciliation;
- missing/corrupt fallback rendering;
- async parser progress and viewport changes;
- load/error height changes and scroll stability;
- note swaps, rename, and vault-session cache isolation.

### Tauri/E2E tests

- picker import and Markdown insertion;
- clipboard image paste;
- asset URL loading in development and release builds;
- vault restoration and exact-file asset authorization;
- external image references remaining local/source-only;
- traversal and absolute-path references failing safely;
- dropped files and insertion coordinates at different display scales;
- Linux, Windows, and macOS clipboard/image decoding behavior.

## Completed implementation phases

1. **Contract and shared helpers**
   - finalize formats, limits, path semantics, and failure UI;
   - add image destination/metadata helpers and tests;
   - record an ADR if the contract is accepted.

2. **Rust attachment service**
   - import, filename policy, atomic writes, validation, resolution, dimensions, and revisions;
   - add command registration and Rust tests.

3. **Asset protocol**
   - enable `protocol-asset`;
   - configure an empty static scope;
   - authorize exact validated image files at resolution time;
   - verify CSP and release builds.

4. **Live Preview widgets**
   - add image resolution state;
   - implement inline/block widgets, source reveal, atomic ranges, failure placeholders, and height caching;
   - add mounted CodeMirror tests.

5. **Paste and picker**
   - implement session-safe async insertion;
   - add clipboard image fallback and capability only if needed;
   - add the editor action.

6. **Drag-and-drop and hardening**
   - add Tauri path drops;
   - test physical-to-client coordinates across platforms;
   - complete reference-style images and documentation.

## Acceptance criteria

- Imported Markdown contains no absolute filesystem paths.
- Pasting or picking an image creates a portable attachment and inserts valid Markdown.
- Navigating to another note while an import is pending cannot modify the new note.
- Existing valid local images render without exposing arbitrary files.
- Caret and selection contact reliably reveal the complete image source.
- Missing images have an accessible, visible fallback.
- Image decoding does not produce persistent scroll jumps.
- Note renames do not break generated attachment references.
- Deleting a note does not delete shared attachments.
- Transient previews remain safe and alt-text-only.
- Remote, absolute, traversal, unsupported, and malformed destinations remain source text.

## Research sources

- [CommonMark — Images](https://spec.commonmark.org/0.31.2/#images): standard image structure, destinations, titles, and reference-style images.
- [CodeMirror 6 reference](https://codemirror.net/docs/ref/): `Decoration.replace`, block widgets, `WidgetType.estimatedHeight`, and `EditorView.atomicRanges`.
- [CodeMirror decoration example](https://codemirror.net/examples/decoration/): direct decorations for layout-affecting block widgets and widget equality behavior.
- [Tauri asset protocol](https://v2.tauri.app/security/asset-protocol/): enablement, scopes, exact-path authorization, and runtime scope considerations.
- [Tauri `convertFileSrc`](https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc): converting validated device paths into webview-loadable asset URLs.
- [Tauri CSP](https://v2.tauri.app/security/csp/): `asset:`/`blob:`/`data:` source policy requirements.
- [Tauri clipboard manager](https://v2.tauri.app/reference/javascript/clipboard-manager/): `readImage()`, RGBA extraction, and image resource behavior.
- [Tauri image API](https://v2.tauri.app/reference/javascript/api/namespaceimage/): `rgba()`, `size()`, and resource cleanup.
- [Tauri webview drag/drop](https://v2.tauri.app/reference/javascript/api/namespacewebview/#ondragdropevent): dropped paths and physical pointer positions.
- [Tauri filesystem scopes](https://docs.rs/tauri/latest/tauri/scope/fs/struct.Scope.html): runtime `allow_file`/`allow_directory` semantics.
- [Obsidian attachments](https://obsidian.md/help/attachments): attachments as regular vault files and paste/drop import behavior.
- [Obsidian embedded files](https://obsidian.md/help/How+to/Embed+files): common vault image embed conventions and dimension syntax.
- [Writer image fold implementation](https://github.com/joelbqz/writer-computer/blob/eef84557429ee1897c4c0b9eeec39af80cfe199e/apps/desktop/src/lib/prosemark-core/fold/image.ts): source-plus-preview behavior, intrinsic rendering, and measured-height caching.
- [Writer editor image-paste flow](https://github.com/joelbqz/writer-computer/blob/eef84557429ee1897c4c0b9eeec39af80cfe199e/apps/desktop/src/components/editor-area/use-prosemark-editor.ts): useful implementation reference and asynchronous cursor-placement race.
