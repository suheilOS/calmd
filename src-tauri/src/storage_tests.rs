use super::*;
use tempfile::tempdir;

#[test]
fn parses_canonical_markdown() {
    assert_eq!(
        parse_markdown("# Purification\n\nThe body", "fallback"),
        ("Purification".to_owned(), "The body".to_owned())
    );
}

#[test]
fn parses_a_leading_title_after_a_bom_or_blank_lines() {
    assert_eq!(
        parse_markdown("\u{feff}# BOM title\n\nBody", "fallback"),
        ("BOM title".to_owned(), "Body".to_owned())
    );
    assert_eq!(
        parse_markdown("\n\r\n# Blank title\n\nBody", "fallback"),
        ("Blank title".to_owned(), "Body".to_owned())
    );
}

#[test]
fn preserves_external_content_when_an_h1_is_not_leading() {
    let content = "Preface\n# Later title\nBody";
    assert_eq!(
        parse_markdown(content, "External"),
        ("External".to_owned(), content.to_owned())
    );
}

#[test]
fn preserves_files_without_an_h1() {
    let content = "An external note without a heading";
    assert_eq!(
        parse_markdown(content, "External"),
        ("External".to_owned(), content.to_owned())
    );
}

#[test]
fn parses_crlf_and_unicode_titles() {
    assert_eq!(
        parse_markdown("# عنوان عربي\r\n\r\nالمحتوى", "fallback"),
        ("عنوان عربي".to_owned(), "المحتوى".to_owned())
    );
    assert_eq!(
        parse_markdown("# 静かな考え\n\n本文", "fallback"),
        ("静かな考え".to_owned(), "本文".to_owned())
    );
}

#[test]
fn derives_portable_filenames_without_changing_titles() {
    assert_eq!(safe_filename_stem("A/B: C?"), "A-B- C-");
    assert_eq!(safe_filename_stem("CON"), "CON note");
    assert_eq!(safe_filename_stem("NUL.txt"), "NUL.txt note");
    assert_eq!(safe_filename_stem("Trailing. "), "Trailing");
    assert_eq!(safe_filename_stem("عنوان عربي"), "عنوان عربي");
}

#[test]
fn creates_a_named_vault_inside_the_selected_location() {
    let location = tempdir().unwrap();
    let vault = create_vault_directory(location.path(), "Research").unwrap();
    assert_eq!(
        vault,
        location.path().join("Research").canonicalize().unwrap()
    );
    assert!(vault.is_dir());
    assert!(create_vault_directory(location.path(), "Research").is_err());
    assert!(create_vault_directory(location.path(), "NUL").is_err());
    assert!(create_vault_directory(location.path(), "unsafe/name").is_err());
    assert!(create_vault_directory(location.path(), "trailing.").is_err());
}

#[test]
fn handles_case_insensitive_filename_collisions() {
    let vault = tempdir().unwrap();
    fs::write(vault.path().join("Purification.md"), "existing").unwrap();
    assert_eq!(
        available_filename(vault.path(), "purification", None).unwrap(),
        "purification (2).md"
    );
}

#[test]
fn creates_saves_renames_and_detects_conflicts() {
    let vault = tempdir().unwrap();
    let created = create_note_in(vault.path(), "Purification").unwrap();
    assert_eq!(created.key, "Purification.md");

    let saved = save_note_in(
        vault.path(),
        &created.key,
        &created.title,
        "Complete body",
        &created.revision,
    )
    .unwrap();
    assert_eq!(saved.body, "Complete body");

    fs::write(
        vault.path().join(&saved.key),
        "# Purification\n\nExternal edit",
    )
    .unwrap();
    let conflict = save_note_in(
        vault.path(),
        &saved.key,
        &saved.title,
        "Calmd edit",
        &saved.revision,
    )
    .unwrap_err();
    assert_eq!(conflict.code, "conflict");

    let reopened = read_note_in(vault.path(), &saved.key).unwrap();
    let renamed = rename_note_in(
        vault.path(),
        &reopened.key,
        "تنقية",
        &reopened.body,
        &reopened.revision,
    )
    .unwrap();
    assert_eq!(renamed.key, "تنقية.md");
    assert!(!vault.path().join("Purification.md").exists());
    assert_eq!(
        read_note_in(vault.path(), "تنقية.md").unwrap().title,
        "تنقية"
    );
}

#[test]
fn find_or_create_returns_an_existing_exact_title_without_creating_a_duplicate() {
    let vault = tempdir().unwrap();
    let original = create_note_in(vault.path(), "Quiet Thought").unwrap();

    let reopened = find_or_create_note_in(vault.path(), "  quiet   thought  ").unwrap();

    assert_eq!(reopened.key, original.key);
    assert_eq!(scan_vault(vault.path()).unwrap().len(), 1);
}

