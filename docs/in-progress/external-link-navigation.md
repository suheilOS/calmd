# External link navigation

## Status

Implemented; pending acceptance and manual Tauri verification.

## Problem

The Markdown editor styles bare `https://...` text as a URL, but modifier-click navigation only looks for a `Link` syntax node. A bare URL is parsed as a top-level `URL` node, so the handler returns without calling the Tauri opener.

## Goal

Make supported external HTTP(S) URLs open with the platform's primary modifier click, regardless of whether they are written as:

- bare URL: `https://example.com`
- Markdown link: `[Example](https://example.com)`
- Markdown autolink: `<https://example.com>`

Preserve the existing editing and Live Preview behavior.

## Design

1. Keep the existing platform-aware modifier contract:
   - macOS: `Cmd`-click
   - Windows/Linux and other non-Mac platforms: `Ctrl`-click
   - reject plain clicks and clicks with `Alt` or `Shift`
   - only handle the primary mouse button
2. Generalize the existing `activateExternalLink` path in `src/MarkdownEditor.tsx` to locate an external destination from the syntax tree rather than requiring the enclosing node to be `Link`.
3. Resolve the URL destination for both:
   - a directly hit `URL` node from a bare URL
   - a `URL` descendant of a `Link` or `Autolink` node
4. Continue validating destinations with `new URL(...)` and allow only absolute `http:` and `https:` URLs.
5. Keep the existing behavior after validation: prevent the editor's default action, dismiss any note preview, and call `openUrl(url.href)`.
6. Avoid creating DOM anchors or changing Markdown persistence; CodeMirror's syntax tree remains the source for activation.

## Implementation steps

1. Add a small syntax-tree URL lookup helper, either local to `MarkdownEditor.tsx` or extracted to a focused testable module, that returns the URL text at the clicked position for all supported node shapes.
2. Update `activateExternalLink` to use that helper and retain the existing modifier, protocol, dismissal, and opener behavior.
3. Add unit coverage for URL lookup and modifier/platform behavior, or editor-level coverage if the opener can be safely mocked.
4. Update `tests/MarkdownEditor.test.tsx` with integration cases proving that bare URLs open and that existing formatted links remain functional.
5. Run formatting/linting, the frontend test suite, and the TypeScript production build.
6. Manually verify in the Tauri app on at least one Mac-like and one non-Mac platform/webview that modifier-click opens the system browser and an ordinary click still edits/selects text.

## Tests

Cover:

- bare `https://example.com` opens
- `[label](https://example.com)` still opens
- `<https://example.com>` opens
- bare URLs embedded in prose open
- `http://` is supported
- non-HTTP(S) destinations do not open
- ordinary click does not open
- wrong modifier on macOS/non-Mac does not open
- `Alt`/`Shift`, secondary-button, and combined `Ctrl+Cmd` clicks do not open
- URLs inside code remain non-navigable

## Acceptance criteria

- A bare absolute HTTP(S) URL can be opened with `Cmd`-click on macOS and `Ctrl`-click on Windows/Linux.
- Existing Markdown-link and wiki-link behavior is unchanged.
- Normal clicks remain available for caret placement and editing.
- No new link syntax, persistence behavior, or external navigation history is introduced.

## Completed

- Added syntax-tree URL lookup for bare URLs, Markdown links, and autolinks.
- Centralized HTTP(S) validation and external-link activation in `src/externalLinks.ts`.
- Moved the shared platform modifier policy into `src/navigation.ts`, used by wiki links, external links, and previews.
- Kept `Cmd` on macOS and `Ctrl` on non-Mac platforms through the shared navigation contract.
- Added parser and editor activation coverage in `tests/externalLinks.test.ts` and `tests/MarkdownEditor.test.tsx`.

## Validation

- `bun test`: 145 tests passed.
- `bun run build`: passed.
- Scoped ESLint for changed source and test files: passed.

## Cleanup

After acceptance and manual Tauri verification, remove this in-progress plan or preserve the durable behavior only in the existing Markdown editor documentation.
