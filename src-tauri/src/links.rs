use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WikiLink {
    pub from: usize,
    pub to: usize,
    pub target: String,
    pub display: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub key: String,
    pub title: String,
}

pub fn normalize_key(key_or_stem: &str) -> String {
    format!("{}.md", key_stem(key_or_stem).to_lowercase())
}

pub fn key_stem(key: &str) -> &str {
    if key
        .get(key.len().saturating_sub(3)..)
        .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".md"))
    {
        &key[..key.len() - 3]
    } else {
        key
    }
}

pub fn canonical_link(target: &str, display: Option<&str>) -> String {
    match display.filter(|display| *display != target) {
        Some(display) => format!("[[{target}|{display}]]"),
        None => format!("[[{target}]]"),
    }
}

pub fn extract_links(markdown: &str) -> Vec<WikiLink> {
    let mut links = Vec::new();
    let mut offset = 0;
    let mut fenced: Option<(char, usize)> = None;
    let mut code_ticks = 0;
    for line_with_end in markdown.split_inclusive('\n') {
        let line = line_with_end.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        let marker_char = trimmed.as_bytes().first().copied().map(char::from);
        let marker_len = marker_char
            .map(|ch| trimmed.chars().take_while(|c| *c == ch).count())
            .unwrap_or(0);
        if let Some((ch, count)) = fenced {
            if marker_char == Some(ch) && marker_len >= count {
                fenced = None;
            }
            offset += line_with_end.len();
            continue;
        }
        if code_ticks == 0
            && indent <= 3
            && matches!(marker_char, Some('`' | '~'))
            && marker_len >= 3
        {
            fenced = Some((marker_char.unwrap(), marker_len));
            offset += line_with_end.len();
            continue;
        }
        if code_ticks == 0 && (line.starts_with("    ") || line.starts_with('\t')) {
            offset += line_with_end.len();
            continue;
        }
        if line.trim().is_empty() {
            code_ticks = 0;
        } else {
            parse_inline(line, offset, &mut code_ticks, &mut links);
        }
        offset += line_with_end.len();
    }
    links
}

fn parse_inline(line: &str, base: usize, code_ticks: &mut usize, links: &mut Vec<WikiLink>) {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'`' {
            let count = bytes[index..]
                .iter()
                .take_while(|byte| **byte == b'`')
                .count();
            if *code_ticks == 0 {
                *code_ticks = count;
            } else if *code_ticks == count {
                *code_ticks = 0;
            }
            index += count;
            continue;
        }
        if *code_ticks == 0
            && bytes[index..].starts_with(b"[[")
            && (index == 0 || bytes[index - 1] != b'!')
        {
            if let Some(relative_end) = line[index + 2..].find("]]") {
                let end = index + 2 + relative_end;
                let inner = &line[index + 2..end];
                if let Some((target, display)) = parse_inner(inner) {
                    links.push(WikiLink {
                        from: base + index,
                        to: base + end + 2,
                        target: target.to_owned(),
                        display: display.map(str::to_owned),
                    });
                }
                index = end + 2;
                continue;
            }
        }
        index += 1;
    }
}

fn parse_inner(inner: &str) -> Option<(&str, Option<&str>)> {
    if inner.is_empty()
        || inner.contains("[[")
        || inner.contains("]]")
        || inner.contains(['\r', '\n', '/', '\\', '#', '^'])
    {
        return None;
    }
    let mut parts = inner.split('|');
    let target = parts.next()?.trim();
    let display = parts.next().map(str::trim);
    if target.is_empty() || display == Some("") || parts.next().is_some() {
        return None;
    }
    let target = target.strip_suffix(".md").unwrap_or(target);
    (!target.is_empty()).then_some((target, display))
}

pub fn rewrite_target(
    markdown: &str,
    old_stem: &str,
    new_stem: &str,
    old_title: &str,
    new_title: &str,
) -> String {
    let links = extract_links(markdown);
    let mut output = markdown.to_owned();
    for link in links
        .into_iter()
        .rev()
        .filter(|link| normalize_key(&link.target) == normalize_key(old_stem))
    {
        let display = match link.display.as_deref() {
            Some(value) if value == old_title => Some(new_title),
            other => other,
        };
        let replacement = canonical_link(new_stem, display);
        output.replace_range(link.from..link.to, &replacement);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_supported_links_and_ignores_code_and_invalid_forms() {
        let body = "[[One]] [[Two.md|Alias]] `[[Inline]]`\n```\n[[Fence]]\n```\n    [[Indent]]\n![[Embed]] [[path/note]] [[A#head]]";
        let links = extract_links(body);
        assert_eq!(
            links
                .iter()
                .map(|link| (&*link.target, link.display.as_deref()))
                .collect::<Vec<_>>(),
            vec![("One", None), ("Two", Some("Alias"))]
        );
    }

    #[test]
    fn ignores_links_inside_multiline_code_spans() {
        let body = "Before [[One]] `code\n[[Hidden]]\nmore code` [[Two]]";
        let links = extract_links(body);
        assert_eq!(
            links
                .iter()
                .map(|link| link.target.as_str())
                .collect::<Vec<_>>(),
            vec!["One", "Two"]
        );
    }

    #[test]
    fn whitespace_only_lines_end_multiline_code_spans() {
        let links = extract_links("`code\n \t \n[[Visible]]");
        assert_eq!(
            links
                .iter()
                .map(|link| link.target.as_str())
                .collect::<Vec<_>>(),
            vec!["Visible"]
        );
    }

    #[test]
    fn rewrites_targets_and_preserves_custom_aliases() {
        assert_eq!(
            rewrite_target(
                "[[Old]] [[Old|Old]] [[Old|History]]",
                "Old",
                "New",
                "Old",
                "New title"
            ),
            "[[New]] [[New|New title]] [[New|History]]"
        );
    }
}
