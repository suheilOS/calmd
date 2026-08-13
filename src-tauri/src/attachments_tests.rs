use super::*;
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;
use tempfile::TempDir;

fn image_bytes(format: ImageFormat) -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::new_rgba8(3, 2)
        .write_to(&mut bytes, format)
        .unwrap();
    bytes.into_inner()
}

fn service_vault() -> (TempDir, String) {
    let directory = tempfile::tempdir().unwrap();
    let note = NotePersistence::new(directory.path())
        .create("Note")
        .unwrap();
    (directory, note.key)
}

#[test]
fn imports_supported_images_and_reports_metadata() {
    for (extension, format, mime) in [
        ("png", ImageFormat::Png, "image/png"),
        ("jpg", ImageFormat::Jpeg, "image/jpeg"),
        ("gif", ImageFormat::Gif, "image/gif"),
        ("webp", ImageFormat::WebP, "image/webp"),
    ] {
        let (vault, note_key) = service_vault();
        let imported = AttachmentService::new(vault.path())
            .import_bytes(
                &format!("photo.{extension}"),
                &image_bytes(format),
                &note_key,
            )
            .unwrap();
        assert_eq!(
            imported.relative_path,
            format!("attachments/photo.{extension}")
        );
        assert_eq!(imported.mime, mime);
        assert_eq!((imported.width, imported.height), (3, 2));
        assert!(vault.path().join(&imported.relative_path).is_file());
    }
}

#[test]
fn rejects_extension_signature_mismatch_and_unsupported_images() {
    let (vault, note_key) = service_vault();
    let service = AttachmentService::new(vault.path());
    assert_eq!(
        service
            .import_bytes("photo.jpg", &image_bytes(ImageFormat::Png), &note_key)
            .unwrap_err()
            .code,
        "format_mismatch",
    );
    assert_eq!(
        service
            .import_bytes("photo.svg", b"<svg/>", &note_key)
            .unwrap_err()
            .code,
        "unsupported",
    );
}

#[test]
fn enforces_compressed_size_limit_before_decoding() {
    let (vault, note_key) = service_vault();
    let oversized = vec![0; MAX_ATTACHMENT_BYTES as usize + 1];
    assert_eq!(
        AttachmentService::new(vault.path())
            .import_bytes("large.png", &oversized, &note_key)
            .unwrap_err()
            .code,
        "too_large",
    );
}

#[test]
fn sanitizes_portable_names_and_never_overwrites() {
    let (vault, note_key) = service_vault();
    let service = AttachmentService::new(vault.path());
    let bytes = image_bytes(ImageFormat::Png);
    let first = service.import_bytes("CON?.png", &bytes, &note_key).unwrap();
    let second = service.import_bytes("CON?.png", &bytes, &note_key).unwrap();
    assert_eq!(first.relative_path, "attachments/CON-.png");
    assert_eq!(second.relative_path, "attachments/CON- 2.png");
    assert_eq!(
        fs::read(vault.path().join(first.relative_path)).unwrap(),
        bytes
    );
}

#[test]
fn resolves_valid_images_anywhere_in_the_vault() {
    let (vault, note_key) = service_vault();
    let nested = vault.path().join("existing");
    fs::create_dir(&nested).unwrap();
    fs::write(nested.join("photo.png"), image_bytes(ImageFormat::Png)).unwrap();

    let resolved = AttachmentService::new(vault.path())
        .resolve(&note_key, "existing/photo.png")
        .unwrap();
    assert_eq!(resolved.relative_path, "existing/photo.png");
    assert_eq!((resolved.width, resolved.height), (3, 2));
    assert_eq!(resolved.revision.len(), 64);
    assert!(Path::new(&resolved.absolute_path).is_absolute());
}

#[test]
fn rejects_non_portable_and_outside_destinations() {
    let (vault, note_key) = service_vault();
    let service = AttachmentService::new(vault.path());
    for destination in [
        "/tmp/photo.png",
        "../photo.png",
        "folder/../photo.png",
        "folder\\photo.png",
        "https://example.com/photo.png",
        "photo.png?x=1",
        "photo.png#x",
    ] {
        assert_eq!(
            service.resolve(&note_key, destination).unwrap_err().code,
            "invalid_path"
        );
    }
}

#[cfg(unix)]
#[test]
fn rejects_symlinks() {
    use std::os::unix::fs::symlink;

    let (vault, note_key) = service_vault();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("photo.png");
    fs::write(&target, image_bytes(ImageFormat::Png)).unwrap();
    symlink(target, vault.path().join("photo.png")).unwrap();

    assert_eq!(
        AttachmentService::new(vault.path())
            .resolve(&note_key, "photo.png")
            .unwrap_err()
            .code,
        "invalid_file",
    );
}

#[test]
fn rejects_missing_notes_without_importing() {
    let vault = tempfile::tempdir().unwrap();
    let error = AttachmentService::new(vault.path())
        .import_bytes("photo.png", &image_bytes(ImageFormat::Png), "missing.md")
        .unwrap_err();
    assert_eq!(error.code, "io");
    assert!(!vault.path().join(ATTACHMENTS_DIRECTORY).exists());
}
