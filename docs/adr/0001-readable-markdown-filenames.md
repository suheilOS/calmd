# Separate note titles from safe Markdown filenames

Calmd will preserve the visible note title as the user-facing identity while deriving a predictable, filesystem-safe Markdown filename from it. Unsafe filesystem characters will use readable replacements rather than preventing the user from creating a thought or exposing encoded filenames. Calmd will not introduce opaque IDs. The exact replacement map and collision policy are deferred until filesystem integration. The Markdown files remain the source of truth; search indexes, metadata caches, and semantic indexes are derived and must be rebuildable.

Internal links will target the derived safe filename while displaying the original note title. When a note is renamed inside Calmd, its filename and links should update together. External rename detection is best-effort: without an internal ID, an ambiguous filesystem change may be observed as a deletion and a creation rather than a provable rename.

This follows Obsidian’s file-first model: a vault is a local folder of Markdown files that can be edited with external tools, and renaming a note updates links to it. References: [Vault settings](https://obsidian.md/help/data-storage), [Create a new note](https://obsidian.md/help/create-note), and [Supported formats for internal links](https://obsidian.md/help/links).
