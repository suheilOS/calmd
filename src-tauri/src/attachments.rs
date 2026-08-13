use crate::{
    note_persistence::NotePersistence,
    portable_filename::{portable_stem, truncate_utf8},
    storage::VaultState,
};
use image::{ImageFormat, ImageReader};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{
    AppHandle, Manager, State,
    ipc::{InvokeBody, Request},
};
use tauri_plugin_dialog::{DialogExt, FilePath};

pub const MAX_ATTACHMENT_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_ATTACHMENT_PIXELS: u64 = 40_000_000;
const ATTACHMENTS_DIRECTORY: &str = "attachments";
const MAX_FILENAME_BYTES: usize = 180;
static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
pub struct AttachmentError {
    code: &'static str,
    message: String,
}

impl AttachmentError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn io(context: &str, error: impl std::fmt::Display) -> Self {
        Self::new("io", format!("{context}: {error}"))
    }
}

type AttachmentResult<T> = Result<T, AttachmentError>;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedImage {
    relative_path: String,
    absolute_path: String,
    mime: &'static str,
    width: u32,
    height: u32,
    revision: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAttachment {
    relative_path: String,
    mime: &'static str,
    width: u32,
    height: u32,
    revision: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SupportedFormat {
    Gif,
    Jpeg,
    Png,
    WebP,
}

impl SupportedFormat {
    fn from_image_format(format: ImageFormat) -> AttachmentResult<Self> {
        match format {
            ImageFormat::Gif => Ok(Self::Gif),
            ImageFormat::Jpeg => Ok(Self::Jpeg),
            ImageFormat::Png => Ok(Self::Png),
            ImageFormat::WebP => Ok(Self::WebP),
            _ => Err(AttachmentError::new(
                "unsupported",
                "Choose a PNG, JPEG, GIF, or WebP image.",
            )),
        }
    }

    fn from_extension(extension: &OsStr) -> AttachmentResult<Self> {
        match extension.to_str().map(str::to_ascii_lowercase).as_deref() {
            Some("gif") => Ok(Self::Gif),
            Some("jpeg" | "jpg") => Ok(Self::Jpeg),
            Some("png") => Ok(Self::Png),
            Some("webp") => Ok(Self::WebP),
            _ => Err(AttachmentError::new(
                "unsupported",
                "Choose a PNG, JPEG, GIF, or WebP image.",
            )),
        }
    }

    fn mime(self) -> &'static str {
        match self {
            Self::Gif => "image/gif",
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::WebP => "image/webp",
        }
    }
}

struct ValidatedImage {
    format: SupportedFormat,
    width: u32,
    height: u32,
    revision: String,
}

pub struct AttachmentService<'a> {
    root: &'a Path,
}

impl<'a> AttachmentService<'a> {
    pub fn new(root: &'a Path) -> Self {
        Self { root }
    }

    pub fn import_file(
        &self,
        source: &Path,
        note_key: &str,
    ) -> AttachmentResult<ImportedAttachment> {
        self.require_note(note_key)?;
        let metadata = fs::symlink_metadata(source)
            .map_err(|error| AttachmentError::io("Could not inspect the image", error))?;
        if !metadata.file_type().is_file() {
            return Err(AttachmentError::new(
                "invalid_file",
                "The selected image is not a regular file.",
            ));
        }
        if metadata.len() > MAX_ATTACHMENT_BYTES {
            return Err(AttachmentError::new(
                "too_large",
                "The image is larger than 10 MiB.",
            ));
        }
        let bytes = fs::read(source)
            .map_err(|error| AttachmentError::io("Could not read the image", error))?;
        let filename = source.file_name().and_then(OsStr::to_str).ok_or_else(|| {
            AttachmentError::new("filename", "The image filename is not portable.")
        })?;
        self.import_validated(filename, &bytes)
    }

    pub fn import_bytes(
        &self,
        filename: &str,
        bytes: &[u8],
        note_key: &str,
    ) -> AttachmentResult<ImportedAttachment> {
        self.require_note(note_key)?;
        self.import_validated(filename, bytes)
    }

