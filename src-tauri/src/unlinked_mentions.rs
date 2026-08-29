use crate::{
    links::non_prose_ranges,
    text_normalization::{find_folded_literal, is_ignored_arabic_mark},
};
use serde::Serialize;
use std::ops::Range;

const MAX_EXCERPT_CHARACTERS: usize = 240;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkedMention {
    pub key: String,
    pub title: String,
    pub excerpt: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionExcerpt {
    pub text: String,
    pub match_start: usize,
    pub match_end: usize,
}

pub fn first_occurrence(body: &str, title: &str) -> Option<Range<usize>> {
    let excluded = non_prose_ranges(body);

    find_folded_literal(body, title, |range| {
        !excluded
            .iter()
            .any(|excluded| excluded.start < range.end && range.start < excluded.end)
            && !body[..range.start]
                .chars()
                .rev()
                .find(|character| !is_ignored_arabic_mark(*character))
                .is_some_and(char::is_alphanumeric)
            && !body[range.end..]
                .chars()
                .next()
                .is_some_and(char::is_alphanumeric)
    })
}

pub fn excerpt(body: &str, occurrence: Range<usize>) -> MentionExcerpt {
    let matched = &body[occurrence.clone()];
    let matched_characters = matched.chars().count();
    // Reserve enough room for two ellipses and two separating spaces.
    let context_budget = MAX_EXCERPT_CHARACTERS.saturating_sub(matched_characters + 4);
    let before_budget = context_budget / 2;
    let after_budget = context_budget - before_budget;
    let raw_before = take_chars_back(&body[..occurrence.start], before_budget);
    let raw_after = take_chars(&body[occurrence.end..], after_budget);

    let mut before = clean_piece(raw_before);
    let mut after = clean_piece(raw_after);
    if occurrence.start > raw_before.len() {
        before.insert(0, '…');
    }
    if occurrence.end + raw_after.len() < body.len() {
        after.push('…');
    }
    if !before.is_empty() && !before.ends_with(char::is_whitespace) && starts_word(matched) {
        before.push(' ');
    }
    if !after.is_empty() && !after.starts_with(char::is_whitespace) && ends_word(matched) {
        after.insert(0, ' ');
    }

    let match_start = before.encode_utf16().count();
    let match_end = match_start + matched.encode_utf16().count();
    MentionExcerpt {
        text: format!("{before}{matched}{after}"),
        match_start,
        match_end,
    }
}

fn take_chars_back(value: &str, count: usize) -> &str {
    value
        .char_indices()
        .rev()
        .nth(count)
        .map_or(value, |(index, character)| {
            &value[index + character.len_utf8()..]
        })
}

fn take_chars(value: &str, count: usize) -> &str {
    value
        .char_indices()
        .nth(count)
        .map_or(value, |(index, _)| &value[..index])
}

fn clean_piece(value: &str) -> String {
    value
        .replace("[[", "")
        .replace("]]", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn starts_word(value: &str) -> bool {
    value.chars().next().is_some_and(char::is_alphanumeric)
}

fn ends_word(value: &str) -> bool {
    value.chars().next_back().is_some_and(char::is_alphanumeric)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_literal_unicode_matches_with_token_boundaries() {
        assert_eq!(
            first_occurrence("Using STRASSE calmly", "strasse"),
            Some(6..13)
        );
        assert_eq!(
            first_occurrence("NotTarget Targeted Target", "Target"),
            Some(19..25)
        );
        let arabic = "يفيد التأملُ في الكتابة";
        let occurrence = first_occurrence(arabic, "التَّأمل").unwrap();
        assert_eq!(&arabic[occurrence], "التأملُ");
        assert_eq!(first_occurrence("الـتأمل", "تأمل"), None);
        let embedded_then_standalone = "الـتأمل ثم تأمل";
        let occurrence = first_occurrence(embedded_then_standalone, "تأمل").unwrap();
        assert_eq!(&embedded_then_standalone[occurrence], "تأمل");
    }

    #[test]
    fn excludes_supported_links_and_markdown_code() {
        let body = "[[Target]] [[Other|Target]] `Target`\n```\nTarget\n```\nTarget";
        assert_eq!(
            first_occurrence(body, "Target"),
            Some(body.len() - 6..body.len())
        );
    }

    #[test]
    fn creates_bounded_excerpt_with_utf16_match_offsets() {
        let body = format!("{} [[Other]] 😀Target {}", "a".repeat(300), "b".repeat(300));
        let occurrence = first_occurrence(&body, "Target").unwrap();
        let excerpt = excerpt(&body, occurrence);
        assert!(excerpt.text.chars().count() <= MAX_EXCERPT_CHARACTERS);
        assert!(!excerpt.text.contains("[["));
        let utf16 = excerpt.text.encode_utf16().collect::<Vec<_>>();
        assert_eq!(
            String::from_utf16(&utf16[excerpt.match_start..excerpt.match_end]).unwrap(),
            "Target"
        );
    }
}
