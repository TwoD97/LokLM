//! Shared canonical-marker QA boundary, ported from v0.7.4 llm/prompt.ts.
//! Does not claim checked-answer, routing, alias or semantic-entailment parity.
//! Sources are untrusted evidence. Callers must enforce session/workspace scope
//! before creating these records, and validate model output before publishing.
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const PROMPT_VERSION: &str = "loklm-0.7.4-canonical-v1";
pub const DEFAULT_CONTEXT_TOKENS: usize = 8192;
pub const CONTEXT_PACK_MARGIN_TOKENS: usize = 192;
const TRUNCATED: &str = "… [truncated]";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    En,
    De,
}
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Depth {
    Concise,
    Standard,
    Thorough,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct Passage {
    pub document_id: i64,
    pub chunk_id: i64,
    pub document_title: String,
    pub text: String,
    #[serde(default)]
    pub heading_path: Option<Vec<String>>,
    #[serde(default)]
    pub page_from: Option<u32>,
    #[serde(default)]
    pub page_to: Option<u32>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct HistoryMessage {
    pub role: Role,
    pub content: String,
}

pub fn refusal(lang: Language) -> &'static str {
    match lang {
        Language::En => "I don’t have enough information to answer this question.",
        Language::De => {
            "Mir liegen nicht genügend Informationen vor, um diese Frage zu beantworten."
        }
    }
}
pub fn bump_depth_for_code(depth: Depth) -> Depth {
    match depth {
        Depth::Concise => Depth::Standard,
        _ => Depth::Thorough,
    }
}
pub fn system_prompt(lang: Language, depth: Depth, codebase: bool) -> &'static str {
    match (lang, depth, codebase) {
        (Language::En, Depth::Concise, false) => include_str!("qa_prompts/en-concise.txt"),
        (Language::En, Depth::Standard, false) => include_str!("qa_prompts/en-standard.txt"),
        (Language::En, Depth::Thorough, false) => include_str!("qa_prompts/en-thorough.txt"),
        (Language::De, Depth::Concise, false) => include_str!("qa_prompts/de-concise.txt"),
        (Language::De, Depth::Standard, false) => include_str!("qa_prompts/de-standard.txt"),
        (Language::De, Depth::Thorough, false) => include_str!("qa_prompts/de-thorough.txt"),
        (Language::En, Depth::Concise, true) => include_str!("qa_prompts/en-concise-code.txt"),
        (Language::En, Depth::Standard, true) => include_str!("qa_prompts/en-standard-code.txt"),
        (Language::En, Depth::Thorough, true) => include_str!("qa_prompts/en-thorough-code.txt"),
        (Language::De, Depth::Concise, true) => include_str!("qa_prompts/de-concise-code.txt"),
        (Language::De, Depth::Standard, true) => include_str!("qa_prompts/de-standard-code.txt"),
        (Language::De, Depth::Thorough, true) => include_str!("qa_prompts/de-thorough-code.txt"),
    }
}
fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}
pub fn estimate_tokens(text: &str) -> usize {
    (utf16_len(text) * 2).div_ceil(7)
}
pub fn answer_max_tokens(context: usize) -> usize {
    (if context == 0 {
        DEFAULT_CONTEXT_TOKENS
    } else {
        context
    } / 4)
        .clamp(1, 131072)
}
fn cap_history(text: &str, limit: usize) -> String {
    if utf16_len(text) <= limit {
        return text.to_owned();
    }
    if limit <= utf16_len(TRUNCATED) {
        return String::new();
    }
    let room = limit - utf16_len(TRUNCATED);
    let mut units = 0;
    // Unlike JS slice, never create a lone surrogate at a Unicode boundary.
    let head: String = text
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= room
        })
        .collect();
    head + TRUNCATED
}
pub fn estimate_history_tokens(history: &[HistoryMessage]) -> usize {
    if history.is_empty() {
        return 0;
    }
    let chars = utf16_len("Previous conversation in this chat:\n")
        + history
            .iter()
            .map(|m| utf16_len(&cap_history(&m.content, 1500)) + 13)
            .sum::<usize>();
    (chars * 2).div_ceil(7)
}
pub fn pack_history_to_budget(history: &[HistoryMessage], budget: usize) -> Vec<HistoryMessage> {
    let mut out = Vec::new();
    if budget == 0 {
        return out;
    }
    for m in history.iter().rev() {
        let content = cap_history(&m.content, 1500);
        let mut candidate = out.clone();
        candidate.insert(
            0,
            HistoryMessage {
                role: m.role.clone(),
                content: content.clone(),
            },
        );
        if estimate_history_tokens(&candidate) <= budget {
            out = candidate;
            continue;
        }
        candidate[0].content.clear();
        let framing = estimate_history_tokens(&candidate);
        let room = budget.saturating_sub(framing).saturating_mul(7) / 2;
        candidate[0].content = cap_history(&content, room);
        if !candidate[0].content.is_empty() && estimate_history_tokens(&candidate) <= budget {
            out = candidate;
        }
        break;
    }
    out
}
pub fn marker(hit: &Passage) -> String {
    format!("[doc:{}, chunk:{}]", hit.document_id, hit.chunk_id)
}
pub fn render_passage(hit: &Passage, language: Language) -> String {
    let mut loc = String::new();
    if let Some(h) = &hit.heading_path
        && !h.is_empty()
    {
        loc.push_str(&format!(", § {}", h.join(" › ")));
    }
    if let Some(from) = hit.page_from {
        let range = match hit.page_to {
            Some(to) if to != from => format!("{from}–{to}"),
            _ => from.to_string(),
        };
        loc.push_str(&format!(
            ", {}{range}",
            if language == Language::De {
                "S. "
            } else {
                "p."
            }
        ));
    }
    let lang = if language == Language::De { "de" } else { "en" };
    if let Some(l) = &hit.language
        && !l.is_empty()
        && l != "other"
        && l != lang
    {
        loc.push_str(&format!(", lang:{l}"));
    }
    format!(
        "{} ({}{})\n{}",
        marker(hit),
        hit.document_title,
        loc,
        hit.text
    )
}
pub fn hit_token_cost(hit: &Passage, language: Language) -> usize {
    estimate_tokens(&(render_passage(hit, language) + "\n\n---\n\n"))
}
pub fn pack_hits_to_budget(hits: &[Passage], budget: usize, language: Language) -> Vec<Passage> {
    pack_records_to_budget(hits, budget, language, |h| h)
}
pub(crate) fn pack_records_to_budget<T: Clone>(
    hits: &[T],
    budget: usize,
    language: Language,
    passage: impl Fn(&T) -> &Passage,
) -> Vec<T> {
    let primary = |h: &&T| {
        passage(h)
            .origin
            .as_deref()
            .is_none_or(|o| o.is_empty() || o == "primary")
    };
    let mut seen = HashSet::new();
    let mut used = 0usize;
    let mut out = Vec::new();
    for hit in hits
        .iter()
        .filter(primary)
        .chain(hits.iter().filter(|h| !primary(h)))
    {
        let source = passage(hit);
        if source
            .text
            .trim_matches(crate::citation_markers::ws)
            .is_empty()
            || !seen.insert((source.document_id, source.chunk_id))
        {
            continue;
        }
        let cost = hit_token_cost(source, language);
        if cost > budget.saturating_sub(used) {
            continue;
        }
        used += cost;
        out.push(hit.clone());
    }
    out
}
pub fn build_prompt(
    question: &str,
    hits: &[Passage],
    history: &[HistoryMessage],
    language: Language,
    pinned: &[Passage],
    preamble: Option<&str>,
) -> String {
    build_prompt_with_output(
        question,
        hits,
        history,
        language,
        pinned,
        preamble,
        CitationOutput::Markers,
    )
}
#[derive(Debug, Clone, Copy)]
pub enum CitationOutput {
    Markers,
    StructuredSources,
    StructuredSummary,
}
pub fn build_prompt_with_output(
    question: &str,
    hits: &[Passage],
    history: &[HistoryMessage],
    language: Language,
    pinned: &[Passage],
    preamble: Option<&str>,
    output: CitationOutput,
) -> String {
    let render = |list: &[Passage]| {
        list.iter()
            .map(|h| render_passage(h, language))
            .collect::<Vec<_>>()
            .join("\n\n---\n\n")
    };
    let mut sections = Vec::new();
    if !pinned.is_empty() {
        sections.push(format!("Context (pinned):\n{}", render(pinned)));
    }
    if !history.is_empty() {
        let lines = history
            .iter()
            .map(|m| {
                format!(
                    "{}: {}",
                    if m.role == Role::User {
                        "User"
                    } else {
                        "Assistant"
                    },
                    cap_history(&m.content, 1500)
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        sections.push(format!("Previous conversation in this chat:\n{lines}"));
    }
    let mut blocks = Vec::new();
    if let Some(p) = preamble.filter(|p| !p.is_empty()) {
        blocks.push(p.to_owned());
    }
    if !hits.is_empty() {
        blocks.push(render(hits));
    }
    if blocks.is_empty() {
        if pinned.is_empty() {
            sections.push("Context: (none)".into());
        }
    } else {
        sections.push(format!("Context:\n{}", blocks.join("\n\n---\n\n")));
    }
    sections.push(format!("Question: {question}"));
    if hits
        .iter()
        .chain(pinned)
        .any(|h| !h.text.trim_matches(crate::citation_markers::ws).is_empty())
    {
        sections.push(match (language, output) {
            (Language::De, CitationOutput::Markers)=>"Antwortvorgabe: Beachte das gewünschte Antwortformat. Belege Tatsachenbehauptungen mit dem exakten Quellenmarker der passenden Passage im bereitgestellten Context. Fehlt die gesuchte Information, sage das, ohne einen Quellenmarker zu erfinden.",
            (Language::En, CitationOutput::Markers)=>"Answer instructions: Follow the requested answer format. Cite factual claims with the supporting passage's exact source marker from the supplied Context. If the requested fact is missing, say so without inventing a citation.",
            (Language::De, CitationOutput::StructuredSources)=>include_str!("qa_prompts/checked-de-full-instructions.txt"),
            (Language::En, CitationOutput::StructuredSources)=>include_str!("qa_prompts/checked-en-full-instructions.txt"),
            (Language::De, CitationOutput::StructuredSummary)=>include_str!("qa_prompts/checked-de-summary-instructions.txt"),
            (Language::En, CitationOutput::StructuredSummary)=>include_str!("qa_prompts/checked-en-summary-instructions.txt"),
        }.into());
    }
    sections.join("\n\n")
}

/// Resolves only visible, exact current-context canonical markers. Source-like
/// text inside code, links, flow math or escaped literals does not count as evidence.
/// This checks identity, NOT whether a cited passage entails a model's claim.
/// The caller must treat raw streaming text as provisional until validation.
pub fn validate_citations(answer: &str, supplied: &[Passage]) -> Result<Vec<Passage>> {
    let invalid =
        || Error::Invalid("Answer has missing, ambiguous or unknown source markers".into());
    let mut identities = HashSet::new();
    for h in supplied {
        if !(1..=9_007_199_254_740_991).contains(&h.document_id)
            || !(1..=9_007_199_254_740_991).contains(&h.chunk_id)
            || !identities.insert((h.document_id, h.chunk_id))
        {
            return Err(invalid());
        }
    }
    if crate::citation_markers::has_invalid_citation_syntax(answer) {
        return Err(invalid());
    }
    let units: Vec<_> = answer.encode_utf16().collect();
    let mut seen = HashSet::new();
    let mut citations = Vec::new();
    for matched in crate::citation_markers::find_citation_matches(answer) {
        let h = supplied
            .iter()
            .find(|h| {
                h.document_id as u64 == matched.marker.document_id
                    && h.chunk_id as u64 == matched.marker.chunk_id
            })
            .ok_or_else(invalid)?;
        // Preserve this adapter's canonical spelling requirement even though
        // the shared display matcher also recognizes flexible whitespace.
        if !units[matched.start..matched.end]
            .iter()
            .copied()
            .eq(marker(h).encode_utf16())
        {
            return Err(invalid());
        }
        if seen.insert((h.document_id, h.chunk_id)) {
            citations.push(h.clone());
        }
    }
    if citations.is_empty() {
        return Err(invalid());
    }
    Ok(citations)
}
