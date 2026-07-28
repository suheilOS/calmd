use super::{NotePreviewRead, PersistenceError, PersistenceResult};
use std::{
    ffi::OsStr,
    fs,
    io::{BufReader, Cursor, Read},
    path::Path,
};

#[derive(PartialEq)]
enum LineRead {
    LineEnd,
    EndOfFile,
    Limit,
}

pub(super) fn read(
    path: &Path,
    key: &str,
    character_limit: usize,
) -> PersistenceResult<NotePreviewRead> {
    let file = fs::File::open(path)
        .map_err(|error| PersistenceError::io("Could not read the note preview", error))?;
    let file_length = file
        .metadata()
        .map_err(|error| PersistenceError::io("Could not inspect the note preview", error))?
        .len();
    let fallback_title = Path::new(key)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("Untitled")
        .to_owned();
    let mut reader = BufReader::new(file);
    let mut scanned = String::new();
    let mut scan_characters_remaining = character_limit;
    let (title, body_start, body_prefix) = loop {
        let line_start = scanned.len();
        let line_read = read_utf8_line(&mut reader, &mut scanned, &mut scan_characters_remaining)?;
        if scanned.len() == line_start || line_read == LineRead::Limit {
            break (fallback_title, 0, scanned.into_bytes());
        }

        let line = &scanned[line_start..];
        let line = if line_start == 0 {
            line.strip_prefix('\u{feff}').unwrap_or(line)
        } else {
            line
        };
        let line_text = line.trim_end_matches(['\r', '\n']);
        if line_text.is_empty() {
            continue;
        }
        let Some(title) = line_text
            .strip_prefix("# ")
            .map(str::trim)
            .filter(|title| !title.is_empty())
        else {
            break (fallback_title, 0, scanned.into_bytes());
        };

        let heading_end = scanned.len();
        let mut prefix = Vec::new();
        let mut first = [0_u8; 1];
        let first_read = reader
            .read(&mut first)
            .map_err(|error| PersistenceError::io("Could not read the note preview", error))?;
        let separator_length = if first_read == 0 {
            0
        } else if first[0] == b'\n' {
            1
        } else if first[0] == b'\r' {
            let mut second = [0_u8; 1];
            let second_read = reader
                .read(&mut second)
                .map_err(|error| PersistenceError::io("Could not read the note preview", error))?;
            if second_read == 1 && second[0] == b'\n' {
                2
            } else {
                prefix.push(first[0]);
                if second_read == 1 {
                    prefix.push(second[0]);
                }
                0
            }
        } else {
            prefix.push(first[0]);
            0
        };
        break (title.to_owned(), heading_end + separator_length, prefix);
    };

    let mut body_reader = Cursor::new(body_prefix).chain(reader);
    let body = read_utf8_character_prefix(&mut body_reader, character_limit)?;
    let truncated = (body_start as u64).saturating_add(body.len() as u64) < file_length;
    Ok(NotePreviewRead {
        key: key.to_owned(),
        title,
        body,
        truncated,
    })
}

fn read_utf8_line(
    reader: &mut impl Read,
    result: &mut String,
    characters_remaining: &mut usize,
) -> PersistenceResult<LineRead> {
    while *characters_remaining > 0 {
        let Some(character) = read_utf8_character(reader)? else {
            return Ok(LineRead::EndOfFile);
        };
        *characters_remaining -= 1;
        result.push_str(&character);
        if character == "\n" {
            return Ok(LineRead::LineEnd);
        }
    }
    Ok(LineRead::Limit)
}

fn read_utf8_character_prefix(
    reader: &mut impl Read,
    character_limit: usize,
) -> PersistenceResult<String> {
    let mut result = String::new();
    for _ in 0..character_limit {
        let Some(character) = read_utf8_character(reader)? else {
            break;
        };
        result.push_str(&character);
    }
    Ok(result)
}

fn read_utf8_character(reader: &mut impl Read) -> PersistenceResult<Option<String>> {
    let mut bytes = [0_u8; 4];
    let bytes_read = reader
        .read(&mut bytes[..1])
        .map_err(|error| PersistenceError::io("Could not read the note preview", error))?;
    if bytes_read == 0 {
        return Ok(None);
    }
    let character_width = match bytes[0] {
        0x00..=0x7f => 1,
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => {
            return Err(PersistenceError::new(
                "io",
                "Could not read the note preview: the note is not valid UTF-8.",
            ));
        }
    };
    reader
        .read_exact(&mut bytes[1..character_width])
        .map_err(|error| PersistenceError::io("Could not read the note preview", error))?;
    std::str::from_utf8(&bytes[..character_width])
        .map(str::to_owned)
        .map(Some)
        .map_err(|error| PersistenceError::io("Could not read the note preview as UTF-8", error))
}
