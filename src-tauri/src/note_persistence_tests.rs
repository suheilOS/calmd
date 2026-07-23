use super::*;
use tempfile::tempdir;

fn persistence(root: &Path) -> NotePersistence<'_> {
    NotePersistence::new(root)
}

#[test]
fn reads_canonical_and_external_markdown_through_the_interface() {
    let vault = tempdir().unwrap();
    fs::write(
        vault.path().join("Canonical.md"),
        "\u{feff}# عنوان عربي\r\n\r\nالمحتوى",
    )
    .unwrap();
    fs::write(
        vault.path().join("External.md"),
        "Preface\n# Later title\nBody",
    )
    .unwrap();

    let canonical = persistence(vault.path()).read("Canonical.md").unwrap();
    assert_eq!(canonical.title, "عنوان عربي");
    assert_eq!(canonical.body, "المحتوى");

    let external = persistence(vault.path()).read("External.md").unwrap();
    assert_eq!(external.title, "External");
    assert_eq!(external.body, "Preface\n# Later title\nBody");
}

#[test]
fn derives_portable_filenames_without_changing_titles() {
    let vault = tempdir().unwrap();
    let store = persistence(vault.path());

    let punctuation = store.create("A/B: C?").unwrap();
    let reserved = store.create("CON").unwrap();
    let unicode = store.create("عنوان عربي").unwrap();

    assert_eq!(punctuation.key, "A-B- C-.md");
    assert_eq!(punctuation.title, "A/B: C?");
    assert_eq!(reserved.key, "CON note.md");
    assert_eq!(reserved.title, "CON");
    assert_eq!(unicode.key, "عنوان عربي.md");
}

#[test]
fn handles_case_insensitive_filename_collisions() {
    let vault = tempdir().unwrap();
    fs::write(vault.path().join("Purification.md"), "existing").unwrap();

    let note = persistence(vault.path()).create("purification").unwrap();

    assert_eq!(note.key, "purification (2).md");
}

#[test]
fn creates_saves_renames_and_detects_conflicts() {
    let vault = tempdir().unwrap();
    let store = persistence(vault.path());
    let created = store.create("Purification").unwrap();
    let saved = store
        .save(
            &created.key,
            &created.title,
            "Complete body",
            &created.revision,
        )
        .unwrap();

    fs::write(
        vault.path().join(&saved.key),
        "# Purification\n\nExternal edit",
    )
    .unwrap();
    let conflict = store
        .save(&saved.key, &saved.title, "Calmd edit", &saved.revision)
        .unwrap_err();
    assert_eq!(conflict.code, "conflict");

    let reopened = store.read(&saved.key).unwrap();
    let renamed = store
        .rename(&reopened.key, "تنقية", &reopened.body, &reopened.revision)
        .unwrap();
    assert_eq!(renamed.key, "تنقية.md");
    assert!(!vault.path().join("Purification.md").exists());
}

#[test]
fn find_or_create_returns_an_exact_title_without_a_duplicate() {
    let vault = tempdir().unwrap();
    let store = persistence(vault.path());
    let original = store.create("Quiet Thought").unwrap();

    let reopened = store.find_or_create("  quiet   thought  ").unwrap();

    assert_eq!(reopened.key, original.key);
    assert_eq!(store.scan().unwrap().len(), 1);
}

#[test]
fn rename_uses_a_collision_suffix_without_overwriting() {
    let vault = tempdir().unwrap();
    let store = persistence(vault.path());
    let note = store.create("First").unwrap();
    fs::write(vault.path().join("Taken.md"), "unrelated").unwrap();

    let renamed = store
        .rename(&note.key, "Taken", "updated", &note.revision)
        .unwrap();

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
    let store = persistence(vault.path());
    let note = store.create("Case").unwrap();

    let renamed = store
        .rename(&note.key, "case", &note.body, &note.revision)
        .unwrap();

    assert_eq!(renamed.key, "case.md");
    assert_eq!(renamed.title, "case");
    assert_no_temporary_files(vault.path());
}

#[test]
fn rename_conflict_leaves_the_original_unchanged() {
    let vault = tempdir().unwrap();
    let store = persistence(vault.path());
    let note = store.create("Original").unwrap();
    let original_path = vault.path().join(&note.key);
    fs::write(&original_path, "# Original\n\nExternal edit").unwrap();

    let error = store
        .rename(&note.key, "Renamed", "Calmd edit", &note.revision)
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
    let store = persistence(vault.path());
    let note = store.create("Original").unwrap();
    let original_path = vault.path().join(&note.key);
    let original_content = fs::read_to_string(&original_path).unwrap();

    let error = store
        .rename_with(&note.key, "Renamed", "updated", &note.revision, |_, _| {
            Err(std::io::Error::other("injected destination failure"))
        })
        .unwrap_err();

    assert_eq!(error.code, "io");
    assert_eq!(fs::read_to_string(original_path).unwrap(), original_content);
    assert!(!vault.path().join("Renamed.md").exists());
    assert_no_temporary_files(vault.path());
}

#[test]
fn scan_rejects_traversal_and_ignores_symlinks() {
    let vault = tempdir().unwrap();
    assert!(persistence(vault.path()).read("../outside.md").is_err());

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        fs::write(vault.path().join("real.md"), "# Real\n\n").unwrap();
        symlink(vault.path().join("real.md"), vault.path().join("link.md")).unwrap();
        assert!(persistence(vault.path()).read("link.md").is_err());
        assert_eq!(persistence(vault.path()).scan().unwrap().len(), 1);
    }
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
