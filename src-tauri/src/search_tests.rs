use super::*;
use std::fs;
use tempfile::tempdir;

fn note(key: &str, title: &str, body: &str, revision: &str) -> IndexedNote {
    IndexedNote {
        key: key.to_owned(),
        title: title.to_owned(),
        body: body.to_owned(),
        revision: revision.to_owned(),
        modified_at_ms: 1,
    }
}

fn state(root: &Path) -> SearchState {
    SearchState::available(root.to_path_buf())
}

#[test]
fn reconciles_searches_updates_and_removes_notes() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    let original = note(
        "Water.md",
        "Pure Water",
        "A quiet purification process",
        "one",
    );
    let body_match = note(
        "Other.md",
        "Field notes",
        "Pure water appears in this body",
        "two",
    );
    search
        .reconcile(vault.path(), &[original.clone(), body_match])
        .unwrap();

    let response = search.search("pure wat").unwrap();
    assert_eq!(response.results[0].key, "Water.md");
    assert!(!response.has_exact_match);
    let body_search = search.search("purification").unwrap();
    assert!(body_search.results[0].excerpt.starts_with("A quiet"));
    assert!(body_search.results[0].excerpt.contains("purification"));
    let modified_at_ms: i64 = search
        .inner
        .lock()
        .unwrap()
        .connection
        .as_ref()
        .unwrap()
        .query_row(
            "SELECT modified_at_ms FROM notes WHERE key = 'Water.md'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(modified_at_ms, 1);

    let updated = note("Water.md", "Pure Water", "Entirely revised", "three");
    search.reconcile(vault.path(), &[updated]).unwrap();
    assert!(search.search("purification").unwrap().results.is_empty());
    assert!(search.search("field notes").unwrap().results.is_empty());
}

#[test]
fn body_excerpt_is_match_specific_concise_and_cleans_wiki_brackets() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    let opening = "unrelated opening material ".repeat(80);
    let body =
        format!("{opening}transition text [[distinctive phrase]] with useful nearby context");
    search
        .reconcile(vault.path(), &[note("Long.md", "Long note", &body, "one")])
        .unwrap();

    let response = search.search("distinctive phrase").unwrap();
    let excerpt = &response.results[0].excerpt;

    assert!(excerpt.contains("distinctive phrase"));
    assert!(excerpt.contains("useful nearby context"));
    assert!(!excerpt.starts_with("unrelated opening material"));
    assert!(excerpt.chars().count() <= MAX_EXCERPT_CHARACTERS);
    assert!(!excerpt.contains("[["));
    assert!(!excerpt.contains("]]"));
}

#[test]
fn title_matches_rank_above_equivalent_body_only_matches() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("Body.md", "Field notes", "quiet signal", "one"),
                note("Title.md", "Quiet signal", "unrelated body", "two"),
            ],
        )
        .unwrap();

    let response = search.search("quiet sig").unwrap();
    assert_eq!(response.results[0].key, "Title.md");
}

#[test]
fn exact_titles_bypass_fts_minimum_and_return_one_bounded_result() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("Go.md", "Go", &"opening text ".repeat(100), "one"),
                note("Other.md", "Other", "Go appears in the body", "two"),
            ],
        )
        .unwrap();

    let response = search.search("  GO ").unwrap();
    assert!(response.has_exact_match);
    assert_eq!(response.results.len(), 1);
    assert_eq!(response.results[0].key, "Go.md");
    assert!(response.results[0].excerpt.chars().count() <= MAX_EXCERPT_CHARACTERS);
}

#[test]
fn trigram_search_handles_unicode_diacritics_and_metacharacters() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("Japanese.md", "静かな考え", "検索できる本文", "one"),
                note(
                    "Cafe.md",
                    "Café notes",
                    "C++ and quoted \"text\". A long opening before the matching résumé passage",
                    "two",
                ),
            ],
        )
        .unwrap();

    assert_eq!(
        search.search("かな考").unwrap().results[0].key,
        "Japanese.md"
    );
    assert_eq!(search.search("cafe").unwrap().results[0].key, "Cafe.md");
    let diacritic_match = search.search("resume").unwrap();
    assert_eq!(diacritic_match.results[0].key, "Cafe.md");
    assert!(diacritic_match.results[0].excerpt.contains("résumé"));
    assert_eq!(search.search("C++").unwrap().results[0].key, "Cafe.md");
    assert_eq!(
        search.search("quoted \"text\"").unwrap().results[0].key,
        "Cafe.md"
    );
    assert!(search.search("\"").is_ok());
}

