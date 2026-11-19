//! Original evidence-bound reporting grammar. Exact fragments establish origin,
//! not relevance, completeness, entailment, authority or the correctness of the
//! model's chosen documentary issue. The enclosing plan bounds the source catalog.
use crate::{
    answer_format::escape_source_markdown,
    citation_markers::{self, CitationMatch},
    ordered_json::OrderedValue,
    qa::Language,
    source_fragments::{FragmentMatcher, FragmentRejection, SourceFragment},
};
use regex::Regex;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceSpan {
    pub source: String,
    #[serde(flatten)]
    pub fragment: SourceFragment,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSummary {
    pub answer: String,
    pub spans: Vec<SourceSpan>,
    pub display_spans: Vec<SourceSpan>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryRejection {
    SummaryShape,
    EvidenceShape,
    EvidenceSource,
    LabelDisplay,
    LabelMissing,
    LabelBoundary,
    ExcerptDisplay,
    ExcerptMissing,
    ExcerptBoundary,
    RenderBound,
    RenderMismatch,
}
/// Property order is part of the original grammar contract. Keep the schema
/// ordered without enabling a different JSON map representation globally.
pub fn schema(ids: &[String]) -> Result<OrderedValue, crate::ordered_json::DecodeRejection> {
    if ids.len() > 32 || ids.iter().any(|id| id.len() > 33) {
        return Err(crate::ordered_json::DecodeRejection::Bounds);
    }
    if ids.iter().any(|id| {
        citation_markers::parse_cite_href(Some(&format!("#cite-{}", id.replace(':', "-"))))
            .is_none_or(|m| format!("{}:{}", m.document_id, m.chunk_id) != *id)
    }) {
        return Err(crate::ordered_json::DecodeRejection::Json);
    }
    let ids = serde_json::to_string(ids).expect("strings serialize");
    let evidence = r#"{"type":"object","properties":{"text":{"type":"string","minLength":1,"maxLength":160},"source":{"enum":$IDS}},"required":["text","source"],"additionalProperties":false}"#.replace("$IDS", &ids);
    let schema = r#"{
      "type":"object",
      "properties":{
        "scope":{"type":"array","minItems":1,"maxItems":3,"items":$EVIDENCE},
        "alternatives":{"type":"array","minItems":2,"maxItems":4,"items":{
          "type":"object","properties":{
            "label":{"oneOf":[{"type":"string","minLength":1,"maxLength":80},{"type":"object","properties":{"kind":{"const":"heading"}},"required":["kind"],"additionalProperties":false}]},
            "value":{"type":"string","minLength":1,"maxLength":160},"source":{"enum":$IDS}
          },"required":["label","value","source"],"additionalProperties":false
        }},
        "grounds":{"type":"array","minItems":1,"maxItems":3,"items":{
          "type":"object","properties":{
            "kind":{"enum":["approval","priority","correction","authority","scope","effective_date"]},
            "evidence":{"type":"array","minItems":1,"maxItems":4,"items":$EVIDENCE}
          },"required":["kind","evidence"],"additionalProperties":false
        }}
      },"required":["scope","alternatives","grounds"],"additionalProperties":false
    }"#.replace("$IDS", &ids).replace("$EVIDENCE", &evidence);
    crate::ordered_json::parse(&schema)
}
fn list(value: Option<&OrderedValue>, min: usize, max: usize) -> Option<&[OrderedValue]> {
    value?.as_array().filter(|a| (min..=max).contains(&a.len()))
}
fn member<'a>(v: &'a OrderedValue, k: &str) -> Option<&'a str> {
    v.get(k)?.as_str()
}

