//! Original complete-passage allocation and checked-context finalization.
//! Counts are estimates, not tokenizer admission. Preserve the final immutable
//! bundle and perform actual template/token checks before native generation.
use crate::{
    checked_answer::{self, ContextBundle},
    comparison_answer::ComparisonMode,
    qa::{self, Depth, HistoryMessage, Language, Passage},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
pub const PINNED_BUDGET_MAX_TOKENS: usize = 4096;

/// Keep the complete retrieval record, including fields not used in prompting.
/// Selection must not discard scores, ordinals, origin metadata or future fields.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(try_from = "Value")]
pub struct ContextHit {
    original: Value,
    passage: Passage,
}
impl TryFrom<Value> for ContextHit {
    type Error = serde_json::Error;
    fn try_from(original: Value) -> Result<Self, Self::Error> {
        let passage = serde_json::from_value(original.clone())?;
        Ok(Self { original, passage })
    }
}
impl Serialize for ContextHit {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.original.serialize(serializer)
    }
}
impl ContextHit {
    pub fn passage(&self) -> &Passage {
        &self.passage
    }
    pub fn as_value(&self) -> &Value {
        &self.original
    }
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Summary {
    pub title: String,
    pub summary: String,
}
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AnswerMode {
    Checked,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextInput {
    #[serde(default)]
    pub context_tokens: Option<f64>,
    pub question: String,
    pub language: Language,
    #[serde(default)]
    pub codebase: bool,
    #[serde(default)]
    pub history: Vec<HistoryMessage>,
    pub hits: Vec<ContextHit>,
    #[serde(default)]
    pub pinned_groups: Vec<Vec<ContextHit>>,
    #[serde(default)]
    pub summary: Option<Summary>,
    #[serde(default)]
    pub answer_mode: Option<AnswerMode>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPlan {
    context_tokens: usize,
    max_tokens: usize,
    history: Vec<HistoryMessage>,
    pinned_hits: Vec<ContextHit>,
    hits: Vec<ContextHit>,
    context_preamble: Option<String>,
    prompt_tokens: usize,
    fits: bool,
    summary_omitted: bool,
    #[serde(skip)]
    checked_bundle: Option<ContextBundle>,
}
impl ContextPlan {
    pub fn context_tokens(&self) -> usize {
        self.context_tokens
    }
    pub fn max_tokens(&self) -> usize {
        self.max_tokens
    }
    pub fn prompt_tokens(&self) -> usize {
        self.prompt_tokens
    }
    pub fn fits(&self) -> bool {
        self.fits
    }
    pub fn history(&self) -> &[HistoryMessage] {
        &self.history
    }
    pub fn hits(&self) -> &[ContextHit] {
        &self.hits
    }
    pub fn pinned_hits(&self) -> &[ContextHit] {
        &self.pinned_hits
    }
    pub fn context_preamble(&self) -> Option<&str> {
        self.context_preamble.as_deref()
    }
    pub fn checked_bundle(&self) -> Option<&ContextBundle> {
        self.checked_bundle.as_ref()
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextRejection {
    StandaloneRequired,
    InvalidWindow,
}
pub fn pinned_budget_tokens(total: usize, count: usize) -> usize {
    if count == 0 {
        0
    } else {
        ((total as f64 * 0.4).floor() as usize).min(PINNED_BUDGET_MAX_TOKENS)
    }
}
pub fn summary_preamble(
    language: Language,
    title: &str,
    summary: &str,
    has_excerpts: bool,
) -> String {
    match language {
        Language::De => {
            let instruction = if has_excerpts {
                "keine Zitat-ID — belege konkrete Aussagen mit den Auszugsblöcken unten"
            } else {
                "für diesen Überblick gibt es keine Zitat-ID — antworte daraus und füge keine Zitatmarker ein"
            };
            format!(
                "Dokumentüberblick — „{title}“ (Hintergrund, aus dem gesamten Dokument abgeleitet; {instruction}):\n{summary}"
            )
        }
        Language::En => {
            let instruction = if has_excerpts {
                "no citation id — cite the excerpt blocks below for specific claims"
            } else {
                "no citation id exists for this overview — answer from it and do not emit citation markers"
            };
            format!(
                "Document overview — \"{title}\" (background derived from the full document; {instruction}):\n{summary}"
            )
        }
    }
}
fn passages(hits: &[ContextHit]) -> Vec<Passage> {
    hits.iter().map(|h| h.passage.clone()).collect()
}
fn preamble(summary: Option<&Summary>, language: Language, excerpts: bool) -> Option<String> {
    summary.map(|s| summary_preamble(language, &s.title, &s.summary, excerpts))
}
fn render(
    input: &ContextInput,
    hits: &[ContextHit],
    history: &[HistoryMessage],
    pinned: &[ContextHit],
    preamble: Option<&str>,
) -> String {
    let hits = passages(hits);
    let pinned = passages(pinned);
    if input.answer_mode.is_some() {
        checked_answer::build_prompt(
            &input.question,
            &hits,
            input.language,
            &pinned,
            ComparisonMode::Full,
        )
    } else {
        qa::build_prompt(
            &input.question,
            &hits,
            history,
            input.language,
            &pinned,
            preamble,
        )
    }
}
fn candidate(
    input: &ContextInput,
    hits: &[ContextHit],
    history: &[HistoryMessage],
    pinned: &[ContextHit],
    summary: Option<&Summary>,
    system_tokens: usize,
) -> (usize, Option<ContextBundle>) {
    if input.answer_mode.is_some() {
        let bundle = ContextBundle::new(
            &input.question,
            &passages(hits),
            input.language,
            &passages(pinned),
        );
        (
            qa::estimate_tokens(bundle.system_prompt()) + qa::estimate_tokens(bundle.prompt()),
            Some(bundle),
        )
    } else {
        let preamble = preamble(
            summary,
            input.language,
            !hits.is_empty() || !pinned.is_empty(),
        );
        (
            system_tokens
                + qa::estimate_tokens(&render(input, hits, history, pinned, preamble.as_deref())),
            None,
        )
    }
}
pub fn plan(input: &ContextInput) -> Result<ContextPlan, ContextRejection> {
    let checked = input.answer_mode.is_some();
    if checked && (!input.history.is_empty() || input.summary.is_some() || input.codebase) {
        return Err(ContextRejection::StandaloneRequired);
    }
    let window = input
        .context_tokens
        .filter(|n| n.is_finite() && *n > 0.0)
        .map_or(qa::DEFAULT_CONTEXT_TOKENS as f64, f64::floor);
    // Provider windows are bounded integers. Do not silently saturate an
    // unrepresentable external value into a misleading successful allocation.
    if window >= usize::MAX as f64 {
        return Err(ContextRejection::InvalidWindow);
    }
    let context_tokens = window as usize;
    let max_tokens = qa::answer_max_tokens(context_tokens) + if checked { 128 } else { 0 };
    let margin = (qa::CONTEXT_PACK_MARGIN_TOKENS as f64).max((window / 10.0).ceil());
    let input_limit = window - max_tokens as f64 - margin;
    let system = if checked {
        checked_answer::system_prompt(input.language, ComparisonMode::Full)
    } else {
        qa::system_prompt(input.language, Depth::Thorough, input.codebase)
    };
    let system_tokens = qa::estimate_tokens(system);
    let fixed_tokens = system_tokens + qa::estimate_tokens(&render(input, &[], &[], &[], None));
    let mut summary = input.summary.as_ref();
    if let Some(s) = summary {
        let cost = qa::estimate_tokens(&summary_preamble(
            input.language,
            &s.title,
            &s.summary,
            true,
        ))
        .max(qa::estimate_tokens(&summary_preamble(
            input.language,
            &s.title,
            &s.summary,
            false,
        )));
        if cost as f64 > ((input_limit - fixed_tokens as f64) / 2.0).max(0.0) {
            summary = None;
        }
    }
    let summary_reserve = summary.map_or(0, |s| {
        qa::estimate_tokens(&summary_preamble(
            input.language,
            &s.title,
            &s.summary,
            true,
        ))
        .max(qa::estimate_tokens(&summary_preamble(
            input.language,
            &s.title,
            &s.summary,
            false,
        )))
    });
    let history_budget = 2048.0f64
        .min((window / 8.0).floor())
        .min(((input_limit - fixed_tokens as f64 - summary_reserve as f64) / 4.0).floor())
        .max(0.0) as usize;
    let history = qa::pack_history_to_budget(&input.history, history_budget);
    let base_tokens = system_tokens
        + qa::estimate_tokens(&render(
            input,
            &[],
            &history,
            &[],
            preamble(summary, input.language, true).as_deref(),
        ));
    let evidence_budget = (input_limit - base_tokens as f64 - 32.0).max(0.0) as usize;
    let groups: Vec<_> = input
        .pinned_groups
        .iter()
        .filter(|g| !g.is_empty())
        .collect();
    let pinned_budget = if input.hits.is_empty() {
        evidence_budget.min(PINNED_BUDGET_MAX_TOKENS)
    } else {
        pinned_budget_tokens(evidence_budget, groups.len())
    };
    let rounds = groups.iter().map(|g| g.len()).max().unwrap_or(0);
    let mut pinned_candidates = Vec::new();
    for i in 0..rounds {
        for group in &groups {
            if let Some(hit) = group.get(i) {
                pinned_candidates.push(hit.clone());
            }
        }
    }
    let mut pinned_hits = qa::pack_records_to_budget(
        &pinned_candidates,
        pinned_budget,
        input.language,
        ContextHit::passage,
    );
    let pinned_keys: HashSet<_> = pinned_hits
        .iter()
        .map(|h| (h.passage.document_id, h.passage.chunk_id))
        .collect();
    let used_pinned: usize = pinned_hits
        .iter()
        .map(|h| qa::hit_token_cost(&h.passage, input.language))
        .sum();
    let available: Vec<_> = input
        .hits
        .iter()
        .filter(|h| !pinned_keys.contains(&(h.passage.document_id, h.passage.chunk_id)))
        .cloned()
        .collect();
    let mut hits = qa::pack_records_to_budget(
        &available,
        evidence_budget.saturating_sub(used_pinned),
        input.language,
        ContextHit::passage,
    );
    let (mut prompt_tokens, mut checked_bundle) =
        candidate(input, &hits, &history, &pinned_hits, summary, system_tokens);
    while prompt_tokens as f64 > input_limit && (!hits.is_empty() || !pinned_hits.is_empty()) {
        if !hits.is_empty() {
            hits.pop();
        } else {
            pinned_hits.pop();
        }
        (prompt_tokens, checked_bundle) =
            candidate(input, &hits, &history, &pinned_hits, summary, system_tokens);
    }
    Ok(ContextPlan {
        context_tokens,
        max_tokens,
        history,
        context_preamble: preamble(
            summary,
            input.language,
            !hits.is_empty() || !pinned_hits.is_empty(),
        ),
        pinned_hits,
        hits,
        prompt_tokens,
        fits: prompt_tokens as f64 <= input_limit,
        summary_omitted: input.summary.is_some() && summary.is_none(),
        checked_bundle,
    })
}