    pub fn resolve(&self, note_key: &str, destination: &str) -> AttachmentResult<ResolvedImage> {
        self.require_note(note_key)?;
        let relative = validate_relative_destination(destination)?;
        let candidate = self.root.join(&relative);
        let metadata = fs::symlink_metadata(&candidate)
            .map_err(|error| AttachmentError::io("Could not inspect the image", error))?;
        if !metadata.file_type().is_file() {
            return Err(AttachmentError::new(
                "invalid_file",
                "The image is not a regular file.",
            ));
        }
        if metadata.len() > MAX_ATTACHMENT_BYTES {
            return Err(AttachmentError::new(
                "too_large",
                "The image is larger than 10 MiB.",
            ));
        }
        let canonical = candidate
            .canonicalize()
            .map_err(|error| AttachmentError::io("Could not resolve the image", error))?;
        if !canonical.starts_with(self.root) {
            return Err(AttachmentError::new(
                "outside_vault",
                "The image must stay inside the vault.",
            ));
        }
        let bytes = fs::read(&canonical)
            .map_err(|error| AttachmentError::io("Could not read the image", error))?;
        let validated = validate_image(&bytes, &canonical, false)?;
        Ok(ResolvedImage {
            relative_path: path_to_markdown(&relative)?,
            absolute_path: canonical.to_string_lossy().into_owned(),
            mime: validated.format.mime(),
            width: validated.width,
            height: validated.height,
            revision: validated.revision,
        })
    }

    fn require_note(&self, note_key: &str) -> AttachmentResult<()> {
        NotePersistence::new(self.root)
            .read(note_key)
            .map(|_| ())
            .map_err(|error| AttachmentError::new(error.code, error.message))
    }

    fn import_validated(
        &self,
        filename: &str,
        bytes: &[u8],
    ) -> AttachmentResult<ImportedAttachment> {
        if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
            return Err(AttachmentError::new(
                "too_large",
                "The image is larger than 10 MiB.",
            ));
        }
        let source_path = Path::new(filename);
        let validated = validate_image(bytes, source_path, true)?;
        let extension = source_path
            .extension()
            .and_then(OsStr::to_str)
            .ok_or_else(|| {
                AttachmentError::new("unsupported", "The image needs a supported extension.")
            })?;
        let stem = source_path
            .file_stem()
            .and_then(OsStr::to_str)
            .unwrap_or("image");
        let directory = self.root.join(ATTACHMENTS_DIRECTORY);
        fs::create_dir_all(&directory).map_err(|error| {
            AttachmentError::io("Could not create the attachments directory", error)
        })?;
        let filename = install_available(&directory, stem, extension, bytes)?;
        Ok(ImportedAttachment {
            relative_path: format!("{ATTACHMENTS_DIRECTORY}/{filename}"),
            mime: validated.format.mime(),
            width: validated.width,
            height: validated.height,
            revision: validated.revision,
        })
    }
}

#[tauri::command]
pub fn pick_attachment(
    note_key: String,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> AttachmentResult<Option<ImportedAttachment>> {
    let root = state
        .root()
        .map_err(|message| AttachmentError::new("vault", message))?;
    let service = AttachmentService::new(&root);
    service.require_note(&note_key)?;
    let selection = app
        .dialog()
        .file()
        .set_title("Insert image")
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"])
        .blocking_pick_file();
    let Some(FilePath::Path(source)) = selection else {
        return Ok(None);
    };
    service.import_file(&source, &note_key).map(Some)
}

#[tauri::command]
pub fn import_attachment_bytes(
    request: Request<'_>,
    state: State<'_, VaultState>,
) -> AttachmentResult<ImportedAttachment> {
    let filename = request_header(&request, "x-calmd-filename")?;
    let note_key = request_header(&request, "x-calmd-note-key")?;
    let bytes = request_bytes(&request)?;
    let root = state
        .root()
        .map_err(|message| AttachmentError::new("vault", message))?;
    AttachmentService::new(&root).import_bytes(&filename, &bytes, &note_key)
}

fn request_header(request: &Request<'_>, name: &str) -> AttachmentResult<String> {
    let encoded = request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            AttachmentError::new("invalid_request", "The image import metadata is missing.")
        })?;
    url::form_urlencoded::parse(format!("value={encoded}").as_bytes())
        .next()
        .map(|(_, value)| value.into_owned())
        .ok_or_else(|| {
            AttachmentError::new("invalid_request", "The image import metadata is invalid.")
        })
}

fn request_bytes(request: &Request<'_>) -> AttachmentResult<Vec<u8>> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(value) => value
            .as_array()
            .ok_or_else(|| {
                AttachmentError::new("invalid_request", "The image import body is invalid.")
            })?
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|byte| u8::try_from(byte).ok())
                    .ok_or_else(|| {
                        AttachmentError::new("invalid_request", "The image import body is invalid.")
                    })
            })
            .collect(),
    }
}

