use std::ops::Range;

pub fn fold_literal_search(text: &str) -> String {
    text.chars()
        .filter(|character| !is_ignored_arabic_mark(*character))
        .flat_map(char::to_lowercase)
        .collect()
}

pub fn strip_literal_search_marks(text: &str) -> String {
    text.chars()
        .filter(|character| !is_ignored_arabic_mark(*character))
        .collect()
}

pub fn find_folded_literal(
    text: &str,
    needle: &str,
    mut accepts: impl FnMut(&Range<usize>) -> bool,
) -> Option<Range<usize>> {
    let folded_needle = fold_literal_search(needle);
    if folded_needle.is_empty() {
        return None;
    }

    text.char_indices()
        .filter_map(|(start, first)| {
            if is_ignored_arabic_mark(first) {
                return None;
            }
            let mut end = start;
            let mut folded = String::new();
            for character in text[start..].chars() {
                end += character.len_utf8();
                if !is_ignored_arabic_mark(character) {
                    folded.extend(character.to_lowercase());
                }
                if folded.len() >= folded_needle.len() {
                    break;
                }
            }
            if folded != folded_needle {
                return None;
            }
            while let Some(character) = text[end..].chars().next() {
                if !is_ignored_arabic_mark(character) {
                    break;
                }
                end += character.len_utf8();
            }
            let range = start..end;
            accepts(&range).then_some(range)
        })
        .next()
}

pub(crate) fn is_ignored_arabic_mark(character: char) -> bool {
    matches!(
        character,
        '\u{0610}'..='\u{061a}'
            | '\u{0640}'
            | '\u{064b}'..='\u{065f}'
            | '\u{0670}'
            | '\u{06d6}'..='\u{06dc}'
            | '\u{06df}'..='\u{06e4}'
            | '\u{06e7}'..='\u{06e8}'
            | '\u{06ea}'..='\u{06ed}'
            | '\u{0897}'..='\u{089f}'
            | '\u{08ca}'..='\u{08e1}'
            | '\u{08e3}'..='\u{08ff}'
            | '\u{10efa}'..='\u{10eff}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_arabic_marks_and_tatweel_without_changing_letters() {
        assert_eq!(fold_literal_search("التَّـأمُّل"), "التأمل");
        assert_eq!(fold_literal_search("ن\u{08d3}ص\u{10efc}"), "نص");
        assert_eq!(
            fold_literal_search("Markdown عربي 2026"),
            "markdown عربي 2026"
        );
        assert_eq!(strip_literal_search_marks("My التَّأمل"), "My التأمل");
    }

    #[test]
    fn maps_folded_matches_back_to_original_byte_ranges() {
        let text = "التَّأملُ والتأمل";
        let first = find_folded_literal(text, "التأمل", |_| true).unwrap();
        assert_eq!(&text[first], "التَّأملُ");
        let second = find_folded_literal(text, "التأمل", |range| range.start > 0).unwrap();
        assert_eq!(&text[second], "التأمل");
        assert!(find_folded_literal(text, "ـَ", |_| true).is_none());
    }
}
