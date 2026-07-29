# 001 — Highlight the active table-of-contents section

- **Status**: TODO
- **Commit**: 83e3472
- **Severity**: LOW
- **Category**: Missed opportunities; easing and duration
- **Estimated scope**: 2 files, about 45 lines

## Problem

The fixed table of contents does not indicate which case-study section currently occupies the reading position. All links retain the same muted color while the article scrolls:

```astro
<!-- site/src/pages/index.astro:18 — current -->
<nav class="table-of-contents" aria-label="On this page">
  <ol>
    <li><a href="#pattern-title">the pattern</a></li>
    <li><a href="#failed-solution-title">the failed solution</a></li>
    <li><a href="#realization-title">the realization</a></li>
    <li><a href="#medium-title">the medium</a></li>
    <li><a href="#result-title">the result</a></li>
  </ol>
</nav>
```

```css
/* site/src/styles/global.css:187 — current */
.table-of-contents a {
  transition: color 150ms ease-out;
}

.table-of-contents a:hover {
  color: var(--color-ink);
}
```

This makes the TOC useful for navigation but not for orientation. The active state should use Calmd’s existing orange accent and a small composited scale change. The scale must use `transform`, not font-size, so changing sections does not shift the list layout.

## Target

Add scroll-spy behavior that assigns `.is-active` and `aria-current="location"` to exactly one TOC link after the reader reaches the article. Select the last section heading whose top is at or above a reading line positioned 35% down the viewport. Before the first section reaches that line, select the first section. When the document reaches its bottom (within 2 CSS pixels), select the final section so a short final section can become active.

Use the existing orange token and the following exact motion values:

```css
/* target additions */
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
}

.table-of-contents a {
  display: inline-block;
  transform-origin: left center;
  transition: color 150ms ease, transform 160ms var(--ease-out);
}

.table-of-contents a.is-active {
  color: var(--color-accent);
  transform: scale(1.06);
}

@media (prefers-reduced-motion: reduce) {
  .table-of-contents a.is-active {
    transform: none;
  }
}
```

The active state must remain orange under hover. Keep the existing non-active hover color:

```css
.table-of-contents a:hover {
  color: var(--color-ink);
}

.table-of-contents a.is-active,
.table-of-contents a.is-active:hover {
  color: var(--color-accent);
}
```

Add a small inline module script to `site/src/pages/index.astro`. It must:

1. Query `.table-of-contents a[href^="#"]`.
2. Resolve each link’s hash to its heading with `document.querySelector(link.hash)`.
3. On initial load and passive `scroll` events, schedule at most one update per animation frame.
4. Compare each heading’s `getBoundingClientRect().top` against `window.innerHeight * 0.35`.
5. Set `.is-active` and `aria-current="location"` only on the selected link; remove both from every other link.
6. Select the final link when `window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2`.
7. Do nothing cleanly if the TOC is absent or no valid heading/link pairs are found.

Use `requestAnimationFrame` rather than writing classes directly in every scroll event. Do not animate or change font size.

## Repo conventions to follow

- Global palette and typography tokens live in `site/src/styles/global.css:4`; reuse `--color-accent` rather than introducing another orange.
- Existing small interactions use explicit transition properties rather than `transition: all`, for example `site/src/styles/global.css:136`:

```css
.site-header a,
.site-footer a {
  transition: color 150ms ease-out;
}
```

- Reduced-motion handling already lives at `site/src/styles/global.css:290`; add the TOC-specific transform removal inside that existing media query.
- The site is static Astro with no client framework and no motion dependency. Use a native inline `<script>` in `site/src/pages/index.astro`; do not add a package.

## Steps

1. In `site/src/styles/global.css`, add `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` beside the existing root-level visual tokens.
2. Replace the current `.table-of-contents a` transition with `display: inline-block`, `transform-origin: left center`, and the exact `color 150ms ease, transform 160ms var(--ease-out)` transition.
3. Add `.table-of-contents a.is-active` and `.table-of-contents a.is-active:hover` rules using `color: var(--color-accent)` and `transform: scale(1.06)`. Preserve the existing muted default and ink-colored non-active hover state.
4. Inside the existing `@media (prefers-reduced-motion: reduce)` block, add `.table-of-contents a.is-active { transform: none; }`. Keep the orange state change because it communicates position without movement.
5. In `site/src/pages/index.astro`, append one inline `<script>` after the footer and before `</SiteLayout>`. Build an array of valid `{ link, heading }` pairs from the TOC hashes.
6. In that script, implement a `setActiveLink()` function using the 35%-viewport reading line and 2-pixel document-bottom override. Toggle `.is-active` and `aria-current="location"` across every pair on each update.
7. Add a passive scroll listener that uses a boolean `framePending` guard and `requestAnimationFrame`. Call `setActiveLink()` once immediately after setup. No resize listener is required because `window.innerHeight` is read fresh during every update; add a passive resize listener using the same scheduler only if testing shows stale state after resizing without scrolling.

## Boundaries

- Do NOT change the TOC labels, article copy, section IDs, content width, or left-side placement.
- Do NOT animate `font-size`, width, margin, padding, top, or left.
- Do NOT add Intersection Observer, a framework component, or a motion dependency; five headings do not justify extra abstraction.
- Do NOT add progress bars, markers, underlines, or background fills.
- Do NOT modify `site/src/components/ProductMoment.astro` or `site/src/layouts/SiteLayout.astro`.
- If the cited markup or selectors have drifted since commit `83e3472`, STOP and report instead of improvising.

## Verification

- **Mechanical**: run `cd site && bun run build`; it must complete with one generated page and no Astro or TypeScript errors.
- **Feel check**: run `cd site && bun run dev`, open the page wider than `74rem`, and scroll slowly through every section. Confirm:
  - exactly one TOC item is orange once the page loads;
  - the orange item follows the section crossing the line 35% down the viewport;
  - the active label grows subtly without moving adjacent labels or changing their baselines;
  - the transition retargets cleanly when reversing scroll direction quickly;
  - the final “the result” item becomes active at the bottom of the document;
  - hovering the active item keeps it orange, while hovering inactive items uses `--color-ink`.
- In DevTools, inspect the active anchor and confirm its computed transform is `scale(1.06)` and its color resolves from `--color-accent`.
- In DevTools Rendering, emulate `prefers-reduced-motion: reduce`; confirm the active item still changes to orange but no longer scales.
- **Done when**: scroll position is represented by exactly one `aria-current="location"` TOC link, active changes animate only `color` and `transform`, and reduced-motion users receive color-only feedback.
