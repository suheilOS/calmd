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
fn coordinated_rename_updates_incoming_custom_and_self_links() {
    let vault = tempdir().unwrap();
    let store = persistence(vault.path());
    let target = store.create("Old").unwrap();
    let target = store
        .save(&target.key, &target.title, "Self [[Old]]", &target.revision)
        .unwrap();
    let source = store.create("Source").unwrap();
    store
        .save(
            &source.key,
            &source.title,
            "[[Old]] [[Old|Old]] [[Old|History]]",
            &source.revision,
        )
        .unwrap();

    let renamed = store
        .rename_with_links(&target.key, "New title", &target.body, &target.revision)
        .unwrap();

    assert_eq!(renamed.key, "New title.md");
    assert_eq!(renamed.body, "Self [[New title]]");
    assert_eq!(
        store.read("Source.md").unwrap().body,
        "[[New title]] [[New title]] [[New title|History]]"
    );
    assert!(!vault.path().join(OPERATION_JOURNAL).exists());
}

#[test]
fn title_only_rename_updates_matching_aliases_without_changing_the_key() {
    let vault = tempdir().unwrap();
    let store = persistence(vault.path());
    let target = store.create("A:B").unwrap();
    let source = store.create("Source").unwrap();
    store
        .save(
            &source.key,
            &source.title,
            "[[A-B|A:B]] [[A-B|Custom]]",
            &source.revision,
        )
        .unwrap();

    let renamed = store
        .rename_with_links(&target.key, "A?B", &target.body, &target.revision)
        .unwrap();

    assert_eq!(renamed.key, "A-B.md");
    assert_eq!(renamed.title, "A?B");
    assert_eq!(
        store.read("Source.md").unwrap().body,
        "[[A-B|A?B]] [[A-B|Custom]]"
    );
}

#[test]
fn ambiguous_links_are_not_reassigned_during_rename() {
    let vault = tempdir().unwrap();
    fs::write(vault.path().join("Foo.md"), "# Foo\n\n").unwrap();
    fs::write(vault.path().join("foo.MD"), "# Other foo\n\n").unwrap();
    fs::write(vault.path().join("Source.md"), "# Source\n\n[[Foo]]").unwrap();
    let store = persistence(vault.path());
    let target = store.read("Foo.md").unwrap();

    store
        .rename_with_links(&target.key, "Bar", &target.body, &target.revision)
        .unwrap();

    assert_eq!(store.read("Source.md").unwrap().body, "[[Foo]]");
}

#[test]
fn precommit_recovery_removes_an_installed_hard_link_before_restoring() {
    let vault = tempdir().unwrap();
    let root = vault.path();
    fs::write(root.join("staged.tmp"), "replacement").unwrap();
    fs::write(root.join("backup.tmp"), "original").unwrap();
    fs::hard_link(root.join("staged.tmp"), root.join("New.md")).unwrap();
    fs::write(
        root.join(OPERATION_JOURNAL),
        r#"{"committed":false,"files":[{"original":"Old.md","destination":"New.md","staged":".calmd-stage-1-1.tmp","backup":".calmd-journal-backup-1-2.tmp","installed":false}]}"#,
    )
    .unwrap();
    fs::rename(root.join("staged.tmp"), root.join(".calmd-stage-1-1.tmp")).unwrap();
    fs::rename(
        root.join("backup.tmp"),
        root.join(".calmd-journal-backup-1-2.tmp"),
    )
    .unwrap();

    recover_operation(root).unwrap();

    assert_eq!(fs::read_to_string(root.join("Old.md")).unwrap(), "original");
    assert!(!root.join("New.md").exists());
    assert_no_temporary_files(root);
}

#[test]
fn precommit_recovery_preserves_an_unrelated_destination() {
    let vault = tempdir().unwrap();
    let root = vault.path();
    let staged = ".calmd-stage-1-1.tmp";
    let backup = ".calmd-journal-backup-1-2.tmp";
    fs::write(root.join(staged), "replacement").unwrap();
    fs::write(root.join(backup), "original").unwrap();
    fs::write(root.join("New.md"), "external").unwrap();
    write_journal(
        root,
        &Journal {
            committed: false,
            files: vec![JournalFile {
                original: "Old.md".to_owned(),
                destination: "New.md".to_owned(),
                staged: staged.to_owned(),
                backup: backup.to_owned(),
                installed: false,
            }],
        },
    )
    .unwrap();

    recover_operation(root).unwrap();

    assert_eq!(fs::read_to_string(root.join("Old.md")).unwrap(), "original");
    assert_eq!(fs::read_to_string(root.join("New.md")).unwrap(), "external");
}

