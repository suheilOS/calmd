# Portable local images

Calmd supports local PNG, JPEG, GIF, and WebP images through standard inline Markdown image syntax. Markdown remains the sole source of truth. Calmd-generated destinations use forward-slash, vault-relative paths; imports are placed in the vault-root `attachments/` directory, while existing valid images may resolve from anywhere inside the selected vault. Note renames therefore do not alter generated image destinations.

Rust owns attachment validation, naming, atomic import, path resolution, and exact-file asset authorization. Imports are limited to 10 MiB of compressed data and 40 megapixels of decoded image dimensions. Validation requires an allowed extension and matching decoded format. Imports never overwrite an existing file. Resolution rejects absolute paths, URI schemes, traversal, backslashes, query strings, fragments, symlinks, non-files, unsupported formats, and paths outside the selected vault.

The editor renders validated images through Tauri's scoped asset protocol. Image source remains directly recoverable when a caret or selection touches it; unavailable images retain an accessible visible fallback. Clipboard paste and a native picker are the initial insertion surfaces. OS file drag-and-drop and reference-style images are deferred until the core import and rendering path is stable.

Remote images, `file://` URLs, absolute paths, wiki embeds, raw HTML images, SVG, AVIF, image editing, attachment deletion, and attachment browsing remain unsupported. Transient note previews continue to suppress image loading and expose only safe text.
