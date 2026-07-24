# Internal links, navigation, backlinks, and coordinated rename

Calmd supports top-level wiki links in the forms `[[target]]` and `[[target|display text]]`. Targets identify Markdown filename stems case-insensitively; a trailing `.md` is accepted and omitted when Calmd writes a link. Paths, headings, blocks, embeds, nested links, multiline links, and links in code are not supported. Filename identity and visible title remain separate.

Modifier-clicking a link first flushes the source note. Rust then resolves the target authoritatively, rejects ambiguous case-folded matches, or creates a missing note. If filename sanitization or collision handling changes the target, the clicked occurrence is mapped through concurrent CodeMirror transactions, revalidated, rewritten canonically, and flushed before navigation.

Navigation uses application-owned history with a current-position cursor so asynchronous saves and conflicts can veto transitions. It preserves composer thoughts, supports note-to-note Back and Forward traversal, keeps Home reversible by adding a blank composer entry, avoids duplicate self-navigation, truncates forward history after a new destination opens, and rewrites historical keys after an internal rename.

Backlinks are derived state in schema version 2 of the rebuildable SQLite index. Outgoing links are stored by normalized filename identity. Backlink resolution requires exactly one matching target, so externally-created case ambiguities resolve to neither note. Foreign keys are enabled on every connection. The popover fetches backlinks only when opened and returns each source note once.

Internal rename scans Markdown rather than relying on the index, rewrites incoming links and self-links, and installs all changed files through the vault-local `.calmd-operation.json` recovery journal. A pre-commit interruption restores backups; a post-commit interruption preserves installed files and removes recovery artifacts. Malformed recovery state blocks vault mutation rather than guessing. Successful operations remove the journal and reconcile derived state afterward.

The current phase intentionally leaves filesystem watching, nested folders, external browser history, cursor restoration, and semantic retrieval out of scope.
