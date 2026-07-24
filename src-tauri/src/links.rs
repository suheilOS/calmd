use pulldown_cmark::{Event, Parser, Tag};
use serde::Serialize;
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WikiLink {
    pub from: usize,
    pub to: usize,
    pub target: String,
    pub display: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteReference {
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
    let code_ranges = markdown_code_ranges(markdown);
    let mut links = Vec::new();
    let mut offset = 0;
    for line_with_end in markdown.split_inclusive('\n') {
        let line = line_with_end.trim_end_matches(['\r', '\n']);
        parse_inline(line, offset, &code_ranges, &mut links);
        offset += line_with_end.len();
    }
    links
}

fn markdown_code_ranges(markdown: &str) -> Vec<Range<usize>> {
    Parser::new(markdown)
        .into_offset_iter()
        .filter_map(|(event, range)| match event {
            Event::Code(_) | Event::Start(Tag::CodeBlock(_)) => Some(range),
            _ => None,
        })
        .collect()
}

fn parse_inline(line: &str, base: usize, code_ranges: &[Range<usize>], links: &mut Vec<WikiLink>) {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index..].starts_with(b"[[") && (index == 0 || bytes[index - 1] != b'!') {
            if let Some(relative_end) = line[index + 2..].find("]]") {
                let end = index + 2 + relative_end;
                let start = base + index;
                let finish = base + end + 2;
                if !code_ranges
                    .iter()
                    .any(|range| range.start < finish && start < range.end)
                {
                    let inner = &line[index + 2..end];
                    if let Some((target, display)) = parse_inner(inner) {
                        links.push(WikiLink {
                            from: start,
                            to: finish,
                            target: target.to_owned(),
                            display: display.map(str::to_owned),
                        });
                    }
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
    fn follows_commonmark_code_span_boundaries() {
        let links = extract_links(
            r"\` [[Escaped]]
- `unfinished
- [[List item]]
> `unfinished
>
> [[Quote paragraph]]",
        );
        assert_eq!(
            links
                .iter()
                .map(|link| link.target.as_str())
                .collect::<Vec<_>>(),
            vec!["Escaped", "List item", "Quote paragraph"]
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
