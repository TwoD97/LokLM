//! Exact display excerpts, not entailment or completeness. A substring may
//! still omit a negation or necessary qualifier. No text repair/normalization.
use icu_segmenter::GraphemeClusterSegmenter;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{cell::OnceCell, collections::HashSet, sync::LazyLock};
const SPACE: &str = r"[\x09-\x0d\x20\u{00a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]";
macro_rules! rx {
    ($p:literal) => {{
        static RX: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(&$p.replace(r"\s", SPACE)).expect("fixed source fragment pattern")
        });
        &*RX
    }};
}
fn space(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
fn before(text: &str, at: usize) -> Option<char> {
    text.get(..at)?.chars().next_back()
}
fn after(text: &str, at: usize) -> Option<char> {
    text.get(at..)?.chars().next()
}
fn test(c: Option<char>, p: &Regex) -> bool {
    c.is_some_and(|c| p.is_match(&c.to_string()))
}
fn word(c: Option<char>) -> bool {
    test(c, rx!(r"[\p{L}\p{N}\p{M}\p{Pc}\u{200c}\u{200d}]"))
}
fn number(c: Option<char>) -> bool {
    test(c, rx!(r"\p{N}"))
}
fn joiner(c: Option<char>) -> bool {
    c.is_some_and(|c| "-‐‑‒–—−'’/⁄∕".contains(c))
}
fn connector(c: Option<char>) -> bool {
    c.is_some_and(|c| ".,\u{066b}\u{066c}:/⁄∕+\u{2d}‐‑‒–—−﹢﹣＋－×÷·∙⋅*^".contains(c))
}
fn decoration(c: Option<char>) -> bool {
    test(c, rx!(r"[%‰‱°\p{Sc}]"))
}
fn comparator(c: Option<char>) -> bool {
    c.is_some_and(|c| "<>=≤≥≠≈≃≅≲≳∼~".contains(c))
}
fn gap(c: Option<char>) -> bool {
    matches!(c, Some(' ' | '\t' | '\u{00a0}' | '\u{202f}'))
}
fn width(c: Option<char>) -> usize {
    c.map_or(0, char::len_utf8)
}
fn utf16(s: &str) -> usize {
    s.encode_utf16().count()
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceFragment {
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub ambiguous: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceExcerpt {
    pub selected: SourceFragment,
    pub display: SourceFragment,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FragmentRejection {
    Display,
    Missing,
    Boundary,
}

pub fn is_display_fragment(value: &str, max_code_points: usize, complete_title: bool) -> bool {
    if value.is_empty()
        || value.trim_matches(space) != value
        || value.chars().count() > max_code_points
        || rx!(r"[\r\n\u{2028}\u{2029}]|[.!?…。！？;:,]$|[!?…。！？]").is_match(value)
        || value.chars().any(|c| {
            !matches!(c, '\t' | '\u{200c}' | '\u{200d}') && test(Some(c), rx!(r"[\p{Cc}\p{Cf}]"))
        })
    {
        return false;
    }
    let file_title = complete_title
        && rx!(r"^[\p{L}\p{N}_-]+(?: +[\p{L}\p{N}_-]+)*(?:\.[\p{L}\p{N}_-]+)+$").is_match(value);
    let mut dots = HashSet::new();
    for m in rx!(r"(?i)(?-u:\b)(?:Dr|Prof|Mr|Mrs|Ms|Sr|Jr|St|vs|etc|e\.g|i\.e|z\.\s*B|d\.\s*h)\.")
        .find_iter(value)
    {
        let tail = &value[m.end()..];
        let rest = tail.trim_start_matches(space);
        if rest.len() != tail.len() && !rest.is_empty() {
            for (i, c) in m.as_str().char_indices() {
                if c == '.' {
                    dots.insert(m.start() + i);
                }
            }
        }
    }
    for (i, c) in value.char_indices() {
        let allowed_dot = file_title
            || dots.contains(&i)
            || (number(before(value, i)) && number(after(value, i + 1)));
        if c == '.' && !allowed_dot {
            return false;
        }
    }
    true
}
fn whole_boundary(source: &str, start: usize, end: usize) -> bool {
    let first = after(source, start);
    let last = before(source, end);
    let left = before(source, start);
    let right = after(source, end);
    if (word(left) && word(first)) || (word(last) && word(right)) {
        return false;
    }
    if (joiner(left) && word(first) && word(before(source, start - width(left))))
        || (word(left) && joiner(first))
        || (word(last) && joiner(right) && word(after(source, end + width(right))))
        || (joiner(last) && word(right))
    {
        return false;
    }
    let (mut left_at, mut right_at) = (start, end);
    while left_at > 0 && gap(before(source, left_at)) {
        left_at -= width(before(source, left_at));
    }
    while right_at < source.len() && gap(after(source, right_at)) {
        right_at += width(after(source, right_at));
    }
    let previous = before(source, left_at);
    let next = after(source, right_at);
    if number(first) {
        if number(previous)
            || decoration(previous)
            || comparator(previous)
            || previous.is_some_and(|c| "+-−﹢﹣＋－".contains(c))
        {
            return false;
        }
        if left.is_some_and(|c| ".,\u{066b}\u{066c}".contains(c)) {
            return false;
        }
        if connector(previous) {
            let mut preceding = left_at - width(previous);
            while preceding > 0 && gap(before(source, preceding)) {
                preceding -= width(before(source, preceding));
            }
            if number(before(source, preceding)) {
                return false;
            }
        }
    }
    if number(last) {
        if number(next) || decoration(next) || comparator(next) {
            return false;
        }
        if connector(next) {
            let mut following = right_at + width(next);
            while following < source.len() && gap(after(source, following)) {
                following += width(after(source, following));
            }
            if number(after(source, following)) {
                return false;
            }
        }
    }
    let left_em_dash =
        previous == Some('—') && left_at < start && gap(before(source, left_at - width(previous)));
    let right_em_dash =
        next == Some('—') && right_at > end && gap(after(source, right_at + width(next)));
    if word(first) && joiner(previous) && !left_em_dash {
        let mut preceding = left_at - width(previous);
        while preceding > 0 && gap(before(source, preceding)) {
            preceding -= width(before(source, preceding));
        }
        if word(before(source, preceding)) {
            return false;
        }
    }
    if word(last) && joiner(next) && !right_em_dash {
        let mut following = right_at + width(next);
        while following < source.len() && gap(after(source, following)) {
            following += width(after(source, following));
        }
        if word(after(source, following)) {
            return false;
        }
    }
    true
}
pub fn inline_sentence_body(value: &str, max_code_points: usize) -> Option<&str> {
    if max_code_points == 0 {
        return None;
    }
    let Some(display) = value.strip_suffix('.') else {
        return is_display_fragment(value, max_code_points, false).then_some(value);
    };
    if value.chars().count()>max_code_points||!is_display_fragment(display,max_code_points,false)
        ||rx!(r"(?i)(?:^|[^\p{L}\p{M}])(?:Dr|Prof|Mr|Mrs|Ms|Sr|Jr|St|vs|etc|approx|ca|cf|e\.g|i\.e|z\.\s*B|d\.\s*h|bzw|usw|u\.\s*a|ggf|inkl|zzgl|Nr|No|Abb|Abs|Art|Aufl|Bd|S|vgl|Str|Inc|Ltd|Co|Corp|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Okt|Dez)\.$").is_match(value)
        ||rx!(r"(?:^|[^\p{L}\p{M}])\p{L}\.$|(?:^|[^\p{L}\p{M}])\p{Lu}{2,5}\.$|^[+\-−]?\p{N}+\.$").is_match(value){return None;}
    Some(display)
}
/// Caller-owned immutable source, with lazily cached grapheme boundaries. Scope
/// and source-count/length admission belong to the enclosing evidence catalog.
pub struct FragmentMatcher {
    source: String,
    boundaries: OnceCell<HashSet<usize>>,
}
impl FragmentMatcher {
    pub fn new(source: String) -> Self {
        Self {
            source,
            boundaries: OnceCell::new(),
        }
    }
    fn boundaries(&self) -> &HashSet<usize> {
        self.boundaries.get_or_init(|| {
            GraphemeClusterSegmenter::new()
                .segment_str(&self.source)
                .collect()
        })
    }
    fn fragment(&self, start: usize, end: usize) -> SourceFragment {
        SourceFragment {
            start: utf16(&self.source[..start]),
            end: utf16(&self.source[..end]),
            text: self.source[start..end].into(),
            ambiguous: false,
        }
    }
    pub fn match_fragment(
        &self,
        fragment: &str,
        max_code_points: usize,
    ) -> Result<SourceFragment, FragmentRejection> {
        if !is_display_fragment(fragment, max_code_points, false) {
            return Err(FragmentRejection::Display);
        }
        let mut selected = None::<SourceFragment>;
        let mut found = false;
        let mut offset = 0;
        while offset <= self.source.len().saturating_sub(fragment.len()) {
            let Some(relative) = self.source[offset..].find(fragment) else {
                break;
            };
            let start = offset + relative;
            let end = start + fragment.len();
            found = true;
            offset = start + after(&self.source, start).unwrap().len_utf8();
            if !self.boundaries().contains(&start)
                || !self.boundaries().contains(&end)
                || !whole_boundary(&self.source, start, end)
            {
                continue;
            }
            if let Some(mut prior) = selected {
                prior.ambiguous = true;
                return Ok(prior);
            }
            selected = Some(self.fragment(start, end));
        }
        selected.ok_or(if found {
            FragmentRejection::Boundary
        } else {
            FragmentRejection::Missing
        })
    }
    pub fn match_excerpt(
        &self,
        excerpt: &str,
        max_code_points: usize,
    ) -> Result<SourceExcerpt, FragmentRejection> {
        if !excerpt.ends_with('.') {
            let matched = self.match_fragment(excerpt, max_code_points)?;
            return Ok(SourceExcerpt {
                selected: matched.clone(),
                display: matched,
            });
        }
        inline_sentence_body(excerpt, max_code_points).ok_or(FragmentRejection::Display)?;
        let mut selected = None::<SourceExcerpt>;
        let mut found = false;
        let mut offset = 0;
        while offset <= self.source.len().saturating_sub(excerpt.len()) {
            let Some(relative) = self.source[offset..].find(excerpt) else {
                break;
            };
            let start = offset + relative;
            let end = start + excerpt.len();
            let display_end = end - 1;
            found = true;
            offset = start + after(&self.source, start).unwrap().len_utf8();
            if after(&self.source, end).is_some_and(|c| !space(c) && !"])}\"'»”’".contains(c))
                || !self.boundaries().contains(&start)
                || !self.boundaries().contains(&end)
                || !self.boundaries().contains(&display_end)
                || !whole_boundary(&self.source, start, end)
                || !whole_boundary(&self.source, start, display_end)
            {
                continue;
            }
            if let Some(mut prior) = selected {
                prior.selected.ambiguous = true;
                prior.display.ambiguous = true;
                return Ok(prior);
            }
            selected = Some(SourceExcerpt {
                selected: self.fragment(start, end),
                display: self.fragment(start, display_end),
            });
        }
        selected.ok_or(if found {
            FragmentRejection::Boundary
        } else {
            FragmentRejection::Missing
        })
    }
}
