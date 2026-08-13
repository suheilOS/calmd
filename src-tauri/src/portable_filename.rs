pub fn portable_stem(
    value: &str,
    fallback: &str,
    reserved_suffix: &str,
    max_bytes: usize,
) -> String {
    let mut stem = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    stem = stem.trim_end_matches([' ', '.']).to_owned();
    if stem.is_empty() {
        stem = fallback.to_owned();
    }

    let device_name = stem
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches([' ', '.']);
    if is_windows_reserved_name(device_name) {
        stem = match stem.split_once('.') {
            Some((device, rest)) => format!("{device}{reserved_suffix}.{rest}"),
            None => format!("{stem}{reserved_suffix}"),
        };
    }
    truncate_utf8(&stem, max_bytes).to_owned()
}

pub fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &value[..boundary]
}

fn is_windows_reserved_name(value: &str) -> bool {
    let name = value.trim_end_matches([' ', '.']).to_ascii_uppercase();
    matches!(name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || name
            .strip_prefix("COM")
            .is_some_and(is_reserved_device_number)
        || name
            .strip_prefix("LPT")
            .is_some_and(is_reserved_device_number)
}

fn is_reserved_device_number(value: &str) -> bool {
    matches!(value, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
}
