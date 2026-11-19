//! Bounded presentation of model-authored records with supplied identities.
//! Source choice and claim support still require the checked-QA pipeline; this
//! renderer enforces shape, identities, literal placement and output bounds only.
use crate::citation_markers::{
    self as citations, CitationMarker, CitationMatch, SourceLabelRejection,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StructuralRejection {
    RecordShape,
    SourcesShape,
    SourceUnknown,
    SourceInvalid,
    TextBounds,
    TextEmpty,
    CitationSyntax,
    HtmlSyntax,
    ReservedHref,
    RenderBounds,
    CitationPlacement,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum AnswerRejection {
    Label(SourceLabelRejection),
    Structural(StructuralRejection),
}
impl From<StructuralRejection> for AnswerRejection {
    fn from(v: StructuralRejection) -> Self {
        Self::Structural(v)
    }
}
impl From<SourceLabelRejection> for AnswerRejection {
    fn from(v: SourceLabelRejection) -> Self {
        Self::Label(v)
    }
}

pub fn render(
    blocks: &Value,
    supplied: &HashSet<String>,
    max_chars: usize,
) -> Result<String, AnswerRejection> {
    use StructuralRejection::*;
    if !(1..=32_000).contains(&max_chars) {
        return Err(TextBounds.into());
    }
    let blocks = blocks
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= max_chars)
        .ok_or(RecordShape)?;
    let mut markdown = String::new();
    let mut points = 0;
    let mut original_points = 0;
    let mut utf16_length = 0;
    let mut expected = Vec::new();
    for block in blocks {
        let object = block
            .as_object()
            .filter(|o| o.len() == 2 && o.contains_key("text") && o.contains_key("sources"))
            .ok_or(RecordShape)?;
        let raw_text = object["text"].as_str().ok_or(RecordShape)?;
        if raw_text.encode_utf16().count() > max_chars * 2 {
            return Err(TextBounds.into());
        }
        let raw_sources = object["sources"]
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 32)
            .ok_or(SourcesShape)?;
        let mut sources = Vec::new();
        let mut seen = HashSet::new();
        for raw in raw_sources {
            let raw = raw.as_str().ok_or(SourcesShape)?;
            if !supplied.contains(raw) {
                return Err(SourceUnknown.into());
            }
            let (document, chunk) = raw.split_once(':').ok_or(SourceInvalid)?;
            let parse = |id: &str| -> Option<u64> {
                if !id.starts_with(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
                    || !id.bytes().all(|b| b.is_ascii_digit())
                {
                    return None;
                }
                id.parse::<u64>()
                    .ok()
                    .filter(|&n| n <= 9_007_199_254_740_991)
            };
            let marker = CitationMarker {
                document_id: parse(document).ok_or(SourceInvalid)?,
                chunk_id: parse(chunk).ok_or(SourceInvalid)?,
            };
            if seen.insert(raw.to_owned()) {
                sources.push(marker);
            }
        }
        let original = raw_text.trim_end_matches(citations::ws);
        original_points += original.chars().count();
        if original_points > max_chars {
            return Err(TextBounds.into());
        }
        let cleaned = citations::remove_redundant_source_labels(original, &seen)?;
        let text = cleaned.trim_end_matches(citations::ws);
        if text.trim_matches(citations::ws).is_empty() {
            return Err(TextEmpty.into());
        }
        if citations::has_unmasked_citation_syntax(text) {
            return Err(CitationSyntax.into());
        }
        if citations::has_active_html_syntax(text) {
            return Err(HtmlSyntax.into());
        }
        if text.to_lowercase().contains("#cite-") {
            return Err(ReservedHref.into());
        }
        let prefix = if markdown.is_empty() { "" } else { "\n\n" };
        let separator =
            if text.contains(['\r', '\n']) || text.starts_with("    ") || text.starts_with('\t') {
                "\n\n"
            } else {
                " "
            };
        points += prefix.len() + text.chars().count() + separator.len();
        if points > max_chars {
            return Err(RenderBounds.into());
        }
        markdown.push_str(prefix);
        markdown.push_str(text);
        markdown.push_str(separator);
        utf16_length += prefix.len() + text.encode_utf16().count() + separator.len();
        for (index, marker) in sources.into_iter().enumerate() {
            let space = if index == 0 { "" } else { " " };
            let formatted = format!(
                "{space}[doc:{}, chunk:{}]",
                marker.document_id, marker.chunk_id
            );
            points += formatted.len();
            if points > max_chars {
                return Err(RenderBounds.into());
            }
            let start = utf16_length + space.len();
            markdown.push_str(&formatted);
            utf16_length += formatted.len();
            expected.push(CitationMatch {
                marker,
                start,
                end: utf16_length,
            });
        }
    }
    if citations::find_citation_matches(&markdown) != expected {
        return Err(CitationPlacement.into());
    }
    Ok(markdown)
}