#[test]
fn arabic_search_handles_titles_bodies_diacritics_and_mixed_text() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note(
                    "Arabic.md",
                    "التَّأمل الهادئ",
                    "ملاحظات عن Markdown والإِصدار 6 في عام 2026",
                    "one",
                ),
                note("Other.md", "ملاحظة أخرى", "نص مختلف", "two"),
            ],
        )
        .unwrap();

    let title_match = search.search("التأمل الهادئ").unwrap();
    assert!(title_match.has_exact_match);
    assert_eq!(title_match.results[0].key, "Arabic.md");
    let body_match = search.search("Markdown والإصدار 6").unwrap();
    assert_eq!(body_match.results[0].key, "Arabic.md");
    assert!(body_match.results[0].excerpt.contains("الإِصدار"));
    assert_eq!(search.suggest_notes("الهاد").unwrap()[0].key, "Arabic.md");
}

#[test]
fn note_suggestions_match_titles_and_keys_without_searching_bodies() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("Field-guide.md", "Guide", "orchard", "one"),
                note("Orchard.md", "Orchard notes", "", "two"),
                note("Other.md", "Other", "orchard", "three"),
            ],
        )
        .unwrap();

    assert_eq!(
        search
            .suggest_notes("orch")
            .unwrap()
            .into_iter()
            .map(|note| note.key)
            .collect::<Vec<_>>(),
        vec!["Orchard.md"]
    );
    assert_eq!(
        search.suggest_notes("field").unwrap()[0].key,
        "Field-guide.md"
    );
    assert_eq!(search.suggest_notes("").unwrap().len(), 3);
}

#[test]
fn recreate_missing_or_invalid_database_without_touching_vault() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let markdown = vault.path().join("Knowledge.md");
    fs::write(&markdown, "# Knowledge\n\nIntact").unwrap();
    let indexed = note("Knowledge.md", "Knowledge", "Intact", "one");

    {
        let search = state(data.path());
        search
            .reconcile(vault.path(), std::slice::from_ref(&indexed))
            .unwrap();
    }
    fs::remove_file(data.path().join(DATABASE_FILE)).unwrap();
    {
        let search = state(data.path());
        search
            .reconcile(vault.path(), std::slice::from_ref(&indexed))
            .unwrap();
        assert_eq!(search.search("Knowledge").unwrap().results.len(), 1);
    }
    fs::write(data.path().join(DATABASE_FILE), b"not a database").unwrap();
    {
        let search = state(data.path());
        search.reconcile(vault.path(), &[indexed]).unwrap();
        assert_eq!(search.search("Intact").unwrap().results.len(), 1);
    }
    assert_eq!(
        fs::read_to_string(markdown).unwrap(),
        "# Knowledge\n\nIntact"
    );
    assert!(!vault.path().join(DATABASE_FILE).exists());
}

#[test]
fn backlinks_are_deduplicated_and_ambiguity_resolves_to_neither_note() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("Target.md", "Target", "", "one"),
                note(
                    "Source.md",
                    "Source",
                    "[[Target]] and [[Target|again]]",
                    "two",
                ),
            ],
        )
        .unwrap();

    assert_eq!(
        search.backlinks("Target.md").unwrap(),
        vec![NoteReference {
            key: "Source.md".to_owned(),
            title: "Source".to_owned(),
        }]
    );

    search
        .reconcile(
            vault.path(),
            &[
                note("Target.md", "Target", "", "one"),
                note("target.MD", "other", "", "three"),
                note("Source.md", "Source", "[[Target]]", "two"),
            ],
        )
        .unwrap();
    assert!(search.backlinks("Target.md").unwrap().is_empty());
}

#[test]
fn unlinked_mentions_filter_markdown_ranges_and_deduplicate_sources() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("target-file.md", "Visible Target", "Visible Target", "one"),
                note(
                    "Source.md",
                    "Source",
                    "A visible target appears here and Visible Target repeats.\n\n[[target-file|Visible Target]] `Visible Target`\n```\nVisible Target\n```",
                    "two",
                ),
                note("Linked.md", "Linked", "[[target-file|Visible Target]]", "three"),
                note("Token.md", "Token", "NotVisible Targeted", "four"),
            ],
        )
        .unwrap();

    let mentions = search.unlinked_mentions("target-file.md").unwrap();
    assert_eq!(mentions.len(), 1);
    assert_eq!(mentions[0].key, "Source.md");
    assert_eq!(
        search.backlinks("target-file.md").unwrap(),
        vec![
            NoteReference {
                key: "Linked.md".to_owned(),
                title: "Linked".to_owned(),
            },
            NoteReference {
                key: "Source.md".to_owned(),
                title: "Source".to_owned(),
            },
        ]
    );
    assert!(
        mentions[0]
            .excerpt
            .to_lowercase()
            .contains("visible target")
    );
    assert!(!mentions[0].excerpt.contains("[["));
}