#[tauri::command]
pub fn resolve_image(
    note_key: String,
    destination: String,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> AttachmentResult<ResolvedImage> {
    let root = state
        .root()
        .map_err(|message| AttachmentError::new("vault", message))?;
    let resolved = AttachmentService::new(&root).resolve(&note_key, &destination)?;
    app.asset_protocol_scope()
        .allow_file(&resolved.absolute_path)
        .map_err(|error| AttachmentError::io("Could not authorize the image", error))?;
    Ok(resolved)
}

fn validate_image(
    bytes: &[u8],
    path: &Path,
    decode_completely: bool,
) -> AttachmentResult<ValidatedImage> {
    let extension = path.extension().ok_or_else(|| {
        AttachmentError::new("unsupported", "The image needs a supported extension.")
    })?;
    let extension_format = SupportedFormat::from_extension(extension)?;
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| AttachmentError::io("Could not inspect the image format", error))?;
    let detected = reader.format().ok_or_else(|| {
        AttachmentError::new("corrupt", "The image format could not be recognized.")
    })?;
    let detected_format = SupportedFormat::from_image_format(detected)?;
    if detected_format != extension_format {
        return Err(AttachmentError::new(
            "format_mismatch",
            "The image content does not match its filename extension.",
        ));
    }
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| AttachmentError::new("corrupt", "The image could not be decoded."))?;
    if u64::from(width) * u64::from(height) > MAX_ATTACHMENT_PIXELS {
        return Err(AttachmentError::new(
            "too_many_pixels",
            "The image dimensions are too large.",
        ));
    }
    if decode_completely {
        ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|_| AttachmentError::new("corrupt", "The image could not be decoded."))?
            .decode()
            .map_err(|_| AttachmentError::new("corrupt", "The image could not be decoded."))?;
    }
    Ok(ValidatedImage {
        format: detected_format,
        width,
        height,
        revision: format!("{:x}", Sha256::digest(bytes)),
    })
}

fn validate_relative_destination(destination: &str) -> AttachmentResult<PathBuf> {
    if destination.is_empty()
        || destination.contains(['\\', '?', '#'])
        || destination.contains("://")
    {
        return Err(AttachmentError::new(
            "invalid_path",
            "The image destination must be a portable vault-relative path.",
        ));
    }
    let path = Path::new(destination);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AttachmentError::new(
            "invalid_path",
            "The image destination must be a portable vault-relative path.",
        ));
    }
    Ok(path.to_owned())
}

fn install_available(
    directory: &Path,
    raw_stem: &str,
    extension: &str,
    bytes: &[u8],
) -> AttachmentResult<String> {
    let extension = extension.to_ascii_lowercase();
    let max_stem_bytes = MAX_FILENAME_BYTES.saturating_sub(extension.len() + 1);
    let base = portable_stem(raw_stem, "image", " image", max_stem_bytes);
    let existing = fs::read_dir(directory)
        .map_err(|error| AttachmentError::io("Could not inspect attachment filenames", error))?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_lowercase))
        .collect::<HashSet<_>>();
    let temporary = directory.join(format!(
        ".calmd-attachment-{}-{}.tmp",
        std::process::id(),
        NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed),
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| AttachmentError::io("Could not prepare the image import", error))?;
        file.write_all(bytes)
            .map_err(|error| AttachmentError::io("Could not write the image", error))?;
        file.sync_all()
            .map_err(|error| AttachmentError::io("Could not flush the image", error))?;

        for number in 1.. {
            let suffix = if number == 1 {
                String::new()
            } else {
                format!(" {number}")
            };
            let stem = truncate_utf8(&base, max_stem_bytes.saturating_sub(suffix.len()));
            let filename = format!("{stem}{suffix}.{extension}");
            if existing.contains(&filename.to_lowercase()) {
                continue;
            }
            match fs::hard_link(&temporary, directory.join(&filename)) {
                Ok(()) => {
                    File::open(directory)
                        .and_then(|directory| directory.sync_all())
                        .map_err(|error| {
                            AttachmentError::io("Could not flush the attachments directory", error)
                        })?;
                    return Ok(filename);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(AttachmentError::io("Could not install the image", error));
                }
            }
        }
        unreachable!()
    })();
    let _ = fs::remove_file(temporary);
    result
}

fn path_to_markdown(path: &Path) -> AttachmentResult<String> {
    path.components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str().map(str::to_owned).ok_or_else(|| {
                AttachmentError::new("invalid_path", "The image path is not valid Unicode.")
            }),
            _ => Err(AttachmentError::new(
                "invalid_path",
                "The image path is not portable.",
            )),
        })
        .collect::<AttachmentResult<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

#[cfg(test)]
#[path = "attachments_tests.rs"]
mod tests;