fn leading_heading(text: &str) -> Option<SourceFragment> {
    static LINES: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[^\r\n]*(?:\r\n|\r|\n|$)").unwrap());
    static PREFIX: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^ {0,3}#{1,6}(?:[ \t]+|$)").unwrap());
    static CLOSING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]+#+[ \t]*$").unwrap());
    let mut selected = None;
    for line in LINES.find_iter(text) {
        let body = line.as_str().trim_end_matches(['\r', '\n']);
        if body.trim_matches(citation_markers::ws).is_empty() {
            continue;
        }
        let prefix = PREFIX.find(body);
        if selected.is_some() {
            if prefix.is_some() {
                return None;
            }
            continue;
        }
        let prefix = prefix?;
        let raw_name = &body[prefix.end()..];
        let name = CLOSING.replace(raw_name, "");
        let name = name.trim_end_matches([' ', '\t']);
        if name.is_empty() {
            return None;
        }
        let start = text[..line.start() + prefix.end()].encode_utf16().count();
        selected = Some(SourceFragment {
            start,
            end: start + name.encode_utf16().count(),
            text: name.to_owned(),
            ambiguous: false,
        });
    }
    selected
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    Label,
    Value,
    Scope,
    Ground,
}
struct Matches {
    matchers: HashMap<String, FragmentMatcher>,
    spans: Vec<SourceSpan>,
    sources: HashSet<String>,
}
impl Matches {
    fn select(
        &mut self,
        text: Option<&str>,
        source: Option<&str>,
        role: Role,
    ) -> Result<SourceSpan, SummaryRejection> {
        let source = source
            .filter(|s| self.matchers.contains_key(*s))
            .ok_or(SummaryRejection::EvidenceSource)?;
        let matcher = &self.matchers[source];
        let fragment = text
            .ok_or(FragmentRejection::Display)
            .and_then(|text| {
                if role == Role::Ground {
                    matcher.match_excerpt(text, 160).map(|r| r.selected)
                } else {
                    matcher.match_fragment(text, if role == Role::Label { 80 } else { 160 })
                }
            })
            .map_err(|r| match (role == Role::Label, r) {
                (true, FragmentRejection::Display) => SummaryRejection::LabelDisplay,
                (true, FragmentRejection::Missing) => SummaryRejection::LabelMissing,
                (true, FragmentRejection::Boundary) => SummaryRejection::LabelBoundary,
                (false, FragmentRejection::Display) => SummaryRejection::ExcerptDisplay,
                (false, FragmentRejection::Missing) => SummaryRejection::ExcerptMissing,
                (false, FragmentRejection::Boundary) => SummaryRejection::ExcerptBoundary,
            })?;
        let span = SourceSpan {
            source: source.to_owned(),
            fragment,
        };
        self.spans.push(span.clone());
        self.sources.insert(source.to_owned());
        Ok(span)
    }
}
const ISSUES: [&str; 6] = [
    "approval",
    "priority",
    "correction",
    "authority",
    "scope",
    "effective_date",
];
fn issue_label(issue: &str, de: bool) -> &str {
    match (issue, de) {
        ("approval", true) => "Freigabe",
        ("priority", true) => "Vorrang",
        ("correction", true) => "Korrektur",
        ("authority", true) => "Autorität",
        ("scope", true) => "gemeinsamen Geltungsbereich",
        ("effective_date", true) => "Wirksamkeitsdatum",
        ("scope", false) => "shared scope",
        ("effective_date", false) => "effective date",
        _ => issue,
    }
}
fn join(parts: &[String], de: bool) -> String {
    if parts.len() == 1 {
        return parts[0].clone();
    }
    format!(
        "{}{}{}",
        parts[..parts.len() - 1].join(", "),
        if de { " und " } else { " and " },
        parts.last().unwrap()
    )
}
fn cite(
    answer: &mut String,
    expected: &mut Vec<CitationMatch>,
    ids: impl IntoIterator<Item = String>,
) -> Result<(), SummaryRejection> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        let marker =
            citation_markers::parse_cite_href(Some(&format!("#cite-{}", id.replace(':', "-"))))
                .ok_or(SummaryRejection::RenderMismatch)?;
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
    }
    Ok(())
}
pub fn render(
    value: &OrderedValue,
    sources: &HashMap<String, String>,
    language: Language,
    max_characters: usize,
) -> Result<ConflictSummary, SummaryRejection> {
    render_with_finder(
        value,
        sources,
        language,
        max_characters,
        citation_markers::find_citation_matches,
    )
}
fn render_with_finder(
    value: &OrderedValue,
    sources: &HashMap<String, String>,
    language: Language,
    max_characters: usize,
    finder: impl Fn(&str) -> Vec<CitationMatch>,
) -> Result<ConflictSummary, SummaryRejection> {
    use SummaryRejection::*;
    if !value.ordered_keys(&["scope", "alternatives", "grounds"]) {
        return Err(SummaryShape);
    }
    let scope_values = list(value.get("scope"), 1, 3).ok_or(SummaryShape)?;
    let alternatives_values = list(value.get("alternatives"), 2, 4).ok_or(SummaryShape)?;
    let grounds_values = list(value.get("grounds"), 1, 3).ok_or(SummaryShape)?;
    let mut matches = Matches {
        matchers: sources
            .iter()
            .map(|(id, text)| (id.clone(), FragmentMatcher::new(text.clone())))
            .collect(),
        spans: Vec::new(),
        sources: HashSet::new(),
    };
    let mut scopes = Vec::new();
    for scope in scope_values {
        if !scope.ordered_keys(&["text", "source"]) {
            return Err(EvidenceShape);
        }
        scopes.push(matches.select(member(scope, "text"), member(scope, "source"), Role::Scope)?);
    }
    let mut alternatives = Vec::<(SourceSpan, SourceSpan)>::new();
    let mut alternatives_seen = HashSet::new();
    for alternative in alternatives_values {
        if !alternative.ordered_keys(&["label", "value", "source"]) {
            return Err(EvidenceShape);
        }
        let label = alternative.get("label").ok_or(EvidenceShape)?;
        let source = member(alternative, "source");
        let label = if let Some(text) = label.as_str() {
            matches.select(Some(text), source, Role::Label)?
        } else {
            if !label.ordered_keys(&["kind"]) || member(label, "kind") != Some("heading") {
                return Err(EvidenceShape);
            }
            if alternatives_values
                .iter()
                .filter(|item| item.get("source") == alternative.get("source"))
                .count()
                != 1
            {
                return Err(EvidenceShape);
            }
            let text = source.and_then(|s| sources.get(s)).ok_or(EvidenceSource)?;
            let heading = leading_heading(text).ok_or(LabelMissing)?;
            let found = matches.select(Some(&heading.text), source, Role::Label)?;
            if found.fragment.start != heading.start || found.fragment.end != heading.end {
                return Err(LabelMissing);
            }
            found
        };
        let found = matches.select(member(alternative, "value"), source, Role::Value)?;
        let identity = (
            label.source.clone(),
            label.fragment.start,
            label.fragment.end,
            found.fragment.start,
            found.fragment.end,
        );
        if !alternatives_seen.insert(identity) {
            return Err(EvidenceShape);
        }
        alternatives.push((label, found));
    }
    let mut grounds = Vec::new();
    let mut issues_seen = HashSet::new();
    for ground in grounds_values {
        if !ground.ordered_keys(&["kind", "evidence"]) {
            return Err(EvidenceShape);
        }
        let kind = member(ground, "kind")
            .filter(|s| ISSUES.contains(s))
            .ok_or(EvidenceShape)?;
        if !issues_seen.insert(kind) {
            return Err(EvidenceShape);
        }
        let items = list(ground.get("evidence"), 1, 4).ok_or(EvidenceShape)?;
        let mut evidence = Vec::new();
        for item in items {
            if !item.ordered_keys(&["text", "source"]) {
                return Err(EvidenceShape);
            }
            evidence.push(matches.select(
                member(item, "text"),
                member(item, "source"),
                Role::Ground,
            )?);
        }
        grounds.push((kind, evidence));
    }
    if matches.sources.len() > 4 {
        return Err(EvidenceSource);
    }
    let visible_scopes: Vec<_> = scopes
        .iter()
        .filter(|scope| {
            !alternatives.iter().any(|(label, _)| {
                scope.source == label.source
                    && scope.fragment.start == label.fragment.start
                    && scope.fragment.end == label.fragment.end
                    && scope.fragment.text == label.fragment.text
            })
        })
        .cloned()
        .collect();
    let mut display_spans = visible_scopes.clone();
    for (label, value) in &alternatives {
        display_spans.push(label.clone());
        display_spans.push(value.clone());
    }
    let de = matches!(language, Language::De);
    let quote = |text: &str| {
        format!(
            "{}{}{}",
            if de { "„" } else { "“" },
            escape_source_markdown(text),
            if de { "“" } else { "”" }
        )
    };
    let mut answer = if visible_scopes.is_empty() {
        String::new()
    } else if de {
        "Zu ".to_owned()
    } else {
        "For ".to_owned()
    };
    let mut expected = Vec::new();
    if !visible_scopes.is_empty() {
        answer.push_str(&join(
            &visible_scopes
                .iter()
                .map(|s| quote(&s.fragment.text))
                .collect::<Vec<_>>(),
            de,
        ));
        cite(
            &mut answer,
            &mut expected,
            visible_scopes.iter().map(|s| s.source.clone()),
        )?;
        answer.push_str(if de { " nennt " } else { ", " });
    }
    for (i, (label, value)) in alternatives.iter().enumerate() {
        if i > 0 {
            answer.push_str(if i == alternatives.len() - 1 {
                if de { " und " } else { " and " }
            } else {
                ", "
            });
        }
        answer.push_str(&quote(&label.fragment.text));
        answer.push_str(if de {
            if i == 0 && !visible_scopes.is_empty() {
                " "
            } else {
                " nennt "
            }
        } else {
            " reports "
        });
        answer.push_str(&quote(&value.fragment.text));
        cite(&mut answer, &mut expected, [value.source.clone()])?;
    }
    answer.push_str(if de {
        "; weil diese Textstellen "
    } else {
        "; because these excerpts do not establish "
    });
    answer.push_str(&join(
        &grounds
            .iter()
            .map(|(kind, _)| issue_label(kind, de).to_owned())
            .collect::<Vec<_>>(),
        de,
    ));
    answer.push_str(if de {
        " nicht belegen, bleibt offen, welche Angabe gilt"
    } else {
        ", which statement governs remains unresolved"
    });
    cite(
        &mut answer,
        &mut expected,
        grounds
            .iter()
            .flat_map(|(_, items)| items.iter().map(|s| s.source.clone())),
    )?;
    answer.push('.');
    if answer.chars().count() > max_characters.min(512) {
        return Err(RenderBound);
    }
    if finder(&answer) != expected {
        return Err(RenderMismatch);
    }
    Ok(ConflictSummary {
        answer,
        spans: matches.spans,
        display_spans,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_injected_visibility_failure_rejects() {
        assert!(schema(&["$EVIDENCE".to_owned()]).is_err());
        assert!(schema(&["0:1".to_owned()]).is_err());
        assert!(schema(&["9007199254740992:1".to_owned()]).is_err());
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/original-conflict-summary.json"
        ))
        .unwrap();
        let mut count = 0;
        for case in fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|v| v["faultInjected"] == true)
        {
            count += 1;
            let value = crate::ordered_json::parse(case["raw"].as_str().unwrap()).unwrap();
            let sources = case["sources"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| {
                    (
                        v[0].as_str().unwrap().to_owned(),
                        v[1].as_str().unwrap().to_owned(),
                    )
                })
                .collect();
            let language = if case["language"] == "de" {
                Language::De
            } else {
                Language::En
            };
            let max = case["max"].as_u64().unwrap() as usize;
            assert!(render(&value, &sources, language, max).is_ok());
            let error =
                render_with_finder(&value, &sources, language, max, |_| Vec::new()).unwrap_err();
            assert_eq!(serde_json::to_value(error).unwrap(), case["rejection"]);
        }
        assert_eq!(count, 1);
    }
}