#[test]
fn unlinked_mentions_support_short_titles_and_reject_ambiguous_titles() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("AI.md", "AI", "", "one"),
                note("Source.md", "Source", "Using ai calmly", "two"),
            ],
        )
        .unwrap();
    assert_eq!(
        search.unlinked_mentions("AI.md").unwrap()[0].key,
        "Source.md"
    );

    search
        .reconcile(
            vault.path(),
            &[
                note("AI.md", "AI", "", "one"),
                note("Other.md", "ai", "", "three"),
                note("Source.md", "Source", "Using AI calmly", "two"),
            ],
        )
        .unwrap();
    assert!(search.unlinked_mentions("AI.md").unwrap().is_empty());
}

#[test]
fn unlinked_mentions_ignore_arabic_harakat_but_preserve_the_excerpt() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("Target.md", "التَّأمل", "", "one"),
                note("Source.md", "مصدر", "يفيد التأملُ في ترتيب الأفكار", "two"),
                note("Short-target.md", "نَص", "", "three"),
                note("Short-source.md", "قصير", "هذا نصٌ واضح", "four"),
            ],
        )
        .unwrap();

    let mentions = search.unlinked_mentions("Target.md").unwrap();
    assert_eq!(mentions[0].key, "Source.md");
    assert!(mentions[0].excerpt.contains("التأملُ"));
    let short_mentions = search.unlinked_mentions("Short-target.md").unwrap();
    assert_eq!(short_mentions[0].key, "Short-source.md");
    assert!(short_mentions[0].excerpt.contains("نصٌ"));
}

#[test]
fn unlinked_mentions_handle_fts_quotes_and_ambiguous_keys() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("Quote.md", "Say \"Hello\"", "", "one"),
                note("Source.md", "Source", "Please say \"hello\" now.", "two"),
            ],
        )
        .unwrap();
    assert_eq!(
        search.unlinked_mentions("Quote.md").unwrap()[0].key,
        "Source.md"
    );

    search
        .reconcile(
            vault.path(),
            &[
                note("Quote.md", "Say \"Hello\"", "", "one"),
                note("quote.MD", "Different", "", "three"),
                note("Source.md", "Source", "Please say \"hello\" now.", "two"),
            ],
        )
        .unwrap();
    assert!(search.unlinked_mentions("Quote.md").unwrap().is_empty());
}

#[test]
fn random_key_selects_indexed_notes_and_honors_exclusion() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("First.md", "First", "", "one"),
                note("Second.md", "Second", "", "two"),
                note("Third.md", "Third", "", "three"),
            ],
        )
        .unwrap();

    for _ in 0..16 {
        let key = search.random_key(None).unwrap().unwrap();
        assert!(matches!(
            key.as_str(),
            "First.md" | "Second.md" | "Third.md"
        ));
        assert_ne!(
            search.random_key(Some("First.md")).unwrap().unwrap(),
            "First.md"
        );
    }

    assert!(search.random_key(Some("First.md")).unwrap().is_some());
}

#[test]
fn random_key_returns_none_for_empty_indexes_or_exhausted_exclusions() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());

    search.reconcile(vault.path(), &[]).unwrap();
    assert!(search.random_key(None).unwrap().is_none());

    search
        .reconcile(vault.path(), &[note("Only.md", "Only", "", "one")])
        .unwrap();
    assert_eq!(search.random_key(None).unwrap().as_deref(), Some("Only.md"));
    assert!(search.random_key(Some("Only.md")).unwrap().is_none());
}

#[test]
fn remove_clears_retrieval_and_backlinks_without_removing_other_outgoing_links() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    search
        .reconcile(
            vault.path(),
            &[
                note("Deleted.md", "Deleted", "", "one"),
                note("Other.md", "Other", "", "two"),
                note("Source.md", "Source", "[[Deleted]] and [[Other]]", "three"),
            ],
        )
        .unwrap();

    search.remove("Deleted.md").unwrap();

    assert!(
        search
            .search("Deleted")
            .unwrap()
            .results
            .iter()
            .all(|result| result.key != "Deleted.md")
    );
    assert!(search.backlinks("Deleted.md").unwrap().is_empty());
    assert_eq!(search.backlinks("Other.md").unwrap()[0].key, "Source.md");
}

#[test]
fn replace_removes_a_renamed_key_transactionally() {
    let data = tempdir().unwrap();
    let vault = tempdir().unwrap();
    let search = state(data.path());
    let original = note("Old.md", "Old", "Original body", "one");
    search.reconcile(vault.path(), &[original]).unwrap();

    let renamed = note("New.md", "New", "Replacement body", "two");
    search.replace(Some("Old.md"), &renamed).unwrap();

    assert!(search.search("Original").unwrap().results.is_empty());
    assert_eq!(
        search.search("Replacement").unwrap().results[0].key,
        "New.md"
    );
}