#[test]
fn recovery_handles_every_coordinated_install_checkpoint() {
    #[derive(Clone, Copy)]
    enum Checkpoint {
        Journaled,
        BackedUp,
        OriginalsRemoved,
        DestinationLinked,
        InstallationRecorded,
        StagedRemoved,
        Committed,
    }

    for (index, checkpoint) in [
        Checkpoint::Journaled,
        Checkpoint::BackedUp,
        Checkpoint::OriginalsRemoved,
        Checkpoint::DestinationLinked,
        Checkpoint::InstallationRecorded,
        Checkpoint::StagedRemoved,
        Checkpoint::Committed,
    ]
    .into_iter()
    .enumerate()
    {
        let vault = tempdir().unwrap();
        let root = vault.path();
        let staged = format!(".calmd-stage-{index}-1.tmp");
        let backup = format!(".calmd-journal-backup-{index}-2.tmp");
        fs::write(root.join("Old.md"), "original").unwrap();
        fs::write(root.join(&staged), "replacement").unwrap();
        let backed_up = !matches!(checkpoint, Checkpoint::Journaled);
        let originals_removed = matches!(
            checkpoint,
            Checkpoint::OriginalsRemoved
                | Checkpoint::DestinationLinked
                | Checkpoint::InstallationRecorded
                | Checkpoint::StagedRemoved
                | Checkpoint::Committed
        );
        let destination_linked = matches!(
            checkpoint,
            Checkpoint::DestinationLinked
                | Checkpoint::InstallationRecorded
                | Checkpoint::StagedRemoved
                | Checkpoint::Committed
        );
        let installed = matches!(
            checkpoint,
            Checkpoint::InstallationRecorded | Checkpoint::StagedRemoved | Checkpoint::Committed
        );
        let staged_removed = matches!(
            checkpoint,
            Checkpoint::StagedRemoved | Checkpoint::Committed
        );
        let committed = matches!(checkpoint, Checkpoint::Committed);

        if backed_up {
            fs::hard_link(root.join("Old.md"), root.join(&backup)).unwrap();
        }
        if originals_removed {
            fs::remove_file(root.join("Old.md")).unwrap();
        }
        if destination_linked {
            fs::hard_link(root.join(&staged), root.join("New.md")).unwrap();
        }
        if staged_removed {
            fs::remove_file(root.join(&staged)).unwrap();
        }
        write_journal(
            root,
            &Journal {
                committed,
                files: vec![JournalFile {
                    original: "Old.md".to_owned(),
                    destination: "New.md".to_owned(),
                    staged: staged.clone(),
                    backup: backup.clone(),
                    installed,
                }],
            },
        )
        .unwrap();

        recover_operation(root).unwrap();

        if committed {
            assert!(!root.join("Old.md").exists());
            assert_eq!(
                fs::read_to_string(root.join("New.md")).unwrap(),
                "replacement"
            );
        } else {
            assert_eq!(fs::read_to_string(root.join("Old.md")).unwrap(), "original");
            assert!(!root.join("New.md").exists());
        }
        assert_no_temporary_files(root);
    }
}

#[test]
fn journal_phase_updates_replace_complete_json_atomically() {
    let vault = tempdir().unwrap();
    let mut journal = Journal {
        committed: false,
        files: vec![JournalFile {
            original: "Old.md".to_owned(),
            destination: "New.md".to_owned(),
            staged: ".calmd-stage-1-1.tmp".to_owned(),
            backup: ".calmd-journal-backup-1-2.tmp".to_owned(),
            installed: false,
        }],
    };
    write_journal(vault.path(), &journal).unwrap();
    assert!(!read_journal(vault.path()).unwrap().committed);

    journal.files[0].installed = true;
    journal.committed = true;
    write_journal(vault.path(), &journal).unwrap();

    let persisted = read_journal(vault.path()).unwrap();
    assert!(persisted.committed);
    assert!(persisted.files[0].installed);
}

#[test]
fn recovery_rejects_paths_outside_the_vault() {
    let parent = tempdir().unwrap();
    let vault = parent.path().join("vault");
    fs::create_dir(&vault).unwrap();
    let outside = parent.path().join("outside.md");
    fs::write(&outside, "intact").unwrap();
    fs::write(
        vault.join(OPERATION_JOURNAL),
        r#"{"committed":false,"files":[{"original":"../outside.md","destination":"Safe.md","staged":".calmd-stage-1-1.tmp","backup":".calmd-journal-backup-1-2.tmp"}]}"#,
    ).unwrap();

    let error = recover_operation(&vault).unwrap_err();

    assert_eq!(error.code, "recovery");
    assert_eq!(fs::read_to_string(outside).unwrap(), "intact");
}

#[test]
fn coordinated_install_refuses_a_destination_created_after_allocation() {
    let vault = tempdir().unwrap();
    fs::write(vault.path().join("Old.md"), "old").unwrap();
    fs::write(vault.path().join("New.md"), "external").unwrap();
    let change = PendingChange {
        original: "Old.md".to_owned(),
        destination: "New.md".to_owned(),
        content: "replacement".to_owned(),
        revision: revision(b"old"),
    };

    let error = install_coordinated(vault.path(), &[change]).unwrap_err();

    assert_eq!(error.code, "collision");
    assert_eq!(
        fs::read_to_string(vault.path().join("New.md")).unwrap(),
        "external"
    );
    assert_eq!(
        fs::read_to_string(vault.path().join("Old.md")).unwrap(),
        "old"
    );
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