#[test]
fn index_failure_does_not_change_a_successful_markdown_write() {
    let vault = tempdir().unwrap();
    let note = create_note_in(vault.path(), "Durable source").unwrap();
    let search = SearchState::unavailable("injected index failure");

    best_effort_index(&search, vault.path(), None, &note);

    let stored = read_note_in(vault.path(), &note.key).unwrap();
    assert_eq!(stored.title, "Durable source");
    assert_eq!(stored.revision, note.revision);
}

#[test]
fn rename_uses_a_collision_suffix_without_overwriting() {
    let vault = tempdir().unwrap();
    let note = create_note_in(vault.path(), "First").unwrap();
    fs::write(vault.path().join("Taken.md"), "unrelated").unwrap();

    let renamed =
        rename_note_in(vault.path(), &note.key, "Taken", "updated", &note.revision).unwrap();

    assert_eq!(renamed.key, "Taken (2).md");
    assert_eq!(
        fs::read_to_string(vault.path().join("Taken.md")).unwrap(),
        "unrelated"
    );
    assert_no_temporary_files(vault.path());
}

#[test]
fn handles_case_only_renames() {
    let vault = tempdir().unwrap();
    let note = create_note_in(vault.path(), "Case").unwrap();
    let renamed =
        rename_note_in(vault.path(), &note.key, "case", &note.body, &note.revision).unwrap();

    assert_eq!(renamed.key, "case.md");
    assert_eq!(renamed.title, "case");
    assert_no_temporary_files(vault.path());
}

#[test]
fn rename_conflict_leaves_the_original_unchanged() {
    let vault = tempdir().unwrap();
    let note = create_note_in(vault.path(), "Original").unwrap();
    let original_path = vault.path().join(&note.key);
    fs::write(&original_path, "# Original\n\nExternal edit").unwrap();

    let error = rename_note_in(
        vault.path(),
        &note.key,
        "Renamed",
        "Calmd edit",
        &note.revision,
    )
    .unwrap_err();

    assert_eq!(error.code, "conflict");
    assert_eq!(
        fs::read_to_string(original_path).unwrap(),
        "# Original\n\nExternal edit"
    );
    assert!(!vault.path().join("Renamed.md").exists());
    assert_no_temporary_files(vault.path());
}

#[test]
fn failed_destination_install_restores_the_original() {
    let vault = tempdir().unwrap();
    let note = create_note_in(vault.path(), "Original").unwrap();
    let original_path = vault.path().join(&note.key);
    let original_content = fs::read_to_string(&original_path).unwrap();

    let error = rename_note_in_with(
        vault.path(),
        &note.key,
        "Renamed",
        "updated",
        &note.revision,
        |_, _| Err(std::io::Error::other("injected destination failure")),
    )
    .unwrap_err();

    assert_eq!(error.code, "io");
    assert_eq!(fs::read_to_string(original_path).unwrap(), original_content);
    assert!(!vault.path().join("Renamed.md").exists());
    assert_no_temporary_files(vault.path());
}

#[test]
fn renames_unicode_filenames_and_returns_complete_canonical_note() {
    let vault = tempdir().unwrap();
    let note = create_note_in(vault.path(), "Original").unwrap();
    let renamed = rename_note_in(
        vault.path(),
        &note.key,
        "  تنقية   هادئة  ",
        "المحتوى",
        &note.revision,
    )
    .unwrap();

    assert_eq!(renamed.key, "تنقية هادئة.md");
    assert_eq!(renamed.title, "تنقية هادئة");
    assert_eq!(renamed.body, "المحتوى");
    assert_eq!(
        renamed.revision,
        revision("# تنقية هادئة\n\nالمحتوى".as_bytes())
    );
    assert_no_temporary_files(vault.path());
}

fn assert_no_temporary_files(root: &Path) {
    let temporary_files = fs::read_dir(root)
        .unwrap()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| name.starts_with(TEMP_FILE_PREFIX))
        .collect::<Vec<_>>();
    assert!(
        temporary_files.is_empty(),
        "temporary files: {temporary_files:?}"
    );
}

#[test]
fn rejects_traversal_and_symlinks() {
    let vault = tempdir().unwrap();
    assert!(validated_note_path(vault.path(), "../outside.md").is_err());

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        fs::write(vault.path().join("real.md"), "# Real\n\n").unwrap();
        symlink(vault.path().join("real.md"), vault.path().join("link.md")).unwrap();
        assert!(validated_note_path(vault.path(), "link.md").is_err());
    }
}
