//! Canonical typed-comparison-v32 envelope, immutable catalog and source display.
//! Structural validity is not semantic acceptance. The checked-QA orchestration
//! must still judge relevance, applicability, completeness and the chosen outcome.
use crate::{
    answer_format,
    citation_markers::{self, CitationMatch},
    conflict_summary::{self, SourceSpan, SummaryRejection},
    ordered_json::{self, OrderedValue},
    qa::Language,
    source_calculations::{self, CalculationPassage},
    source_fragments::SourceFragment,
    source_linked_answer::{self, AnswerRejection, StructuralRejection},
    source_quantities::{self, QuantityPassage},
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
pub const VERSION: &str = "typed-comparison-v32";
pub type ComparisonPassage = CalculationPassage;
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ComparisonMode {
    Full,
    Summary,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Derivation {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub start: usize,
    pub end: usize,
    pub original: String,
    pub expression: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedAnswer {
    pub mode: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    pub answer: String,
    pub spans: Vec<SourceSpan>,
    pub display_spans: Vec<SourceSpan>,
    pub derivations: Vec<Derivation>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Rejection {
    Bounds,
    Json,
    Envelope,
    Answer,
    Comparison,
    Source,
    Render,
    Citations,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderRejection {
    SourceOrder,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum OrdinaryDetail {
    Renderer(AnswerRejection),
    Order(OrderRejection),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonShape {
    ComparisonShape,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum ComparisonDetail {
    Shape(ComparisonShape),
    Summary(SummaryRejection),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ParseFailure {
    pub reason: Rejection,
    pub ordinary: Option<OrdinaryDetail>,
    pub comparison: Option<ComparisonDetail>,
}
impl From<Rejection> for ParseFailure {
    fn from(reason: Rejection) -> Self {
        Self {
            reason,
            ordinary: None,
            comparison: None,
        }
    }
}
fn ordinary(detail: OrdinaryDetail) -> ParseFailure {
    ParseFailure {
        reason: Rejection::Answer,
        ordinary: Some(detail),
        comparison: None,
    }
}
fn shape() -> ParseFailure {
    ordinary(OrdinaryDetail::Renderer(
        StructuralRejection::RecordShape.into(),
    ))
}
fn keys(value: &OrderedValue, names: &[&str]) -> bool {
    matches!(value, OrderedValue::Object(v) if v.len() == names.len() && names.iter().all(|n| value.get(n).is_some()))
}
fn first_key(value: &OrderedValue) -> Option<&str> {
    match value {
        OrderedValue::Object(v) => v.first().map(|(k, _)| k.as_str()),
        _ => None,
    }
}
fn member<'a>(value: &'a OrderedValue, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str()
}

pub struct ComparisonPlan {
    sources: Vec<ComparisonPassage>,
    mode: ComparisonMode,
    references: Vec<Derivation>,
    schema: OrderedValue,
}
impl ComparisonPlan {
    pub fn new(question: &str, input: &[ComparisonPassage]) -> Option<Self> {
        if input.is_empty() || input.len() > 32 {
            return None;
        }
        let mut ids = HashSet::new();
        let mut total = 0;
        for source in input {
            let length = source.text.encode_utf16().count();
            if !(1..=9_007_199_254_740_991).contains(&source.document_id)
                || !(1..=9_007_199_254_740_991).contains(&source.chunk_id)
                || source.text.trim_matches(citation_markers::ws).is_empty()
                || length > 64_000
            {
                return None;
            }
            total += length;
            if total > 256_000 || !ids.insert(format!("{}:{}", source.document_id, source.chunk_id))
            {
                return None;
            }
        }
        let mode = if answer_format::requests_single_sentence(question) {
            ComparisonMode::Summary
        } else {
            ComparisonMode::Full
        };
        let quantities = source_quantities::annotate(
            &input
                .iter()
                .map(|s| QuantityPassage {
                    document_id: s.document_id,
                    chunk_id: s.chunk_id,
                    text: s.text.clone(),
                })
                .collect::<Vec<_>>(),
        );
        let calculations = source_calculations::annotate(question, input);
        let mut references: Vec<_> = quantities
            .quantities
            .into_iter()
            .map(|q| Derivation {
                id: q.id,
                kind: "quantity".to_owned(),
                source: format!("{}:{}", q.document_id, q.chunk_id),
                start: q.start,
                end: q.end,
                expression: format!("{} = {} {}", q.text, q.normalized.value, q.normalized.unit),
                original: q.text,
            })
            .collect();
        references.extend(
            calculations
                .calculations
                .into_iter()
                .enumerate()
                .map(|(i, c)| Derivation {
                    id: format!("C{}", i + 1),
                    kind: "code".to_owned(),
                    source: format!("{}:{}", c.document_id, c.chunk_id),
                    start: c.start,
                    end: c.end,
                    original: c.source,
                    expression: format!(
                        "{} = {}",
                        c.call,
                        source_calculations::js_number(c.result)
                    ),
                }),
        );
        if references.len() > 48 {
            return None;
        }
        for reference in &references {
            let source = input
                .iter()
                .find(|s| format!("{}:{}", s.document_id, s.chunk_id) == reference.source)?;
            let units: Vec<_> = source.text.encode_utf16().collect();
            if String::from_utf16(units.get(reference.start..reference.end)?).ok()?
                != reference.original
            {
                return None;
            }
        }
        let ids: Vec<_> = input
            .iter()
            .map(|s| format!("{}:{}", s.document_id, s.chunk_id))
            .collect();
        let schema = build_schema(&ids, mode)?;
        Some(Self {
            sources: input.to_vec(),
            mode,
            references,
            schema,
        })
    }
    pub fn comparison_mode(&self) -> ComparisonMode {
        self.mode
    }
    /// Retained diagnostic: the current contract never selects internal
    /// sentence units or inserts their labels into the model prompt.
    pub fn concise_unit_count(&self) -> usize {
        0
    }
    pub fn summary_max_code_points(&self) -> Option<usize> {
        (self.mode == ComparisonMode::Summary).then_some(512)
    }
    pub fn json_schema(&self) -> &OrderedValue {
        &self.schema
    }
    pub fn prompt_source_text(&self, document_id: i64, chunk_id: i64) -> Option<&str> {
        self.sources
            .iter()
            .find(|s| s.document_id == document_id && s.chunk_id == chunk_id)
            .map(|s| s.text.as_str())
    }
    pub fn parse(
        &self,
        raw: &str,
        language: Language,
        max_chars: usize,
    ) -> Result<ParsedAnswer, ParseFailure> {
        if !(1..=32_000).contains(&max_chars) {
            return Err(Rejection::Bounds.into());
        }
        let value = ordered_json::parse(raw).map_err(|e| match e {
            ordered_json::DecodeRejection::Bounds => Rejection::Bounds,
            ordered_json::DecodeRejection::Json => Rejection::Json,
        })?;
        if !keys(&value, &["check", "result"])
            || first_key(&value) != Some("check")
            || !member(&value, "check").is_some_and(|s| {
                !s.trim_matches(citation_markers::ws).is_empty() && s.chars().count() <= 120
            })
            || !matches!(value.get("result"), Some(OrderedValue::Object(_)))
        {
            return Err(Rejection::Envelope.into());
        }
        let result = value.get("result").unwrap();
        let ids: HashSet<_> = self
            .sources
            .iter()
            .map(|s| format!("{}:{}", s.document_id, s.chunk_id))
            .collect();
        if member(result, "resolution") == Some("answered") {
            if !keys(result, &["resolution", "blocks"]) {
                return Err(shape());
            }
            let blocks = result
                .get("blocks")
                .and_then(OrderedValue::as_array)
                .filter(|a| !a.is_empty() && a.len() <= max_chars)
                .ok_or_else(shape)?;
            for block in blocks {
                if !keys(block, &["sources", "text"]) {
                    return Err(shape());
                }
                if first_key(block) != Some("text") {
                    return Err(ordinary(OrdinaryDetail::Order(OrderRejection::SourceOrder)));
                }
            }
            let answer = source_linked_answer::render(
                &result.get("blocks").unwrap().to_value(),
                &ids,
                max_chars,
            )
            .map_err(|e| ordinary(OrdinaryDetail::Renderer(e)))?;
            return Ok(ParsedAnswer {
                mode: "answered",
                outcome: None,
                answer,
                spans: Vec::new(),
                display_spans: Vec::new(),
                derivations: Vec::new(),
            });
        }
        if self.mode == ComparisonMode::Summary {
            if member(result, "resolution") != Some("comparison")
                || !result.ordered_keys(&["resolution", "summary", "outcome"])
                || member(result, "outcome") != Some("unresolved")
            {
                return Err(ParseFailure {
                    reason: Rejection::Comparison,
                    ordinary: None,
                    comparison: Some(ComparisonDetail::Shape(ComparisonShape::ComparisonShape)),
                });
            }
            let sources = self
                .sources
                .iter()
                .map(|s| (format!("{}:{}", s.document_id, s.chunk_id), s.text.clone()))
                .collect();
            let summary = conflict_summary::render(
                result.get("summary").unwrap(),
                &sources,
                language,
                max_chars,
            )
            .map_err(|detail| ParseFailure {
                reason: match detail {
                    SummaryRejection::RenderBound => Rejection::Answer,
                    SummaryRejection::RenderMismatch => Rejection::Citations,
                    _ => Rejection::Comparison,
                },
                ordinary: None,
                comparison: Some(ComparisonDetail::Summary(detail)),
            })?;
            return Ok(ParsedAnswer {
                mode: "comparison",
                outcome: Some("unresolved".to_owned()),
                answer: summary.answer,
                spans: summary.spans,
                display_spans: summary.display_spans,
                derivations: Vec::new(),
            });
        }
        let outcome = member(result, "outcome")
            .filter(|s| ["compatible", "unresolved", "insufficient"].contains(s));
        let selected = result
            .get("sources")
            .and_then(OrderedValue::as_array)
            .filter(|a| (1..=4).contains(&a.len()));
        if member(result, "resolution") != Some("comparison")
            || !keys(result, &["resolution", "outcome", "sources"])
            || outcome.is_none()
            || selected.is_none()
        {
            return Err(Rejection::Comparison.into());
        }
        let outcome = outcome.unwrap();
        let selected = selected.unwrap();
        let mut spans = Vec::new();
        let mut seen = HashSet::new();
        for item in selected {
            let id = item.as_str().ok_or(Rejection::Source)?;
            if !seen.insert(id) || !ids.contains(id) {
                return Err(Rejection::Source.into());
            }
            let source = self
                .sources
                .iter()
                .find(|s| format!("{}:{}", s.document_id, s.chunk_id) == id)
                .ok_or(Rejection::Source)?;
            spans.push(SourceSpan {
                source: id.to_owned(),
                fragment: SourceFragment {
                    start: 0,
                    end: source.text.encode_utf16().count(),
                    text: source.text.clone(),
                    ambiguous: false,
                },
            });
        }
        let references: Vec<_> = self
            .references
            .iter()
            .filter(|r| {
                if r.kind == "code" {
                    seen.contains(r.source.as_str())
                } else {
                    spans.iter().any(|s| {
                        s.source == r.source
                            && r.start >= s.fragment.start
                            && r.end <= s.fragment.end
                    })
                }
            })
            .cloned()
            .collect();
        let mut answer = lead(language, outcome).to_owned();
        let mut expected = Vec::new();
        for span in &spans {
            answer.push_str("\n\n");
            answer.push_str(&answer_format::source_quote_markdown(&span.fragment.text));
            answer.push_str("\n\n");
            cite(&mut answer, &mut expected, &span.source)?;
        }
        if !references.is_empty() {
            answer.push_str(match language { Language::De => "\n\nRechnerisch aus den angeführten Quellen; keine Aussage zur Verbindlichkeit:", Language::En => "\n\nComputed from the cited sources; this does not establish which source governs:" });
            for reference in &references {
                answer.push_str("\n\n");
                answer.push_str(&answer_format::escape_source_markdown(
                    &reference.expression,
                ));
                cite(&mut answer, &mut expected, &reference.source)?;
            }
        }
        if answer.encode_utf16().count() > 32_000 {
            return Err(Rejection::Render.into());
        }
        if citation_markers::find_citation_matches(&answer) != expected {
            return Err(Rejection::Citations.into());
        }
        Ok(ParsedAnswer {
            mode: "comparison",
            outcome: Some(outcome.to_owned()),
            answer,
            display_spans: spans.clone(),
            spans,
            derivations: references,
        })
    }
}
fn cite(answer: &mut String, expected: &mut Vec<CitationMatch>, id: &str) -> Result<(), Rejection> {
    let marker =
        citation_markers::parse_cite_href(Some(&format!("#cite-{}", id.replace(':', "-"))))
            .ok_or(Rejection::Citations)?;
    answer.push(' ');
    let start = answer.encode_utf16().count();
    answer.push_str(&format!(
        "[doc:{}, chunk:{}]",
        marker.document_id, marker.chunk_id
    ));
    expected.push(CitationMatch {
        marker,
        start,
        end: answer.encode_utf16().count(),
    });
    Ok(())
}
fn lead(language: Language, outcome: &str) -> &'static str {
    match (language, outcome) {
        (Language::En, "compatible") => {
            "The supplied excerpts can be read consistently. The cited source statements are:"
        }
        (Language::En, "unresolved") => {
            "I cannot establish a single definitive answer from the supplied excerpts. The cited source statements are:"
        }
        (Language::En, _) => {
            "The supplied excerpts do not provide enough evidence to answer this question. This does not establish what the rest of the document contains. The cited excerpts are:"
        }
        (Language::De, "compatible") => {
            "Die bereitgestellten Textstellen lassen sich miteinander vereinbaren. Die angeführten Quellenaussagen sind:"
        }
        (Language::De, "unresolved") => {
            "Aus den bereitgestellten Textstellen kann ich keine eindeutige Antwort ableiten. Die angeführten Quellenaussagen sind:"
        }
        (Language::De, _) => {
            "Die bereitgestellten Textstellen reichen zur Beantwortung dieser Frage nicht aus. Daraus folgt keine Aussage über den übrigen Dokumentinhalt. Die angeführten Textstellen sind:"
        }
    }
}
fn build_schema(ids: &[String], mode: ComparisonMode) -> Option<OrderedValue> {
    let ids_json = serde_json::to_string(ids).ok()?;
    let ordinary = r#"{"type":"object","properties":{"resolution":{"const":"answered"},"blocks":{"type":"array","minItems":1,"items":{"type":"object","properties":{"text":{"type":"string","minLength":1},"sources":{"type":"array","minItems":1,"maxItems":32,"items":{"enum":$IDS}}},"required":["text","sources"],"additionalProperties":false}}},"required":["resolution","blocks"],"additionalProperties":false}"#.replace("$IDS", &ids_json);
    let comparison = |outcomes: &str| {
        r#"{"type":"object","properties":{"resolution":{"const":"comparison"},"sources":{"type":"array","minItems":1,"maxItems":4,"items":{"enum":$IDS}},"outcome":{"enum":$OUTCOMES}},"required":["resolution","sources","outcome"],"additionalProperties":false}"#.replace("$IDS", &ids_json).replace("$OUTCOMES", outcomes)
    };
    let branches = if mode == ComparisonMode::Summary {
        let summary = serde_json::to_string(&conflict_summary::schema(ids).ok()?).ok()?;
        let summary = r#"{"type":"object","properties":{"resolution":{"const":"comparison"},"summary":$SUMMARY,"outcome":{"const":"unresolved"}},"required":["resolution","summary","outcome"],"additionalProperties":false}"#.replace("$SUMMARY", &summary);
        format!("{ordinary},{summary}")
    } else {
        format!(
            "{ordinary},{},{}",
            comparison(r#"["compatible","unresolved"]"#),
            comparison(r#"["insufficient"]"#)
        )
    };
    let raw = r#"{"type":"object","properties":{"check":{"type":"string","minLength":1,"maxLength":120},"result":{"oneOf":[$BRANCHES]}},"required":["check","result"],"additionalProperties":false}"#.replace("$BRANCHES", &branches);
    ordered_json::parse(&raw).ok()
}
