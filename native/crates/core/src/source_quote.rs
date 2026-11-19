//! Exact provenance port of qa/sourceQuote.ts and sourceQuoteResolver.ts.
//! Membership permits only ECMAScript whitespace collapse, never case/Unicode/
//! punctuation folding. Membership is not relevance, entailment or authority.
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    ops::Range,
};
pub const SOURCE_UTF16_LIMIT: usize = 64_000;
pub const QUOTE_SCALAR_LIMIT: usize = 200;
pub const CONTEXT_SCALAR_LIMIT: usize = 800;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnchoredQuote {
    pub quote: String,
    /// Original TypeScript contract: UTF-16 offsets, end exclusive.
    pub start: usize,
    pub end: usize,
    pub ambiguous: bool,
}
fn whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn units(s: &str) -> usize {
    s.encode_utf16().count()
}
struct Normalized {
    text: Vec<u16>,
    starts: Vec<usize>,
    ends: Vec<usize>,
}
fn normalize(source: &str) -> Normalized {
    let mut result = Normalized {
        text: vec![],
        starts: vec![],
        ends: vec![],
    };
    let mut at = 0;
    let mut previous_space = false;
    for character in source.chars() {
        let width = character.len_utf16();
        if whitespace(character) {
            if previous_space {
                *result.ends.last_mut().unwrap() = at + width;
            } else {
                result.text.push(32);
                result.starts.push(at);
                result.ends.push(at + width);
            }
            previous_space = true;
        } else {
            let mut buffer = [0; 2];
            for (offset, &unit) in character.encode_utf16(&mut buffer).iter().enumerate() {
                result.text.push(unit);
                result.starts.push(at + offset);
                result.ends.push(at + offset + 1);
            }
            previous_space = false;
        }
        at += width;
    }
    result
}
fn quote_key(proposed: &str) -> Option<Vec<u16>> {
    if units(proposed) > QUOTE_SCALAR_LIMIT * 2 || proposed.chars().count() > QUOTE_SCALAR_LIMIT {
        return None;
    }
    let text = normalize(proposed.trim_matches(whitespace)).text;
    (!text.is_empty()).then_some(text)
}
fn find(haystack: &[u16], needle: &[u16], start: usize) -> Option<usize> {
    haystack
        .get(start..)?
        .windows(needle.len())
        .position(|part| part == needle)
        .map(|at| at + start)
}
fn byte_at(source: &str, target: usize) -> Option<usize> {
    let mut units = 0;
    for (byte, character) in source.char_indices() {
        if units == target {
            return Some(byte);
        }
        units += character.len_utf16();
        if units > target {
            return None;
        }
    }
    (units == target).then_some(source.len())
}
/// Safely convert a verified UTF-16 anchor for Rust slicing. Invalid offsets,
/// split surrogate pairs and forged quote text cannot become a byte span.
pub fn byte_range(source: &str, anchor: &AnchoredQuote) -> Option<Range<usize>> {
    if units(source) > SOURCE_UTF16_LIMIT || anchor.start >= anchor.end {
        return None;
    }
    let range = byte_at(source, anchor.start)?..byte_at(source, anchor.end)?;
    (source.get(range.clone())? == anchor.quote).then_some(range)
}
pub fn anchor(source: &str, proposed: &str) -> Option<AnchoredQuote> {
    if units(source) > SOURCE_UTF16_LIMIT {
        return None;
    }
    let query = quote_key(proposed)?;
    let normalized = normalize(source);
    let mut cursor = 0;
    let mut count = 0;
    let mut found: Option<AnchoredQuote> = None;
    while let Some(index) = find(&normalized.text, &query, cursor) {
        count += 1;
        let start = normalized.starts[index];
        let end = normalized.ends[index + query.len() - 1];
        if found.is_none() && end - start <= QUOTE_SCALAR_LIMIT * 2 {
            let original = source.get(byte_at(source, start)?..byte_at(source, end)?)?;
            if original.chars().count() <= QUOTE_SCALAR_LIMIT {
                found = Some(AnchoredQuote {
                    quote: original.into(),
                    start,
                    end,
                    ambiguous: false,
                });
            }
        }
        if count > 1
            && let Some(result) = found.as_mut()
        {
            result.ambiguous = true;
            return found;
        }
        cursor = index + 1;
    }
    found
}
pub fn expand_context(source: &str, anchored: &AnchoredQuote) -> Option<AnchoredQuote> {
    let original = byte_range(source, anchored)?;
    // Only literal line starts with up to three spaces count as fenced code.
    if source.split(['\r', '\n']).any(|line| {
        let spaces = line.bytes().take_while(|b| *b == b' ').count();
        spaces <= 3 && (line[spaces..].starts_with("```") || line[spaces..].starts_with("~~~"))
    }) {
        return Some(anchored.clone());
    }
    let mut start = 0;
    let mut end = source.len();
    let mut cursor = 0;
    while cursor < source.len() {
        let line_start = cursor;
        let content_end = source[cursor..]
            .find(['\r', '\n'])
            .map_or(source.len(), |offset| cursor + offset);
        cursor = content_end;
        if source.as_bytes().get(cursor) == Some(&b'\r') {
            cursor += 1;
            if source.as_bytes().get(cursor) == Some(&b'\n') {
                cursor += 1;
            }
        } else if source.as_bytes().get(cursor) == Some(&b'\n') {
            cursor += 1;
        }
        if !source[line_start..content_end]
            .trim_matches(whitespace)
            .is_empty()
        {
            continue;
        }
        if cursor <= original.start {
            start = cursor;
        } else if line_start >= original.end {
            end = line_start;
            break;
        } else {
            return Some(anchored.clone());
        }
    }
    let window = &source[start..end];
    let trimmed = window.trim_matches(whitespace);
    start += window.len() - window.trim_start_matches(whitespace).len();
    end = start + trimmed.len();
    if start > original.start
        || end < original.end
        || trimmed.chars().count() > CONTEXT_SCALAR_LIMIT
    {
        return Some(anchored.clone());
    }
    Some(AnchoredQuote {
        quote: trimmed.into(),
        start: units(&source[..start]),
        end: units(&source[..end]),
        ambiguous: anchored.ambiguous,
    })
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuoteSource {
    pub document_id: i64,
    pub chunk_id: i64,
    pub text: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolvedQuote {
    pub source: String,
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub ambiguous: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuoteFailure {
    QuoteMissing,
    QuoteAmbiguous,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum QuoteResolution {
    Resolved { span: ResolvedQuote },
    Failed { reason: QuoteFailure },
}
fn missing() -> QuoteResolution {
    QuoteResolution::Failed {
        reason: QuoteFailure::QuoteMissing,
    }
}
struct CatalogSource {
    source: String,
    text: String,
    normalized: Vec<u16>,
}
/// Immutable bounded catalog. Resolve across every supplied passage, never a
/// model-selected ID. Returned/cache values are owned, preventing span mutation.
pub struct QuoteResolver {
    sources: Vec<CatalogSource>,
    cache: VecDeque<(Vec<u16>, QuoteResolution)>,
}
impl QuoteResolver {
    pub fn new(input: &[QuoteSource]) -> Option<Self> {
        if input.is_empty() || input.len() > 32 {
            return None;
        }
        let mut ids = HashSet::new();
        let mut total = 0;
        let mut sources = Vec::new();
        for passage in input {
            if passage.document_id <= 0
                || passage.document_id > 9_007_199_254_740_991
                || passage.chunk_id <= 0
                || passage.chunk_id > 9_007_199_254_740_991
                || passage.text.trim_matches(whitespace).is_empty()
                || units(&passage.text) > SOURCE_UTF16_LIMIT
            {
                return None;
            }
            total += units(&passage.text);
            if total > 256_000 {
                return None;
            }
            let source = format!("{}:{}", passage.document_id, passage.chunk_id);
            if !ids.insert(source.clone()) {
                return None;
            }
            sources.push(CatalogSource {
                source,
                text: passage.text.clone(),
                normalized: normalize(&passage.text).text,
            });
        }
        Some(Self {
            sources,
            cache: VecDeque::new(),
        })
    }
    pub fn resolve(&mut self, proposed: &str) -> QuoteResolution {
        let Some(query) = quote_key(proposed) else {
            return missing();
        };
        if let Some((_, result)) = self.cache.iter().find(|(key, _)| *key == query) {
            return result.clone();
        }
        let mut selected = None;
        let mut result = missing();
        for (index, source) in self.sources.iter().enumerate() {
            let Some(first) = find(&source.normalized, &query, 0) else {
                continue;
            };
            if selected.is_some() || find(&source.normalized, &query, first + 1).is_some() {
                result = QuoteResolution::Failed {
                    reason: QuoteFailure::QuoteAmbiguous,
                };
                selected = None;
                break;
            }
            selected = Some(index);
        }
        if let Some(index) = selected {
            let source = &self.sources[index];
            if let Some(anchored) = anchor(&source.text, proposed)
                && !anchored.ambiguous
            {
                result = QuoteResolution::Resolved {
                    span: ResolvedQuote {
                        source: source.source.clone(),
                        start: anchored.start,
                        end: anchored.end,
                        text: anchored.quote,
                        ambiguous: false,
                    },
                };
            }
        }
        if self.cache.len() >= 128 {
            self.cache.pop_front();
        }
        self.cache.push_back((query, result.clone()));
        result
    }
}
