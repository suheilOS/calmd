# Separate note titles from safe Markdown filenames

Calmd preserves the visible note title as the user-facing identity while deriving a predictable, filesystem-safe Markdown filename from it. The characters `< > : " / \\ | ? *` and control characters become hyphens, trailing spaces and periods are removed, and Windows device names receive a readable ` note` suffix. Names are compared case-insensitively for collisions and receive numbered suffixes such as `Purification (2).md`. Long stems are truncated only at UTF-8 character boundaries. These transformations never change the visible title.

Calmd does not introduce opaque IDs. The Markdown files remain the source of truth; search indexes, metadata caches, and semantic indexes are derived and must be rebuildable.

Internal links will target the derived safe filename while displaying the original note title. When a note is renamed inside Calmd, its filename and links should update together. External rename detection is best-effort: without an internal ID, an ambiguous filesystem change may be observed as a deletion and a creation rather than a provable rename.

This follows Obsidian’s file-first model: a vault is a local folder of Markdown files that can be edited with external tools, and renaming a note updates links to it. References: [Vault settings](https://obsidian.md/help/data-storage), [Create a new note](https://obsidian.md/help/create-note), and [Supported formats for internal links](https://obsidian.md/help/links).
